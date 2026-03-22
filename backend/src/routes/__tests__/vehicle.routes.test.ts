import express from 'express'
import request from 'supertest'

const mockGetVehicleState = jest.fn(() => ({ connected: true }))
const mockSendProxyCommand = jest.fn(async () => ({ result: true }))
const mockUpdateProxyDataRequest = jest.fn(async () => ({ result: true }))
const mockIsFailsafeActive = jest.fn(() => false)
const mockGetConfig = jest.fn(() => ({ proxy: { vehicleId: 'VIN-TEST-1' } }))

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

jest.mock('../../services/proxy.service', () => ({
  getVehicleState: mockGetVehicleState,
  sendProxyCommand: mockSendProxyCommand,
  updateProxyDataRequest: mockUpdateProxyDataRequest,
}))

jest.mock('../../services/failsafe.service', () => ({
  isFailsafeActive: () => mockIsFailsafeActive(),
}))

jest.mock('../../config', () => ({
  getConfig: () => mockGetConfig(),
}))

describe('vehicle routes', () => {
  async function createApp() {
    jest.resetModules()
    const module = await import('../vehicle.routes')
    const app = express()
    app.use(express.json())
    app.use('/', module.default)
    return app
  }

  beforeEach(() => {
    mockGetVehicleState.mockClear()
    mockSendProxyCommand.mockClear()
    mockUpdateProxyDataRequest.mockClear()
    mockIsFailsafeActive.mockReset()
    mockIsFailsafeActive.mockReturnValue(false)
    mockGetConfig.mockReset()
    mockGetConfig.mockReturnValue({ proxy: { vehicleId: 'VIN-TEST-1' } })
  })

  test('PUT /data-request/charge_state forwards payload to proxy service', async () => {
    const app = await createApp()

    const payload = {
      battery_level: 73,
      charging_state: 'Connected',
      charger_voltage: 230,
      charger_actual_current: 0,
      charger_pilot_current: 16,
      charger_phases: 1,
      plugged_in: false,
    }

    const res = await request(app)
      .put('/data-request/charge_state')
      .send(payload)
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(mockUpdateProxyDataRequest).toHaveBeenCalledWith('VIN-TEST-1', 'charge_state', payload)
  })

  test('PUT /data-request/climate_state forwards payload to proxy service', async () => {
    const app = await createApp()

    const payload = {
      inside_temp: 20,
      outside_temp: 7,
      is_climate_on: true,
    }

    await request(app)
      .put('/data-request/climate_state')
      .send(payload)
      .expect(200)

    expect(mockUpdateProxyDataRequest).toHaveBeenCalledWith('VIN-TEST-1', 'climate_state', payload)
  })

  test('PUT /data-request rejects invalid section', async () => {
    const app = await createApp()

    const res = await request(app)
      .put('/data-request/vehicle_state')
      .send({})
      .expect(400)

    expect(res.body.error).toContain('Invalid section')
    expect(mockUpdateProxyDataRequest).not.toHaveBeenCalled()
  })

  test('PUT /data-request fails when vehicleId missing', async () => {
    mockGetConfig.mockReturnValue({ proxy: { vehicleId: '' } })
    const app = await createApp()

    const res = await request(app)
      .put('/data-request/charge_state')
      .send({ battery_level: 50 })
      .expect(400)

    expect(res.body.error).toContain('No vehicle ID configured')
    expect(mockUpdateProxyDataRequest).not.toHaveBeenCalled()
  })

  test('POST /command is blocked when failsafe is active', async () => {
    mockIsFailsafeActive.mockReturnValue(true)
    const app = await createApp()

    const res = await request(app)
      .post('/command/charge_start')
      .send({})
      .expect(503)

    expect(res.body.error).toContain('Failsafe active')
    expect(mockSendProxyCommand).not.toHaveBeenCalled()
  })
})
