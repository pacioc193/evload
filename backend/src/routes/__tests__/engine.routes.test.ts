import express from 'express'
import request from 'supertest'

const mockStartEngine = jest.fn().mockResolvedValue(undefined)
const mockStopEngine = jest.fn().mockResolvedValue(undefined)
const mockGetEngineStatus = jest.fn(() => ({ running: false, mode: 'off' }))
const mockSetPlanMode = jest.fn()
const mockRequestWakeMode = jest.fn().mockResolvedValue(undefined)
const mockTriggerImmediatePoll = jest.fn().mockResolvedValue(undefined)
const mockDispatchTelegramNotificationEvent = jest.fn().mockResolvedValue({ delivered: 0 })
const mockGetNotificationEventOptions = jest.fn(() => ['engine_started'])
const mockValidateNotificationPayload = jest.fn((_event: string, _payload: Record<string, unknown>) => ({ valid: true }))
const mockLoggerInfo = jest.fn()
const mockLoggerWarn = jest.fn()
const mockLoggerError = jest.fn()

let mockStopChargeOnManualStart = false
let mockFailsafeActive = false
let mockFailsafeReason = 'failsafe reason'

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

jest.mock('../../engine/charging.engine', () => ({
  getEngineStatus: () => mockGetEngineStatus(),
  startEngine: (...args: unknown[]) => mockStartEngine(...args),
  stopEngine: (...args: unknown[]) => mockStopEngine(...args),
  setPlanMode: (...args: unknown[]) => mockSetPlanMode(...args),
}))

jest.mock('../../services/proxy.service', () => ({
  requestWakeMode: (...args: unknown[]) => mockRequestWakeMode(...args),
  triggerImmediatePoll: (...args: unknown[]) => mockTriggerImmediatePoll(...args),
}))

jest.mock('../../services/failsafe.service', () => ({
  isFailsafeActive: () => mockFailsafeActive,
  getFailsafeReason: () => mockFailsafeReason,
  resetFailsafe: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../services/notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: (event: string, payload?: Record<string, unknown>) =>
    mockDispatchTelegramNotificationEvent(event, payload),
  getNotificationEventOptions: () => mockGetNotificationEventOptions(),
  validateNotificationPayload: (event: string, payload: Record<string, unknown>) =>
    mockValidateNotificationPayload(event, payload),
}))

jest.mock('../../logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}))

jest.mock('../../config', () => ({
  getConfig: () => ({
    charging: {
      stopChargeOnManualStart: mockStopChargeOnManualStart,
    },
  }),
}))

describe('engine routes start decisions', () => {
  async function createApp() {
    const module = await import('../engine.routes')
    const app = express()
    app.use(express.json())
    app.use('/', module.default)
    return app
  }

  beforeEach(() => {
    mockStopChargeOnManualStart = false
    mockFailsafeActive = false
    mockFailsafeReason = 'failsafe reason'
    mockStartEngine.mockClear()
    mockStopEngine.mockClear()
    mockGetEngineStatus.mockClear()
    mockTriggerImmediatePoll.mockClear()
    mockLoggerInfo.mockClear()
    mockLoggerWarn.mockClear()
    mockLoggerError.mockClear()
  })

  test('interrupts manual start when stopChargeOnManualStart is enabled', async () => {
    mockStopChargeOnManualStart = true
    const app = await createApp()

    const res = await request(app)
      .post('/start')
      .send({ targetSoc: 80, targetAmps: 16 })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.interrupted).toBe(true)
    expect(mockStopEngine).toHaveBeenCalledWith()
    expect(mockStartEngine).not.toHaveBeenCalled()
    expect(mockTriggerImmediatePoll).toHaveBeenCalled()
    expect(mockLoggerInfo).toHaveBeenCalledWith('ENGINE_START_REQUEST', expect.objectContaining({
      targetSoc: 80,
      targetAmps: 16,
      stopChargeOnManualStart: true,
      failsafeActive: false,
    }))
    expect(mockLoggerWarn).toHaveBeenCalledWith('ENGINE_START_DECISION_INTERRUPTED', expect.objectContaining({
      reason: 'stopChargeOnManualStart_enabled',
    }))
  })

  test('blocks start when failsafe is active', async () => {
    mockFailsafeActive = true
    mockFailsafeReason = 'Vehicle proxy disconnected'
    const app = await createApp()

    const res = await request(app)
      .post('/start')
      .send({ targetSoc: 85, targetAmps: 13 })
      .expect(503)

    expect(res.body.error).toBe('Failsafe active')
    expect(mockStopEngine).not.toHaveBeenCalled()
    expect(mockStartEngine).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledWith('ENGINE_START_DECISION_BLOCKED', expect.objectContaining({
      reason: 'failsafe_active',
      failsafeReason: 'Vehicle proxy disconnected',
      targetSoc: 85,
      targetAmps: 13,
    }))
  })

  test('accepts valid start requests when no guard blocks them', async () => {
    const app = await createApp()

    const res = await request(app)
      .post('/start')
      .send({ targetSoc: 78, targetAmps: 10 })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(mockStartEngine).toHaveBeenCalledWith(78, 10)
    expect(mockTriggerImmediatePoll).toHaveBeenCalled()
    expect(mockLoggerInfo).toHaveBeenCalledWith('ENGINE_START_DECISION_ACCEPTED', expect.objectContaining({
      reason: 'manual_or_plan_request',
      targetSoc: 78,
      targetAmps: 10,
    }))
  })
})