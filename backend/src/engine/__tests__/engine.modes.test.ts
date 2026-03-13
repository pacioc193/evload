const mockSendProxyCommand = jest.fn().mockResolvedValue({})

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    chargingSession: {
      create: jest.fn().mockResolvedValue({ id: 99 }),
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
    connected: true, pluggedIn: true, charging: false, stateOfCharge: 50,
    chargerVoltage: 230, chargerActualCurrent: 0, chargeRateKw: 0,
    chargingState: 'Disconnected', batteryRange: null, chargerPilotCurrent: 0,
    chargerPhases: 1, timeToFullChargeH: null, insideTempC: 20, outsideTempC: 15,
    climateOn: false, locked: false, odometer: 10000, vin: 'MODETEST', displayName: 'Mode Test',
  }),
  sendProxyCommand: mockSendProxyCommand,
  vehicleEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../services/ha.service', () => ({
  getHaState: () => ({ connected: false, powerW: null, gridW: null, lastUpdated: new Date() }),
  haEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../config', () => ({
  getConfig: () => ({
    demo: false,
    charging: { defaultAmps: 16, maxAmps: 32, minAmps: 5, balancingHoldMinutes: 10, batteryCapacityKwh: 75 },
    homeAssistant: { url: '', powerEntityId: '', maxHomePowerW: 0, resumeDelaySec: 60 },
    proxy: { vehicleId: 'MODETEST', url: '' },
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

describe('F-18: Plan vs On vs Off distinct engine modes', () => {
  afterEach(async () => {
    const { stopEngine } = await import('../charging.engine')
    await stopEngine()
    jest.resetModules()
  })

  test('"plan" mode does NOT start the engine — running=false, mode="plan"', async () => {
    const { setPlanMode, getEngineStatus } = await import('../charging.engine')

    setPlanMode(80)

    const status = getEngineStatus()
    expect(status.running).toBe(false)
    expect(status.mode).toBe('plan')
    expect(status.targetSoc).toBe(80)
  })

  test('"on" mode (startEngine) starts engine — running=true, mode="on"', async () => {
    const { startEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80)

    const status = getEngineStatus()
    expect(status.running).toBe(true)
    expect(status.mode).toBe('on')
  })

  test('"off" mode (stopEngine) stops engine — running=false, mode="off"', async () => {
    const { startEngine, stopEngine, getEngineStatus } = await import('../charging.engine')

    await startEngine(80)
    expect(getEngineStatus().running).toBe(true)

    await stopEngine()

    const status = getEngineStatus()
    expect(status.running).toBe(false)
    expect(status.mode).toBe('off')
  })

  test('switching from "plan" to "on" starts engine immediately', async () => {
    const { setPlanMode, startEngine, getEngineStatus } = await import('../charging.engine')

    setPlanMode(80)
    expect(getEngineStatus().running).toBe(false)
    expect(getEngineStatus().mode).toBe('plan')

    await startEngine(80)
    expect(getEngineStatus().running).toBe(true)
    expect(getEngineStatus().mode).toBe('on')
  })
})
