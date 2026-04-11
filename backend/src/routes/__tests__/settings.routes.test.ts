import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import express from 'express'
import request from 'supertest'

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

jest.mock('../../auth', () => ({
  setPassword: jest.fn(),
  verifyPassword: jest.fn(),
}))

jest.mock('../../prisma', () => ({
  prisma: {},
}))

jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    demo: false,
    homeAssistant: {
      url: 'http://ha.local',
      powerEntityId: 'sensor.power',
      chargerEntityId: 'sensor.charger',
      maxHomePowerW: 4000,
      resumeDelaySec: 30,
    },
    proxy: { url: 'http://proxy.local', vehicleId: 'VIN1', vehicleName: 'Model Test' },
    charging: { batteryCapacityKwh: 75, energyPriceEurPerKwh: 0.3, defaultAmps: 16, maxAmps: 32, minAmps: 6, rampIntervalSec: 10 },
    telegram: {
      enabled: false,
      allowedChatIds: [],
      notifications: { rules: [] },
    },
  })),
  reloadConfig: jest.fn(),
}))

jest.mock('../../services/telegram.service', () => ({
  initTelegram: jest.fn(),
  hasBotToken: jest.fn(() => false),
  setBotToken: jest.fn(),
  getTelegramPrerequisiteStatus: jest.fn(() => ({ ok: false, missing: ['telegram_disabled'] })),
}))

jest.mock('../../services/notification-rules.service', () => ({
  getNotificationEventOptions: jest.fn(() => ['engine_started']),
  getNotificationPlaceholderCatalog: jest.fn(() => ({
    all: ['event', 'timestamp', 'sessionId'],
    byEvent: { engine_started: ['event', 'timestamp', 'sessionId'] },
    descriptions: { event: 'Event name', timestamp: 'ISO datetime', sessionId: 'Session id' },
    presets: { engine_started: { sessionId: 1 } },
    schemas: { engine_started: { required: ['sessionId'], fields: { sessionId: 'number' } } },
  })),
  buildTimestampPayload: jest.fn(() => ({
    timestamp: '2026-04-11T10:00:00.000Z',
    timestamp_time: '10:00',
    timestamp_date: '11/04/2026 10:00',
  })),
  sendTelegramNotificationTest: jest.fn(async () => ({ rendered: 'ok', delivered: false })),
  validateNotificationPayload: jest.fn(() => ({ valid: true, missingRequired: [], invalidTypes: [], unknownFields: [] })),
  extractMissingTemplatePlaceholders: jest.fn(() => []),
}))

