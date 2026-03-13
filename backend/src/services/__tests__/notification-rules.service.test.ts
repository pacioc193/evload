import { getConfig } from '../../config'
import { sendTelegramNotification } from '../telegram.service'
import {
  dispatchTelegramNotificationEvent,
  emitNotificationEvent,
  evaluateCondition,
  extractMissingTemplatePlaceholders,
  getFieldValue,
  getNotificationPlaceholderCatalog,
  notificationEvents,
  renderNotificationTemplate,
  type NotificationRule,
  validateNotificationPayload,
} from '../notification-rules.service'

jest.mock('../../config', () => ({
  getConfig: jest.fn(),
}))

jest.mock('../telegram.service', () => ({
  sendTelegramNotification: jest.fn(),
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockedSendTelegramNotification = sendTelegramNotification as jest.MockedFunction<typeof sendTelegramNotification>

function setRules(rules: NotificationRule[]): void {
  mockedGetConfig.mockReturnValue({
    telegram: {
      notifications: {
        rules,
      },
    },
  } as never)
}

describe('notification-rules.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedSendTelegramNotification.mockResolvedValue(true)
  })

  test('renders template with named placeholders and nested fields', () => {
    const rendered = renderNotificationTemplate('Power {{metrics.homePowerW}}W / {{event}}', {
      event: 'ha_throttled',
      metrics: { homePowerW: 5100 },
    })
    expect(rendered).toBe('Power 5100W / ha_throttled')
  })

  test('evaluates numeric condition operators', () => {
    const payload = { homePowerW: 5100 }
    expect(evaluateCondition({ field: 'homePowerW', operator: 'gt', value: 5000 }, payload)).toBe(true)
    expect(evaluateCondition({ field: 'homePowerW', operator: 'lte', value: 5000 }, payload)).toBe(false)
  })

  test('resolves nested field path', () => {
    const value = getFieldValue({ a: { b: { c: 42 } } }, 'a.b.c')
    expect(value).toBe(42)
  })

  test('dispatches only matched rules and reports delivered count', async () => {
    setRules([
      {
        id: 'r1',
        name: 'HA high power',
        enabled: true,
        event: 'ha_throttled',
        template: 'Throttled {{homePowerW}}',
        condition: { field: 'homePowerW', operator: 'gt', value: 4500 },
      },
      {
        id: 'r2',
        name: 'No match',
        enabled: true,
        event: 'ha_throttled',
        template: 'Never',
        condition: { field: 'homePowerW', operator: 'lt', value: 1000 },
      },
    ])

    mockedSendTelegramNotification.mockResolvedValueOnce(true)

    const result = await dispatchTelegramNotificationEvent('ha_throttled', { homePowerW: 5000 })

    expect(result.matchedRules).toEqual(['r1'])
    expect(result.messages).toEqual(['Throttled 5000'])
    expect(result.delivered).toBe(1)
    expect(mockedSendTelegramNotification).toHaveBeenCalledTimes(1)
  })

  test('does not deliver messages when no rule matches', async () => {
    setRules([])
    const result = await dispatchTelegramNotificationEvent('engine_stopped', { sessionId: 11 })

    expect(result.messages).toEqual([])
    expect(result.delivered).toBe(0)
    expect(mockedSendTelegramNotification).not.toHaveBeenCalled()
  })

  test('supports changed operator with previous payload tracking', async () => {
    setRules([
      {
        id: 'changed-1',
        name: 'SoC changed',
        enabled: true,
        event: 'soc_increased',
        template: 'Changed to {{soc}}',
        condition: { field: 'soc', operator: 'changed' },
      },
    ])

    const first = await dispatchTelegramNotificationEvent('soc_increased', { soc: 40 })
    const second = await dispatchTelegramNotificationEvent('soc_increased', { soc: 42 })

    expect(first.matchedRules).toEqual([])
    expect(second.matchedRules).toEqual(['changed-1'])
  })

  test('supports increased_by, decreased_by and mod_step operators', async () => {
    setRules([
      {
        id: 'inc-1',
        name: 'Increase by 2',
        enabled: true,
        event: 'soc_increased',
        template: 'Increased {{soc}}',
        condition: { field: 'soc', operator: 'increased_by', value: 2 },
      },
      {
        id: 'dec-1',
        name: 'Decrease by 2',
        enabled: true,
        event: 'soc_increased',
        template: 'Decreased {{soc}}',
        condition: { field: 'soc', operator: 'decreased_by', value: 2 },
      },
      {
        id: 'mod-1',
        name: 'Modulo step 10',
        enabled: true,
        event: 'soc_increased',
        template: 'Crossed {{soc}}',
        condition: { field: 'soc', operator: 'mod_step', value: 10 },
      },
    ])

    await dispatchTelegramNotificationEvent('soc_increased', { soc: 19 })
    const increased = await dispatchTelegramNotificationEvent('soc_increased', { soc: 21 })
    const decreased = await dispatchTelegramNotificationEvent('soc_increased', { soc: 19 })
    const crossedStep = await dispatchTelegramNotificationEvent('soc_increased', { soc: 30 })

    expect(increased.matchedRules).toContain('inc-1')
    expect(increased.matchedRules).toContain('mod-1')
    expect(decreased.matchedRules).toContain('dec-1')
    expect(crossedStep.matchedRules).toContain('mod-1')
  })

  test('exposes descriptions for every placeholder in catalog', () => {
    const catalog = getNotificationPlaceholderCatalog()
    for (const placeholder of catalog.all) {
      expect(typeof catalog.descriptions[placeholder]).toBe('string')
      expect(catalog.descriptions[placeholder].trim().length).toBeGreaterThan(0)
    }
  })

  test('validates payload schema for each selected event', () => {
    const invalid = validateNotificationPayload('engine_started', { sessionId: 'not-a-number' })
    expect(invalid.valid).toBe(false)
    expect(invalid.missingRequired).toContain('targetSoc')
    expect(invalid.invalidTypes).toContain('sessionId:number')

    const valid = validateNotificationPayload('engine_started', { sessionId: 10, targetSoc: 80 })
    expect(valid.valid).toBe(true)
  })

  test('extracts placeholders missing from payload for warning reporting', () => {
    const missing = extractMissingTemplatePlaceholders(
      'Session {{sessionId}} target {{targetSoc}} reason {{reason}}',
      { sessionId: 22, reason: 'manual' }
    )
    expect(missing).toEqual(['targetSoc'])
  })

  test('emitNotificationEvent (bus) triggers rule evaluation via notificationEvents', async () => {
    setRules([
      {
        id: 'bus-1',
        name: 'Bus event rule',
        enabled: true,
        event: 'vehicle_connected',
        template: 'Vehicle {{vehicleId}} connected',
      },
    ])
    mockedSendTelegramNotification.mockResolvedValueOnce(true)

    const listenersCalled: unknown[] = []
    notificationEvents.once('notify', (...args: unknown[]) => listenersCalled.push(args))

    emitNotificationEvent('vehicle_connected', { vehicleId: 'VIN_BUS_TEST' })

    await new Promise((r) => setImmediate(r))

    expect(listenersCalled.length).toBe(1)
    expect(mockedSendTelegramNotification).toHaveBeenCalledWith(
      expect.stringContaining('VIN_BUS_TEST')
    )
  })

  test('emitNotificationEvent does not trigger rules for different events', async () => {
    setRules([
      {
        id: 'bus-none',
        name: 'Only vehicle_disconnected',
        enabled: true,
        event: 'vehicle_disconnected',
        template: 'Disconnected {{vehicleId}}',
      },
    ])
    mockedSendTelegramNotification.mockClear()

    emitNotificationEvent('vehicle_connected', { vehicleId: 'VIN_NO_MATCH' })

    await new Promise((r) => setImmediate(r))

    expect(mockedSendTelegramNotification).not.toHaveBeenCalled()
  })
})
