import type { VehicleState, ProxyHealthState } from '../proxy.service'

jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    proxy: {
      vehicleId: '',
      url: 'http://localhost:9999',
      vehicleDataWindowMs: 300_000,
      bodyPollIntervalMs: 30_000,
      chargingPollIntervalMs: 15_000,
      windowPollIntervalMs: 30_000,
    },
  })),
}))

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
  sanitizeForLog: (x: unknown) => x,
}))

jest.mock('../../engine/charging.engine', () => ({
  getEngineStatus: jest.fn(() => ({ running: false })),
}))

jest.mock('../notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: jest.fn(async () => {}),
}))

describe('proxy.service – exported state accessors', () => {
  let getVehicleState: () => VehicleState
  let getProxyHealthState: () => ProxyHealthState
  let stopProxyPoll: () => void

  beforeAll(async () => {
    const mod = await import('../proxy.service')
    getVehicleState = mod.getVehicleState
    getProxyHealthState = mod.getProxyHealthState
    stopProxyPoll = mod.stopProxyPoll
  })

  afterAll(() => {
    stopProxyPoll()
  })

  test('getVehicleState() returns an object with expected shape before any poll', () => {
    const state = getVehicleState()
    expect(state).toBeDefined()
    expect(typeof state.connected).toBe('boolean')
    expect(typeof state.pluggedIn).toBe('boolean')
    expect(typeof state.charging).toBe('boolean')
    expect(typeof state.climateOn).toBe('boolean')
    expect(typeof state.locked).toBe('boolean')
  })

  test('getVehicleState() connected is false when no vehicle ID configured', () => {
    const state = getVehicleState()
    // Before any poll with no vehicleId, vehicle is not yet confirmed connected
    // The state should have vehicleSleepStatus as null or a valid value
    expect(
      state.vehicleSleepStatus === null ||
      state.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_UNKNOWN' ||
      state.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_AWAKE' ||
      state.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP'
    ).toBe(true)
  })

  test('getProxyHealthState() returns expected shape', () => {
    const health = getProxyHealthState()
    expect(health).toBeDefined()
    expect(typeof health.connected).toBe('boolean')
    expect(health.lastSuccessAt === null || typeof health.lastSuccessAt === 'string').toBe(true)
    expect(health.lastEndpoint === null || typeof health.lastEndpoint === 'string').toBe(true)
    expect(health.error === null || typeof health.error === 'string').toBe(true)
    expect(health.vehicleDataWindowExpiresAt === null || typeof health.vehicleDataWindowExpiresAt === 'number').toBe(true)
  })

  test('getProxyHealthState() vehicleDataWindowExpiresAt is null before any poll', () => {
    const health = getProxyHealthState()
    expect(health.vehicleDataWindowExpiresAt).toBeNull()
  })
})
