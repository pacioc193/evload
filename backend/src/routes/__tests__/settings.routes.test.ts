import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import express from 'express'
import request from 'supertest'

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
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

  test('writes token to .env and removes token from config yaml', async () => {
    const app = await createApp()

    await request(app)
      .patch('/')
      .send({ telegramBotToken: 'env-token-value', telegramRules: [] })
      .expect(200)

    const savedConfig = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    expect(savedConfig.telegram.botToken).toBeUndefined()

    const envPath = path.join(tmpDir, '.env')
    const envContent = fs.readFileSync(envPath, 'utf8')
    expect(envContent).toContain('TELEGRAM_BOT_TOKEN=env-token-value')
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
