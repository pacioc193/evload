import express from 'express'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    demo: false,
    homeAssistant: { url: 'http://ha.local', powerEntityId: 'sensor.power', chargerEntityId: 'sensor.charger', maxHomePowerW: 4000, resumeDelaySec: 30 },
    proxy: { url: 'http://proxy.local', vehicleId: 'VIN1', vehicleName: 'Model Test' },
    charging: { batteryCapacityKwh: 75, energyPriceEurPerKwh: 0.3, defaultAmps: 16, maxAmps: 32, minAmps: 6, rampIntervalSec: 10 },
    telegram: { enabled: false, allowedChatIds: [], notifications: { rules: [] } },
  })),
  reloadConfig: jest.fn(),
}))
jest.mock('../../services/telegram.service', () => ({
  initTelegram: jest.fn(),
  getTelegramPrerequisiteStatus: jest.fn(() => ({ ok: false, missing: ['telegram_disabled'] })),
}))
jest.mock('../../services/notification-rules.service', () => ({
  getNotificationEventOptions: jest.fn(() => ['engine_started']),
  getNotificationPlaceholderCatalog: jest.fn(() => ({ all: [], byEvent: {}, descriptions: {}, presets: {}, schemas: {} })),
  sendTelegramNotificationTest: jest.fn(async () => ({ rendered: 'ok', delivered: false })),
  validateNotificationPayload: jest.fn(() => ({ valid: true, missingRequired: [], invalidTypes: [], unknownFields: [] })),
  extractMissingTemplatePlaceholders: jest.fn(() => []),
}))

describe('settings debug', () => {
  const originalCwd = process.cwd()
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'))
    const configPath = path.join(tmpDir, 'config.yaml')
    fs.writeFileSync(configPath, yaml.dump({ demo: false, telegram: { enabled: false, allowedChatIds: [], notifications: { rules: [] } } }), 'utf8')
    process.env.CONFIG_PATH = configPath
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('createApp with resetModules', async () => {
    jest.resetModules()
    let mod: { default: express.Router } | null = null
    let err: unknown = null
    try {
      mod = await import('../settings.routes')
    } catch (e) {
      err = e
    }
    if (err) {
      console.error('Import failed:', err)
    }
    expect(err).toBeNull()
    expect(mod).not.toBeNull()
    
    const app = express()
    app.use(express.json())
    app.use('/', mod!.default)
    
    const res = await request(app).patch('/').send({ vehicleName: 'My EV' })
    console.log('Status:', res.status, 'Body:', JSON.stringify(res.body))
    expect(res.status).toBe(200)
  })
})
