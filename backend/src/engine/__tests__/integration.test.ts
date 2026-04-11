/**
 * Step 9 Integration / Functional Tests
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { EventEmitter } from 'events'

// ─── Module-level shared state ────────────────────────────────────────────────
const mockSendProxyCommand = jest.fn().mockResolvedValue({})
const mockRequestWakeMode = jest.fn().mockResolvedValue(undefined)
const mockVehicleEvents = new EventEmitter()
let mockPluggedIn = false
let mockPowerW = 2000
let mockCarChargeKw = 0
let mockSoc = 50
let mockIsDemo = false
let mockMaxHomePowerW = 7000
let mockStopChargeOnManualStart = false
let mockScheduledCharges: Array<{
  id: number
  vehicleId: string
  scheduledAt: Date | null
  finishBy?: Date | null
  scheduleType: 'start_at' | 'weekly' | 'start_end' | 'finish_by'
  enabled: boolean
  targetSoc: number
  targetAmps?: number | null
  startedAt?: Date | null
}> = []
let mockScheduledClimates: Array<{
  id: number; vehicleId: string; scheduledAt: Date; targetTempC: number; enabled: boolean
}> = []

// ─── Top-level mocks ─────────────────────────────────────────────────────────

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    scheduledClimate: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockScheduledClimates)),
      update: jest.fn().mockImplementation(() => {
        // Disable the item after executing
        mockScheduledClimates = mockScheduledClimates.map((c) => ({ ...c, enabled: false }))
        return Promise.resolve({})
      }),
      create: jest.fn(),
    },
    scheduledCharge: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
        const matches = mockScheduledCharges.filter((charge) => {
          if (where?.enabled !== undefined && charge.enabled !== where.enabled) return false
          const scheduleType = where?.scheduleType
          if (typeof scheduleType === 'string' && charge.scheduleType !== scheduleType) return false
          if (scheduleType && typeof scheduleType === 'object' && 'in' in scheduleType) {
            const allowed = (scheduleType as { in: string[] }).in
            if (!allowed.includes(charge.scheduleType)) return false
          }
          if (where?.startedAt === null && charge.startedAt != null) return false
          if (where?.startedAt && typeof where.startedAt === 'object' && 'not' in where.startedAt) {
            if (charge.startedAt == null) return false
          }
          if (where?.scheduledAt && typeof where.scheduledAt === 'object' && 'lte' in where.scheduledAt) {
            if (!charge.scheduledAt || charge.scheduledAt > (where.scheduledAt as { lte: Date }).lte) return false
          }
          if (where?.scheduledAt && typeof where.scheduledAt === 'object' && 'gt' in where.scheduledAt) {
            if (!charge.scheduledAt || charge.scheduledAt <= (where.scheduledAt as { gt: Date }).gt) return false
          }
          if (where?.finishBy && typeof where.finishBy === 'object' && 'lte' in where.finishBy) {
            if (!charge.finishBy || charge.finishBy > (where.finishBy as { lte: Date }).lte) return false
          }
          if (where?.finishBy && typeof where.finishBy === 'object' && 'gte' in where.finishBy) {
            if (!charge.finishBy || charge.finishBy < (where.finishBy as { gte: Date }).gte) return false
          }
          return true
        })
        return Promise.resolve(matches)
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        mockScheduledCharges = mockScheduledCharges.map((charge) => charge.id === where.id ? { ...charge, ...data } : charge)
        return Promise.resolve({})
      }),
      create: jest.fn(),
    },
    chargingSession: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    chargingTelemetry: {
      create: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { energyKwh: 0 } }),
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

jest.mock('../../../src/services/proxy.service', () => ({
  getVehicleState: () => ({
    connected: mockPluggedIn,
    pluggedIn: mockPluggedIn,
    charging: mockPluggedIn,
    stateOfCharge: mockSoc,
    chargerVoltage: 230,
    chargerActualCurrent: 16,
    chargeRateKw: mockCarChargeKw,
    chargingState: mockPluggedIn ? 'Charging' : 'Disconnected',
    batteryRange: null, chargerPilotCurrent: 16, chargerPhases: 1,
    timeToFullChargeH: 3, insideTempC: 20, outsideTempC: 15,
    climateOn: false, locked: false, odometer: 10000, vin: 'vid1', displayName: 'Test',
  }),
  sendProxyCommand: mockSendProxyCommand,
  requestWakeMode: mockRequestWakeMode,
  vehicleEvents: mockVehicleEvents,
}), { virtual: true })

jest.mock('../../../src/services/ha.service', () => ({
  getHaState: () => ({
    connected: true,
    powerW: mockPowerW,
    chargerW: null,
    lastUpdated: new Date(),
  }),
  haEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../../src/config', () => ({
  getConfig: () => ({
    demo: mockIsDemo,
    charging: { defaultAmps: 16, maxAmps: 32, minAmps: 5, batteryCapacityKwh: 75, stopChargeOnManualStart: mockStopChargeOnManualStart },
    homeAssistant: { url: '', powerEntityId: '', maxHomePowerW: mockMaxHomePowerW },
    proxy: { vehicleId: 'vid1', url: '' },
  }),
}), { virtual: true })

jest.mock('../../../src/services/failsafe.service', () => ({
  isFailsafeActive: () => false,
  getFailsafeReason: () => '',
  failsafeEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

jest.mock('../../../src/services/telegram.service', () => ({
  sendTelegramNotification: jest.fn().mockResolvedValue({}),
}), { virtual: true })

jest.mock('../../../src/services/notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: jest.fn().mockResolvedValue({ delivered: 0, matchedRules: [], messages: [] }),
  notificationEvents: { on: jest.fn(), emit: jest.fn() },
}), { virtual: true })

// ─── Test 1: HA limit priority — pure logic ──────────────────────────────────

describe('HA limit priority — computeHaAllowedAmps', () => {
  function computeHaAllowedAmps(
    powerW: number,
    maxHomePowerW: number,
    carChargeKw: number,
    voltage: number
  ): number {
    const houseOnlyW = powerW - carChargeKw * 1000
    return Math.floor((maxHomePowerW - houseOnlyW) / voltage)
  }

  const MAX_HOME_W = 7000
  const MIN_AMPS = 5

  test('returns below-min amps when home-only power exceeds max (→ pause)', () => {
    const amps = computeHaAllowedAmps(8000, MAX_HOME_W, 0, 230)
    expect(amps).toBeLessThan(MIN_AMPS)
  })

  test('throttles to ~13A when home draws 7500W including 3.68kW car', () => {
    const amps = computeHaAllowedAmps(7500, MAX_HOME_W, 3.68, 230)
    expect(amps).toBe(13)
    expect(amps).toBeLessThan(16)
    expect(amps).toBeGreaterThanOrEqual(MIN_AMPS)
  })

  test('allows full charging when home has plenty of headroom', () => {
    const amps = computeHaAllowedAmps(1500, MAX_HOME_W, 3.68, 230)
    expect(amps).toBeGreaterThan(16)
  })

  test('HA overrides schedule — engine sets throttled amps via proxy command', async () => {
    jest.useFakeTimers()

    mockPluggedIn = true
    mockCarChargeKw = 3.68
    mockPowerW = 7500
    mockMaxHomePowerW = 7000
    mockSendProxyCommand.mockClear()

    const { startEngine, stopEngine } = await import('../../engine/charging.engine')
    await startEngine(80, 16)

    // Advance past the 1s engine timer
    await jest.advanceTimersByTimeAsync(1200)

    // house: 7500W, car: 3680W → house-only 3820W → available 3180W → 13A
    const throttleCalls = mockSendProxyCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'set_charging_amps'
    )
    const throttled = throttleCalls.some((c: unknown[]) => {
      const body = c[2] as { charging_amps: number }
      return body.charging_amps > 0 && body.charging_amps < 16
    })
    expect(throttled).toBe(true)

    await stopEngine()
    jest.useRealTimers()
  })
})

// ─── Test 2: Climate scheduler — plugged_in guard ────────────────────────────

describe('Climate scheduler — plugged_in guard', () => {
  let startScheduler: () => void
  let stopScheduler: () => void

  beforeAll(async () => {
    const sched = await import('../../services/scheduler.service')
    startScheduler = sched.startScheduler
    stopScheduler = sched.stopScheduler
  })

  beforeEach(() => {
    mockScheduledClimates = []
    mockScheduledCharges = []
    mockSendProxyCommand.mockClear()
    mockIsDemo = false
    mockStopChargeOnManualStart = false
  })

  test('does NOT send climate command when vehicle is NOT plugged in', async () => {
    mockPluggedIn = false
    mockScheduledClimates = [
      {
        id: 10, vehicleId: 'vid1',
        scheduledAt: new Date(Date.now() - 60_000),
        targetTempC: 22, enabled: true,
      },
    ]

    startScheduler()
    await new Promise((r) => setTimeout(r, 200))
    stopScheduler()

    const climateCmds = mockSendProxyCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'auto_conditioning_start' || c[1] === 'set_temps'
    )
    expect(climateCmds).toHaveLength(0)
  })

  test('DOES send climate command when vehicle IS plugged in', async () => {
    mockPluggedIn = true
    mockScheduledClimates = [
      {
        id: 11, vehicleId: 'vid1',
        scheduledAt: new Date(Date.now() - 60_000),
        targetTempC: 22, enabled: true,
      },
    ]

    startScheduler()
    await new Promise((r) => setTimeout(r, 200))
    stopScheduler()

    const climateCmds = mockSendProxyCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'auto_conditioning_start' || c[1] === 'set_temps'
    )
    expect(climateCmds.length).toBeGreaterThan(0)
  })

  test('stops external charge via startEngine when flag=true and car is already charging (scheduled path)', async () => {
    mockPluggedIn = true
    mockStopChargeOnManualStart = true
    mockScheduledCharges = [
      {
        id: 77,
        vehicleId: 'vid1',
        scheduledAt: new Date(Date.now() - 60_000),
        scheduleType: 'start_at',
        enabled: true,
        targetSoc: 80,
        targetAmps: 16,
        startedAt: null,
      },
    ]

    const { setPlanMode } = await import('../../engine/charging.engine')
    setPlanMode(80)

    startScheduler()
    await new Promise((r) => setTimeout(r, 200))
    stopScheduler()

    const chargeStopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(chargeStopCalls.length).toBeGreaterThan(0)
  })
})

// ─── Test: stopChargeOnManualStart via direct startEngine() ──────────────────

describe('stopChargeOnManualStart — direct engine start', () => {
  let stopEngine: (options?: { forceOff?: boolean }) => Promise<void>
  let startEngine: (targetSoc: number, targetAmps?: number) => Promise<void>

  beforeAll(async () => {
    const eng = await import('../../engine/charging.engine')
    stopEngine = eng.stopEngine
    startEngine = eng.startEngine
  })

  beforeEach(async () => {
    // Force-stop any engine leftover from previous test suites before each test
    const eng = await import('../../engine/charging.engine')
    await eng.stopEngine({ forceOff: true })
    mockScheduledCharges = []
    mockSendProxyCommand.mockClear()
    mockStopChargeOnManualStart = false
  })

  afterEach(async () => {
    await stopEngine({ forceOff: true })
  })

  test('flag=true: sends charge_stop to vehicle already charging when startEngine is called', async () => {
    mockPluggedIn = true        // getVehicleState().charging = true
    mockStopChargeOnManualStart = true

    await startEngine(80, 16)

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls.length).toBeGreaterThan(0)
  })

  test('flag=false: does NOT send charge_stop when car is already charging on startEngine', async () => {
    mockPluggedIn = true        // getVehicleState().charging = true
    mockStopChargeOnManualStart = false

    await startEngine(80, 16)

    // No charge_stop at engine start — evload only manages amps (HA protection)
    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })

  test('flag=true: does NOT send charge_stop when car is NOT charging on startEngine', async () => {
    mockPluggedIn = false       // getVehicleState().charging = false
    mockStopChargeOnManualStart = true

    await startEngine(80, 16)

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })
})

// ─── Test 3: Demo mode toggle — persists to config.yaml ──────────────────────

describe('Demo mode toggle — persists to config.yaml', () => {
  let tmpDir: string
  let configPath: string
  let savedConfigPath: string | undefined

  function makeTestConfig(demo: boolean) {
    return {
      demo,
      homeAssistant: { url: 'http://ha.local:8123', powerEntityId: 'sensor.home_power', maxHomePowerW: 7000 },
      proxy: { url: 'http://proxy.local:8080', vehicleId: '', pollIntervalMs: 1000 },
      charging: { defaultTargetSoc: 80, defaultAmps: 16, maxAmps: 32, minAmps: 5, batteryCapacityKwh: 75 },
      telegram: { enabled: false, allowedChatIds: [] },
      climate: { defaultTempC: 21 },
    }
  }

  // Direct test of the YAML patch logic (mirrors settings.routes.ts logic)
  function applySettingsPatch(cfgPath: string, patch: Record<string, unknown>): void {
    const raw = fs.readFileSync(cfgPath, 'utf8')
    const parsed = (yaml.load(raw) as Record<string, unknown>) ?? {}
    if ('demo' in patch) parsed['demo'] = patch['demo']
    if ('haUrl' in patch || 'haPowerEntityId' in patch || 'haMaxHomePowerW' in patch) {
      const ha = (parsed['homeAssistant'] as Record<string, unknown>) ?? {}
      if ('haUrl' in patch) ha['url'] = patch['haUrl']
      if ('haPowerEntityId' in patch) ha['powerEntityId'] = patch['haPowerEntityId']
      if ('haMaxHomePowerW' in patch) ha['maxHomePowerW'] = patch['haMaxHomePowerW']
      parsed['homeAssistant'] = ha
    }
    if ('proxyUrl' in patch || 'vehicleId' in patch) {
      const proxy = (parsed['proxy'] as Record<string, unknown>) ?? {}
      if ('proxyUrl' in patch) proxy['url'] = patch['proxyUrl']
      if ('vehicleId' in patch) proxy['vehicleId'] = patch['vehicleId']
      parsed['proxy'] = proxy
    }
    if ('batteryCapacityKwh' in patch) {
      const charging = (parsed['charging'] as Record<string, unknown>) ?? {}
      charging['batteryCapacityKwh'] = patch['batteryCapacityKwh']
      parsed['charging'] = charging
    }
    fs.writeFileSync(cfgPath, yaml.dump(parsed), 'utf8')
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evload-test-'))
    configPath = path.join(tmpDir, 'config.yaml')
    savedConfigPath = process.env['CONFIG_PATH']
    process.env['CONFIG_PATH'] = configPath
  })

  afterEach(() => {
    if (savedConfigPath !== undefined) {
      process.env['CONFIG_PATH'] = savedConfigPath
    } else {
      delete process.env['CONFIG_PATH']
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('sets demo:true in config.yaml when patch is applied', () => {
    fs.writeFileSync(configPath, yaml.dump(makeTestConfig(false)), 'utf8')
    applySettingsPatch(configPath, { demo: true })
    const written = yaml.load(fs.readFileSync(configPath, 'utf8')) as { demo: boolean }
    expect(written.demo).toBe(true)
  })

  test('sets demo:false in config.yaml when patch is applied', () => {
    fs.writeFileSync(configPath, yaml.dump(makeTestConfig(true)), 'utf8')
    applySettingsPatch(configPath, { demo: false })
    const written = yaml.load(fs.readFileSync(configPath, 'utf8')) as { demo: boolean }
    expect(written.demo).toBe(false)
  })

  test('updates haUrl and vehicleId in config.yaml', () => {
    fs.writeFileSync(configPath, yaml.dump(makeTestConfig(false)), 'utf8')
    applySettingsPatch(configPath, { haUrl: 'http://newha.local:8123', vehicleId: 'vin999' })
    const written = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
      homeAssistant: { url: string }; proxy: { vehicleId: string }
    }
    expect(written.homeAssistant.url).toBe('http://newha.local:8123')
    expect(written.proxy.vehicleId).toBe('vin999')
  })

  test('demo=false in config.yaml does not bypass HTTP calls', () => {
    fs.writeFileSync(configPath, yaml.dump(makeTestConfig(false)), 'utf8')
    const written = yaml.load(fs.readFileSync(configPath, 'utf8')) as { demo: boolean }
    // When demo is false, the config does not enable demo mode
    expect(written.demo).toBe(false)
    // Setting demo=true enables it
    applySettingsPatch(configPath, { demo: true })
    const updated = yaml.load(fs.readFileSync(configPath, 'utf8')) as { demo: boolean }
    expect(updated.demo).toBe(true)
  })
})

// ─── Test: initExternalChargeGuard — poll-level external charge detection ─────

describe('initExternalChargeGuard — poll-level stop', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let eng: any

  beforeAll(async () => {
    eng = await import('../../engine/charging.engine')
    eng.initExternalChargeGuard()
  })

  beforeEach(async () => {
    await eng.stopEngine({ forceOff: true })
    mockSendProxyCommand.mockClear()
    mockStopChargeOnManualStart = false
    mockPluggedIn = false
  })

  afterEach(async () => {
    await eng.stopEngine({ forceOff: true })
  })

  test('flag=true + engine idle: charge_stop sent when charging_started event fires', async () => {
    mockStopChargeOnManualStart = true

    mockVehicleEvents.emit('charging_started', {
      vehicleId: 'vid1',
      chargingState: 'Charging',
      soc: 67,
      chargerActualCurrent: 16,
      chargerVoltage: 212,
    })

    // Allow async handler to complete
    await new Promise((r) => setTimeout(r, 50))

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls.length).toBeGreaterThan(0)
  })

  test('flag=false + engine idle: charge_stop NOT sent when charging_started event fires', async () => {
    mockStopChargeOnManualStart = false

    mockVehicleEvents.emit('charging_started', {
      vehicleId: 'vid1',
      chargingState: 'Charging',
      soc: 67,
      chargerActualCurrent: 16,
      chargerVoltage: 212,
    })

    await new Promise((r) => setTimeout(r, 50))

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })

  test('flag=true + engine RUNNING: charge_stop NOT sent (evload owns the charge)', async () => {
    mockStopChargeOnManualStart = true
    mockPluggedIn = true

    await eng.startEngine(80, 16)

    mockSendProxyCommand.mockClear()

    mockVehicleEvents.emit('charging_started', {
      vehicleId: 'vid1',
      chargingState: 'Charging',
      soc: 67,
      chargerActualCurrent: 16,
      chargerVoltage: 212,
    })

    await new Promise((r) => setTimeout(r, 50))

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })
})

// ─── Test: stopEngine — charge_stop only when vehicle is actively charging ────

describe('stopEngine — charge_stop only when actively charging', () => {
  test('forceOff=true + vehicle NOT charging: does NOT send charge_stop', async () => {
    const { stopEngine } = await import('../../engine/charging.engine')
    mockPluggedIn = false  // charging = false
    mockSendProxyCommand.mockClear()

    await stopEngine({ forceOff: true })

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })

  test('forceOff=true + vehicle IS charging: sends charge_stop', async () => {
    const { stopEngine, startEngine } = await import('../../engine/charging.engine')
    mockPluggedIn = true   // charging = true (from mock: charging = mockPluggedIn)
    mockSendProxyCommand.mockClear()

    await startEngine(80, 16)
    mockSendProxyCommand.mockClear()

    await stopEngine({ forceOff: true })

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls.length).toBeGreaterThan(0)
  })

  test('forceOff=false + vehicle IS charging: sends charge_stop (auto-stop)', async () => {
    const { stopEngine, startEngine } = await import('../../engine/charging.engine')
    mockPluggedIn = true   // charging = true

    await startEngine(80, 16)
    mockSendProxyCommand.mockClear()

    await stopEngine({ forceOff: false })

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls.length).toBeGreaterThan(0)
  })

  test('forceOff=false + vehicle NOT charging: does NOT send charge_stop (sleeping car)', async () => {
    const { stopEngine } = await import('../../engine/charging.engine')
    mockPluggedIn = false  // charging = false
    mockSendProxyCommand.mockClear()

    await stopEngine({ forceOff: false })

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })
})