describe('settings routes persistence', () => {
  const originalCwd = process.cwd()
  const originalConfigPath = process.env.CONFIG_PATH
  let tmpDir = ''
  let configPath = ''

  async function createApp() {
    jest.resetModules()
    const module = await import('../settings.routes')
    const app = express()
    app.use(express.json())
    app.use('/', module.default)
    return app
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evload-settings-test-'))
    configPath = path.join(tmpDir, 'config.yaml')
    const initial = {
      demo: false,
      telegram: {
        enabled: false,
        botToken: 'legacy-token',
        allowedChatIds: [],
        notifications: { rules: [] },
      },
    }
    fs.writeFileSync(configPath, yaml.dump(initial), 'utf8')
    process.env.CONFIG_PATH = configPath
    process.chdir(tmpDir)
    delete process.env.TELEGRAM_BOT_TOKEN
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH
    } else {
      process.env.CONFIG_PATH = originalConfigPath
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('stores multiple allowed chat IDs and keeps them across subsequent saves', async () => {
    const app = await createApp()

    await request(app)
      .patch('/')
      .send({ telegramAllowedChatIds: ['1001', '1002'], telegramRules: [] })
      .expect(200)

    await request(app)
      .patch('/')
      .send({ telegramEnabled: false })
      .expect(200)

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    expect(saved.telegram.allowedChatIds).toEqual(['1001', '1002'])
  })

  test('delete all event messages persists empty rules array', async () => {
    const app = await createApp()

    await request(app)
      .patch('/')
      .send({
        telegramRules: [
          {
            id: 'r1',
            name: 'Rule 1',
            enabled: true,
            event: 'engine_started',
            template: 'Session {{sessionId}}',
          },
        ],
      })
      .expect(200)

    await request(app)
      .patch('/')
      .send({ telegramRules: [] })
      .expect(200)

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    expect(saved.telegram.notifications.rules).toEqual([])
  })

  test('saves token to database (not .env) and removes botToken from config yaml', async () => {
    const app = await createApp()

    // Resolve AFTER createApp() so refs match the re-imported module
    const { setBotToken: mockSetBotToken } = jest.requireMock('../../services/telegram.service') as {
      setBotToken: jest.Mock
    }
    mockSetBotToken.mockClear()

    await request(app)
      .patch('/')
      .send({ telegramBotToken: 'db-token-value', telegramRules: [] })
      .expect(200)

    // Token must be saved to DB, not to config.yaml
    expect(mockSetBotToken).toHaveBeenCalledWith('db-token-value')

    // .env file should NOT be created
    const envPath = path.join(tmpDir, '.env')
    expect(fs.existsSync(envPath)).toBe(false)

    // botToken field in yaml must not be set
    const savedConfig = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    expect(savedConfig.telegram?.botToken).toBeUndefined()
  })

  test('rejects invalid charging amperage relation when min > default or default > max', async () => {
    const app = await createApp()

    await request(app)
      .patch('/')
      .send({ minAmps: 20, defaultAmps: 10, maxAmps: 30 })
      .expect(400)

    await request(app)
      .patch('/')
      .send({ minAmps: 6, defaultAmps: 20, maxAmps: 16 })
      .expect(400)
  })

  test('persists advanced condition operators (changed, increased_by, decreased_by, mod_step)', async () => {
    const app = await createApp()

    const rules = [
      {
        id: 'adv-1',
        name: 'SoC changed',
        enabled: true,
        event: 'soc_increased',
        template: 'Changed to {{soc}}',
        condition: { field: 'soc', operator: 'changed' },
      },
      {
        id: 'adv-2',
        name: 'SoC increased by 5',
        enabled: true,
        event: 'soc_increased',
        template: 'Increased {{soc}}',
        condition: { field: 'soc', operator: 'increased_by', value: 5 },
      },
      {
        id: 'adv-3',
        name: 'SoC modulo 10',
        enabled: true,
        event: 'soc_increased',
        template: 'Step {{soc}}',
        condition: { field: 'soc', operator: 'mod_step', value: 10 },
      },
    ]

    await request(app)
      .patch('/')
      .send({ telegramRules: rules })
      .expect(200)

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    const savedRules = saved.telegram.notifications.rules
    expect(savedRules[0].condition.operator).toBe('changed')
    expect(savedRules[1].condition.operator).toBe('increased_by')
    expect(savedRules[1].condition.value).toBe(5)
    expect(savedRules[2].condition.operator).toBe('mod_step')
    expect(savedRules[2].condition.value).toBe(10)
  })

  test('rejects settings when one of the required HA entities is missing', async () => {
    const app = await createApp()

    await request(app)
      .patch('/')
      .send({ haChargerEntityId: '' })
      .expect(400)
  })

  test('persists vehicleName in proxy settings', async () => {
    const app = await createApp()

    await request(app)
      .patch('/')
      .send({ vehicleName: 'My EV' })
      .expect(200)

    const saved = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    expect(saved.proxy.vehicleName).toBe('My EV')
  })
})

// ─── /telegram/test endpoint tests ──────────────────────────────────────────
// Regression suite: these tests verify the exact HTTP responses that the UI
// interprets. If the response shape changes, the frontend catch-block may
// fall to the generic "Test failed: invalid payload JSON or backend error".

describe('/telegram/test endpoint', () => {
  let app: express.Express
  const originalCwd = process.cwd()
  let tmpDir = ''

  // Mock references are resolved inside beforeAll (after the final resetModules
  // from the persistence tests above) so they point to the same instances that
  // the freshly imported route handler uses.
  let mockValidate: jest.Mock
  let mockEventOptions: jest.Mock
  let mockSendTest: jest.Mock
  let mockExtract: jest.Mock
  let mockPrereq: jest.Mock

  beforeAll(async () => {
    jest.resetModules()
    const module = await import('../settings.routes')
    app = express()
    app.use(express.json())
    app.use('/', module.default)

    // Resolve AFTER reset so refs match what the route handler uses
    const notifMocks = jest.requireMock('../../services/notification-rules.service') as {
      validateNotificationPayload: jest.Mock
      getNotificationEventOptions: jest.Mock
      sendTelegramNotificationTest: jest.Mock
      extractMissingTemplatePlaceholders: jest.Mock
      buildTimestampPayload: jest.Mock
    }
    const telMocks = jest.requireMock('../../services/telegram.service') as {
      getTelegramPrerequisiteStatus: jest.Mock
      hasBotToken: jest.Mock
      setBotToken: jest.Mock
    }
    mockValidate = notifMocks.validateNotificationPayload
    mockEventOptions = notifMocks.getNotificationEventOptions
    mockSendTest = notifMocks.sendTelegramNotificationTest
    mockExtract = notifMocks.extractMissingTemplatePlaceholders
    mockPrereq = telMocks.getTelegramPrerequisiteStatus
  })

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evload-test-notify-'))
    const configPath = path.join(tmpDir, 'config.yaml')
    fs.writeFileSync(
      configPath,
      yaml.dump({ demo: false, telegram: { enabled: true, allowedChatIds: ['123'], notifications: { rules: [] } } }),
      'utf8'
    )
    process.env.CONFIG_PATH = configPath
    process.chdir(tmpDir)
    delete process.env.TELEGRAM_BOT_TOKEN

    jest.clearAllMocks()
    mockEventOptions.mockReturnValue(['engine_started', 'engine_stopped'])
    mockValidate.mockReturnValue({ valid: true, missingRequired: [], invalidTypes: [], unknownFields: [] })
    mockExtract.mockReturnValue([])
    mockSendTest.mockResolvedValue({ rendered: 'ok', delivered: true })
    mockPrereq.mockReturnValue({ ok: true, missing: [] })
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('returns 400 with "event and template are required" when event is missing', async () => {
    const res = await request(app).post('/telegram/test').send({ template: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('event and template are required')
  })

  test('returns 400 with "event and template are required" when template is missing', async () => {
    const res = await request(app).post('/telegram/test').send({ event: 'engine_started' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('event and template are required')
  })

  test('returns 400 with "unknown event" for unrecognised event names', async () => {
    const res = await request(app).post('/telegram/test').send({ event: 'not_an_event', template: 'hi' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unknown event')
  })

  test('returns 400 with "payload does not match selected event schema" on invalid payload', async () => {
    mockValidate.mockReturnValue({
      valid: false,
      missingRequired: ['sessionId'],
      invalidTypes: [],
      unknownFields: [],
    })
    const res = await request(app)
      .post('/telegram/test')
      .send({ event: 'engine_started', template: 'hi', payload: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('payload does not match selected event schema')
    expect(res.body.schema.missingRequired).toContain('sessionId')
  })

  test('returns 400 with "telegram prerequisites not satisfied" when prereq fails', async () => {
    mockPrereq.mockReturnValue({ ok: false, missing: ['bot_token_missing'] })
    const res = await request(app)
      .post('/telegram/test')
      .send({ event: 'engine_started', template: 'hi', payload: { sessionId: 1 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('telegram prerequisites not satisfied')
    expect(res.body.prerequisites.missing).toContain('bot_token_missing')
  })

  test('returns 200 with rendered message and delivered=true on success', async () => {
    mockSendTest.mockResolvedValue({ rendered: 'rendered text', delivered: true })
    const res = await request(app)
      .post('/telegram/test')
      .send({ event: 'engine_started', template: 'hi {{sessionId}}', payload: { sessionId: 1 } })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.rendered).toBe('rendered text')
    expect(res.body.delivered).toBe(true)
  })

  test('returns 200 with delivered=false when Telegram bot is unreachable', async () => {
    mockSendTest.mockResolvedValue({ rendered: 'rendered text', delivered: false })
    const res = await request(app)
      .post('/telegram/test')
      .send({ event: 'engine_started', template: 'hi', payload: { sessionId: 1 } })
    expect(res.status).toBe(200)
    expect(res.body.delivered).toBe(false)
  })

  test('returns 500 when sendTelegramNotificationTest throws', async () => {
    mockSendTest.mockRejectedValue(new Error('network failure'))
    const res = await request(app)
      .post('/telegram/test')
      .send({ event: 'engine_started', template: 'hi', payload: { sessionId: 1 } })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to send Telegram test notification')
  })

  test('includes missingPlaceholders array in successful response', async () => {
    mockExtract.mockReturnValue(['targetSoc'])
    const res = await request(app)
      .post('/telegram/test')
      .send({ event: 'engine_started', template: 'hi {{targetSoc}}', payload: { sessionId: 1 } })
    expect(res.status).toBe(200)
    expect(res.body.missingPlaceholders).toEqual(['targetSoc'])
  })

  test('timestamp_time and timestamp_date are NOT reported as missing placeholders — regression for false-positive bug', async () => {
    // The route must pass timestamp_time and timestamp_date (via buildTimestampPayload) to
    // extractMissingTemplatePlaceholders so that templates using {{timestamp_time}} or
    // {{timestamp_date}} are never falsely flagged as missing.
    // Real extractMissingTemplatePlaceholders is used here to exercise the actual logic.
    const { extractMissingTemplatePlaceholders: realExtract } = jest.requireActual<typeof import('../../services/notification-rules.service')>('../../services/notification-rules.service')
    mockExtract.mockImplementationOnce(realExtract)

    const res = await request(app)
      .post('/telegram/test')
      .send({
        event: 'engine_started',
        template: '🔌 ora {{timestamp_time}} — data {{timestamp_date}} — sessione {{sessionId}}',
        payload: { sessionId: 1 },
      })
    expect(res.status).toBe(200)
    expect(res.body.missingPlaceholders).not.toContain('timestamp_time')
    expect(res.body.missingPlaceholders).not.toContain('timestamp_date')
    expect(res.body.missingPlaceholders).not.toContain('timestamp')
  })
})
