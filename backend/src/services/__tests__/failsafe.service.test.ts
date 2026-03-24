import { EventEmitter } from 'events'

const haEvents = new EventEmitter()
const proxyEvents = new EventEmitter()
const mockDispatchTelegramNotificationEvent = jest.fn().mockResolvedValue({ delivered: 0 })
const mockLoggerInfo = jest.fn()
const mockLoggerWarn = jest.fn()
const mockLoggerError = jest.fn()

let mockDemo = false

jest.mock('../../config', () => ({
  getConfig: () => ({ demo: mockDemo }),
}))

jest.mock('../../services/notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: (...args: unknown[]) => mockDispatchTelegramNotificationEvent(...args),
}))

jest.mock('../../services/ha.service', () => ({
  haEvents,
}))

jest.mock('../../services/proxy.service', () => ({
  proxyEvents,
}))

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}))

describe('failsafe service lifecycle', () => {
  beforeEach(async () => {
    jest.resetModules()
    jest.useFakeTimers()
    mockDemo = false
    mockDispatchTelegramNotificationEvent.mockClear()
    mockLoggerInfo.mockClear()
    mockLoggerWarn.mockClear()
    mockLoggerError.mockClear()
    haEvents.removeAllListeners()
    proxyEvents.removeAllListeners()
  })

  afterEach(async () => {
    jest.useRealTimers()
  })

  test('activates failsafe from HA disconnect and resets on reconnect with duration log', async () => {
    const module = await import('../failsafe.service')

    module.initFailsafe()
    haEvents.emit('disconnected')

    expect(module.isFailsafeActive()).toBe(true)
    expect(module.getFailsafeReason()).toBe('Home Assistant disconnected')
    expect(mockLoggerError).toHaveBeenCalledWith('FAILSAFE_ACTIVATED', expect.objectContaining({
      source: 'ha',
      reason: 'Home Assistant disconnected',
    }))

    jest.advanceTimersByTime(4000)
    haEvents.emit('connected')
    await Promise.resolve()

    expect(module.isFailsafeActive()).toBe(false)
    expect(mockLoggerInfo).toHaveBeenCalledWith('FAILSAFE_RESET', expect.objectContaining({
      previousReason: 'Home Assistant disconnected',
      activeForSec: 4,
    }))
  })

  test('logs duplicate activation attempts while failsafe is already active', async () => {
    const module = await import('../failsafe.service')

    module.initFailsafe()
    proxyEvents.emit('disconnected')
    proxyEvents.emit('disconnected')

    expect(module.isFailsafeActive()).toBe(true)
    expect(mockLoggerWarn).toHaveBeenCalledWith('FAILSAFE_ALREADY_ACTIVE', expect.objectContaining({
      source: 'proxy',
      reason: 'Vehicle proxy disconnected',
      activeReason: 'Vehicle proxy disconnected',
    }))
  })
})