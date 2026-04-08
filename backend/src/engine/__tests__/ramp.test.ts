import type { EngineStatus } from '../../engine/charging.engine'

const mockSendProxyCommand = jest.fn().mockResolvedValue({})
const mockRequestWakeMode = jest.fn().mockResolvedValue(undefined)
let mockHaConnected = true
let mockHaPowerW: number = 8450
let mockHaChargerW: number | null = null
let mockChargeCurrentRequest = 5

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    chargingSession: {
      create: jest.fn().mockResolvedValue({ id: 42, startedAt: new Date('2026-01-01T00:00:00.000Z') }),
      update: jest.fn().mockResolvedValue({}),
    },
    chargingTelemetry: {
      create: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { energyKwh: 0 } }),
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
    connected: true,
    pluggedIn: true,
    charging: true,
    stateOfCharge: 30,
    chargerVoltage: 230,
    chargerActualCurrent: 5,
    chargeCurrentRequest: mockChargeCurrentRequest,
    chargeCurrentRequestMax: 16,
    chargeRateKw: 0,
    chargingState: 'Charging',
    batteryRange: null,
    chargerPilotCurrent: 16,
    chargerPhases: 1,
    timeToFullChargeH: 3,
    insideTempC: 20,
    outsideTempC: 15,
    climateOn: false,
    locked: false,
    odometer: 10000,
    vin: 'RAMPTEST',
    displayName: 'Ramp Test',
  }),
  sendProxyCommand: mockSendProxyCommand,
  requestWakeMode: mockRequestWakeMode,
  vehicleEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../services/ha.service', () => ({
  getHaState: () => ({
    connected: mockHaConnected,
    powerW: mockHaPowerW,
    chargerW: mockHaChargerW,
    lastUpdated: new Date(),
  }),
  haEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../config', () => ({
  getConfig: () => ({
    demo: false,
    charging: { defaultAmps: 16, maxAmps: 16, minAmps: 5, batteryCapacityKwh: 75 },
    homeAssistant: { url: '', powerEntityId: '', maxHomePowerW: 9600, resumeDelaySec: 60 },
    proxy: { vehicleId: 'RAMPTEST', url: '' },
  }),
}), { virtual: true })

jest.mock('../../services/failsafe.service', () => ({
  isFailsafeActive: () => false,
  getFailsafeReason: () => '',
  failsafeEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../services/telegram.service', () => ({
  sendTelegramNotification: jest.fn().mockResolvedValue({}),
}), { virtual: true })

jest.mock('../../services/notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: jest.fn().mockResolvedValue({ delivered: 0, matchedRules: [], messages: [] }),
  notificationEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

describe('F-22 Smart Current Algorithm', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockSendProxyCommand.mockClear()
    mockHaConnected = true
    mockHaPowerW = 8450
    mockHaChargerW = null
    mockChargeCurrentRequest = 5
  })

  afterEach(async () => {
    const { stopEngine } = await import('../charging.engine')
    await stopEngine()
    jest.useRealTimers()
    jest.resetModules()
    mockHaConnected = true
    mockHaPowerW = 8450
    mockHaChargerW = null
  })

  test('formula: homeTotalPowerW=1150 chargerPowerW=1000 vehicleVoltageV=230 actualAmps=5 → setpoint=6', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1_100)
    expect(getEngineStatus().setpointAmps).toBe(5)

    const chargerPowerW = 1000
    const homeTotalPowerW = 1150
    mockHaPowerW = homeTotalPowerW
    mockHaChargerW = chargerPowerW

    await jest.advanceTimersByTimeAsync(10_100)
    expect(getEngineStatus().setpointAmps).toBe(6)
  })

  test('maintains setpoint when home total power is unavailable: F-19 C3, F-22 C5', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1_100)
    const throttled = getEngineStatus().setpointAmps
    expect(throttled).toBeLessThanOrEqual(5)

    mockHaConnected = false
    mockHaChargerW = null

    await jest.advanceTimersByTimeAsync(10_100)
    expect(getEngineStatus().setpointAmps).toBe(throttled)
  })

  test('applies immediate throttle on power reduction without ramp delay: F-19 C1', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1_100)

    const status: EngineStatus = getEngineStatus()
    expect(status.setpointAmps).toBeLessThanOrEqual(5)
    expect(status.setpointAmps).toBeLessThan(16)
  })

  test('resends set_charging_amps when Tesla requested amps drift from evload setpoint', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1_100)

    const setpoint = getEngineStatus().setpointAmps
    expect(setpoint).toBe(5)

    mockSendProxyCommand.mockClear()
    mockChargeCurrentRequest = 4

    await jest.advanceTimersByTimeAsync(10_100)

    expect(mockSendProxyCommand).toHaveBeenCalledWith('RAMPTEST', 'set_charging_amps', { charging_amps: 5 })
  })
})
