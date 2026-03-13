import type { EngineStatus } from '../../engine/charging.engine'

const mockSendProxyCommand = jest.fn().mockResolvedValue({})
let mockHaConnected = true
let mockHaPowerW: number = 8450

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    chargingSession: {
      create: jest.fn().mockResolvedValue({ id: 42 }),
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
  vehicleEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../services/ha.service', () => ({
  getHaState: () => ({
    connected: mockHaConnected,
    powerW: mockHaPowerW,
    gridW: null,
    lastUpdated: new Date(),
  }),
  haEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../config', () => ({
  getConfig: () => ({
    demo: false,
    charging: { defaultAmps: 16, maxAmps: 16, minAmps: 5, balancingHoldMinutes: 10, batteryCapacityKwh: 75 },
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

describe('Ramp-up: +1A every 10 seconds', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockSendProxyCommand.mockClear()
    mockHaConnected = true
    mockHaPowerW = 8450
  })

  afterEach(async () => {
    const { stopEngine } = await import('../charging.engine')
    await stopEngine()
    jest.useRealTimers()
    jest.resetModules()
    mockHaConnected = true
    mockHaPowerW = 8450
  })

  test('setpointAmps increases by exactly 1A every 10 seconds during ramp-up', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)

    await jest.advanceTimersByTimeAsync(1_100)
    const afterThrottle = getEngineStatus().setpointAmps
    expect(afterThrottle).toBeLessThanOrEqual(5)

    mockHaConnected = false

    const snapshots: number[] = [getEngineStatus().setpointAmps]

    for (let step = 0; step < 5; step++) {
      await jest.advanceTimersByTimeAsync(10_100)
      snapshots.push(getEngineStatus().setpointAmps)
    }

    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBe(snapshots[i - 1] + 1)
    }
  })

  test('setpointAmps drops immediately on HA throttle without waiting 10s', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)

    await jest.advanceTimersByTimeAsync(1_100)

    const throttled = getEngineStatus().setpointAmps
    expect(throttled).toBeLessThanOrEqual(5)
    expect(throttled).toBeLessThan(16)
  })
})

describe('Throttle: immediate reduction on decrease', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    mockHaConnected = true
    mockHaPowerW = 8450
  })

  afterAll(async () => {
    const { stopEngine } = await import('../charging.engine')
    await stopEngine()
    jest.useRealTimers()
  })

  test('setpointAmps clamps to maxPossible immediately without ramp delay', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80, 16)
    await jest.advanceTimersByTimeAsync(1_100)

    const status: EngineStatus = getEngineStatus()
    expect(status.setpointAmps).toBeLessThanOrEqual(5)
    expect(status.setpointAmps).toBeLessThan(16)
  })
})

