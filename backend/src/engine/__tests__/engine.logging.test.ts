export {}

const mockSendProxyCommand = jest.fn().mockResolvedValue({})
const mockRequestWakeMode = jest.fn().mockResolvedValue(undefined)
const mockDispatchTelegramNotificationEvent = jest.fn().mockResolvedValue({ delivered: 0, matchedRules: [], messages: [] })
const mockLoggerInfo = jest.fn()
const mockLoggerWarn = jest.fn()
const mockLoggerError = jest.fn()

let mockStateOfCharge = 52
let mockCharging = true
let mockConnected = true
let mockChargeRateKw = 3.68
let mockActualCurrent = 16

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    chargingSession: {
      create: jest.fn().mockResolvedValue({ id: 321 }),
      update: jest.fn().mockResolvedValue({}),
    },
    chargingTelemetry: {
      create: jest.fn().mockResolvedValue({}),
    },
    appConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  })),
}))

jest.mock('node-telegram-bot-api', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue({}),
    stopPolling: jest.fn().mockResolvedValue({}),
  }))
)

jest.mock('../../services/proxy.service', () => ({
  getVehicleState: () => ({
    connected: mockConnected,
    pluggedIn: true,
    rawChargeState: { charge_energy_added: 1.8 },
    charging: mockCharging,
    stateOfCharge: mockStateOfCharge,
    chargerVoltage: 230,
    chargerActualCurrent: mockActualCurrent,
    chargeRateKw: mockChargeRateKw,
    chargingState: mockCharging ? 'Charging' : 'Stopped',
    batteryRange: null,
    chargerPilotCurrent: 16,
    chargerPhases: 1,
    timeToFullChargeH: 2.5,
    insideTempC: 20,
    outsideTempC: 15,
    climateOn: false,
    locked: false,
    odometer: 10000,
    vin: 'LOGTEST',
    displayName: 'Log Test',
  }),
  sendProxyCommand: (...args: unknown[]) => mockSendProxyCommand(...args),
  requestWakeMode: (...args: unknown[]) => mockRequestWakeMode(...args),
  vehicleEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../services/ha.service', () => ({
  getHaState: () => ({
    connected: true,
    powerW: 4600,
    chargerW: 3680,
    lastUpdated: new Date(),
  }),
  haEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../config', () => ({
  getConfig: () => ({
    demo: false,
    charging: {
      defaultAmps: 16,
      maxAmps: 32,
      minAmps: 5,
      batteryCapacityKwh: 75,
      energyPriceEurPerKwh: 0.4,
      chargeStartRetryMs: 10000,
      rampIntervalSec: 10,
    },
    homeAssistant: {
      url: '',
      powerEntityId: '',
      chargerEntityId: '',
      maxHomePowerW: 7000,
      resumeDelaySec: 60,
    },
    proxy: { vehicleId: 'LOGTEST', vehicleName: 'Log Test', url: '' },
  }),
}), { virtual: true })

jest.mock('../../services/failsafe.service', () => ({
  isFailsafeActive: () => false,
}), { virtual: true })

jest.mock('../../services/notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: (...args: unknown[]) => mockDispatchTelegramNotificationEvent(...args),
  notificationEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}))

describe('engine diagnostic logging', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockStateOfCharge = 52
    mockCharging = true
    mockConnected = true
    mockChargeRateKw = 3.68
    mockActualCurrent = 16
    mockSendProxyCommand.mockClear()
    mockRequestWakeMode.mockClear()
    mockDispatchTelegramNotificationEvent.mockClear()
    mockLoggerInfo.mockClear()
    mockLoggerWarn.mockClear()
    mockLoggerError.mockClear()
  })

  afterEach(async () => {
    const module = await import('../charging.engine')
    await module.stopEngine({ forceOff: true })
    jest.useRealTimers()
    jest.resetModules()
  })

  test('emits charging phase transition on first charging tick', async () => {
    const module = await import('../charging.engine')

    await module.startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1200)

    expect(mockLoggerInfo).toHaveBeenCalledWith('ENGINE_PHASE_TRANSITION', expect.objectContaining({
      sessionId: 321,
      from: 'idle',
      to: 'charging',
      reason: 'vehicle_is_charging',
    }))
  })

  test('throttles engine health snapshots to one every 30 seconds', async () => {
    const module = await import('../charging.engine')

    await module.startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1200)

    const snapshotsAfterFirstTick = mockLoggerInfo.mock.calls.filter((call) => call[0] === 'ENGINE_HEALTH_SNAPSHOT')
    expect(snapshotsAfterFirstTick).toHaveLength(1)

    await jest.advanceTimersByTimeAsync(5000)
    const snapshotsBeforeWindow = mockLoggerInfo.mock.calls.filter((call) => call[0] === 'ENGINE_HEALTH_SNAPSHOT')
    expect(snapshotsBeforeWindow).toHaveLength(1)

    await jest.advanceTimersByTimeAsync(30000)
    const snapshotsAfterWindow = mockLoggerInfo.mock.calls.filter((call) => call[0] === 'ENGINE_HEALTH_SNAPSHOT')
    expect(snapshotsAfterWindow).toHaveLength(2)
    expect(snapshotsAfterWindow[1][1]).toEqual(expect.objectContaining({
      sessionId: 321,
      phase: 'charging',
      mode: 'on',
      soc: 52,
      actualAmps: 16,
      targetAmps: 16,
      haConnected: true,
      haThrottled: false,
      failsafeActive: false,
    }))
  })
})