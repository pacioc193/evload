import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { NextPlannedCharge } from '../scheduler.service'

const mockStartEngine = jest.fn()
const mockSendProxyCommand = jest.fn().mockImplementation(async () => ({}))
const mockRequestWakeMode = jest.fn().mockImplementation(async () => undefined)
const mockDispatchTelegramNotificationEvent = jest.fn().mockImplementation(async () => ({ delivered: 0, matchedRules: [], messages: [] }))

let mockEngineRunning = false
let mockSoc: number | null = 50

type ChargeType =
  | 'start_at'
  | 'weekly'
  | 'end_at'
  | 'end_at_weekly'
  | 'start_end'
  | 'start_end_weekly'
  | 'finish_by'
  | 'finish_by_weekly'

type ScheduledChargeMock = {
  id: number
  vehicleId: string
  name: string | null
  scheduledAt: Date | null
  finishBy: Date | null
  scheduleType: ChargeType
  enabled: boolean
  targetSoc: number
  targetAmps: number | null
  startedAt: Date | null
}

let mockScheduledCharges: ScheduledChargeMock[] = []

type ScheduledClimateMock = {
  id: number
  vehicleId: string
  scheduleType: 'start_at' | 'weekly' | 'start_end'
  scheduledAt: Date | null
  finishBy: Date | null
  startedAt: Date | null
  targetTempC: number
  enabled: boolean
}

let mockScheduledClimates: ScheduledClimateMock[] = []

function matchesDateFilter(
  value: Date | null,
  filter?: { lte?: Date; gte?: Date; gt?: Date }
): boolean {
  if (!filter) return true
  if (!value) return false
  if (filter.lte && value > filter.lte) return false
  if (filter.gte && value < filter.gte) return false
  if (filter.gt && value <= filter.gt) return false
  return true
}

function matchesScheduleType(
  value: string,
  filter?: string | { in: string[] }
): boolean {
  if (!filter) return true
  if (typeof filter === 'string') return value === filter
  if (Array.isArray(filter.in)) return filter.in.includes(value)
  return true
}

jest.mock('../../engine/charging.engine', () => ({
  startEngine: (targetSoc: number, targetAmps?: number, fromPlan?: boolean, planName?: string) =>
    mockStartEngine(targetSoc, targetAmps, Boolean(fromPlan), planName),
  getEngineStatus: () => ({ running: mockEngineRunning, mode: 'off', phase: 'idle' }),
}))

jest.mock('../proxy.service', () => ({
  getVehicleState: () => ({
    connected: true,
    pluggedIn: true,
    charging: false,
    stateOfCharge: mockSoc,
    chargerVoltage: 230,
    chargerActualCurrent: 16,
    chargeRateKw: 0,
    chargingState: 'Disconnected',
    batteryRange: null,
    chargerPilotCurrent: 16,
    chargerPhases: 1,
    timeToFullChargeH: 2,
    insideTempC: 20,
    outsideTempC: 15,
    climateOn: false,
    locked: false,
    odometer: 10000,
    vin: 'TESTVIN',
    displayName: 'Test Vehicle',
  }),
  sendProxyCommand: (...args: unknown[]) => mockSendProxyCommand(...args),
  requestWakeMode: (...args: unknown[]) => mockRequestWakeMode(...args),
}))

jest.mock('../failsafe.service', () => ({
  isFailsafeActive: () => false,
}))

jest.mock('../notification-rules.service', () => ({
  dispatchTelegramNotificationEvent: (...args: unknown[]) => mockDispatchTelegramNotificationEvent(...args),
}))

jest.mock('../../config', () => ({
  getConfig: () => ({
    demo: false,
    timezone: 'UTC',
    proxy: { vehicleId: 'vid1', url: 'http://proxy.local' },
    charging: {
      defaultAmps: 16,
      maxAmps: 32,
      minAmps: 5,
      batteryCapacityKwh: 75,
      stopChargeOnManualStart: false,
      planWakeBeforeMinutes: 0,
      nominalVoltageV: 220,
      finishBySafetyMarginPct: 10,
    },
  }),
}))

jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}))

jest.mock('../../prisma', () => ({
  prisma: {
    scheduledCharge: {
      findMany: jest.fn().mockImplementation((input: any = {}) => {
        const where = input?.where as Record<string, unknown> | undefined
        const out = mockScheduledCharges.filter((charge) => {
          if (where?.enabled != null && charge.enabled !== where.enabled) return false

          if (!matchesScheduleType(charge.scheduleType, where?.scheduleType as string | { in: string[] } | undefined)) {
            return false
          }

          if (where?.startedAt === null && charge.startedAt !== null) return false
          if (where?.startedAt && typeof where.startedAt === 'object' && 'not' in (where.startedAt as object) && charge.startedAt === null) {
            return false
          }

          if (!matchesDateFilter(charge.scheduledAt, where?.scheduledAt as { lte?: Date; gte?: Date; gt?: Date } | undefined)) {
            return false
          }

          if (!matchesDateFilter(charge.finishBy, where?.finishBy as { lte?: Date; gte?: Date; gt?: Date } | undefined)) {
            return false
          }

          return true
        })

        return Promise.resolve(out)
      }),
      findFirst: jest.fn().mockImplementation((input: any = {}) => {
        const where = input?.where as Record<string, unknown> | undefined
        const orderBy = input?.orderBy as Record<string, 'asc' | 'desc'> | undefined
        const matches = mockScheduledCharges.filter((charge) => {
          if (where?.enabled != null && charge.enabled !== where.enabled) return false
          if (!matchesScheduleType(charge.scheduleType, where?.scheduleType as string | { in: string[] } | undefined)) return false
          if (!matchesDateFilter(charge.scheduledAt, where?.scheduledAt as { gt?: Date; lte?: Date; gte?: Date } | undefined)) return false
          if (!matchesDateFilter(charge.finishBy, where?.finishBy as { gt?: Date; lte?: Date; gte?: Date } | undefined)) return false
          if (where?.startedAt === null && charge.startedAt !== null) return false
          return true
        })

        const key = orderBy ? Object.keys(orderBy)[0] : undefined
        if (key === 'scheduledAt') {
          matches.sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
        }
        if (key === 'finishBy') {
          matches.sort((a, b) => (a.finishBy?.getTime() ?? 0) - (b.finishBy?.getTime() ?? 0))
        }

        return Promise.resolve(matches[0] ?? null)
      }),
      update: jest.fn().mockImplementation((input: any) => {
        const where = input?.where as { id: number }
        const data = input?.data as Partial<ScheduledChargeMock>
        mockScheduledCharges = mockScheduledCharges.map((c) => (c.id === where.id ? { ...c, ...data } : c))
        return Promise.resolve(mockScheduledCharges.find((c) => c.id === where.id) ?? null)
      }),
    },
    scheduledClimate: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockScheduledClimates)),
      update: jest.fn().mockImplementation(async () => ({})),
    },
  },
}))

describe('scheduler modes coverage', () => {
  let startScheduler: () => void
  let stopScheduler: () => void
  let resolveNextPlannedCharge: (now?: Date) => Promise<NextPlannedCharge | null>

  beforeAll(async () => {
    const mod = await import('../scheduler.service')
    startScheduler = mod.startScheduler
    stopScheduler = mod.stopScheduler
    resolveNextPlannedCharge = mod.resolveNextPlannedCharge
  })

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-04-11T10:00:00.000Z'))

    mockEngineRunning = false
    mockSoc = 50
    mockScheduledCharges = []
    mockScheduledClimates = []

    mockStartEngine.mockClear()
    mockSendProxyCommand.mockClear()
    mockRequestWakeMode.mockClear()
    mockDispatchTelegramNotificationEvent.mockClear()
  })

  afterEach(() => {
    stopScheduler()
    jest.useRealTimers()
  })

  async function runInitialSchedulerTick(): Promise<void> {
    startScheduler()
    await jest.advanceTimersByTimeAsync(0)
    await Promise.resolve()
  }

  test('start_at: starts engine and disables one-shot schedule', async () => {
    mockScheduledCharges = [
      {
        id: 1,
        vehicleId: 'vid1',
        name: 'Start At Plan',
        scheduleType: 'start_at',
        scheduledAt: new Date('2026-04-11T09:58:00.000Z'),
        finishBy: null,
        startedAt: null,
        enabled: true,
        targetSoc: 80,
        targetAmps: 16,
      },
    ]

    await runInitialSchedulerTick()

    expect(mockStartEngine).toHaveBeenCalledTimes(1)
    expect(mockStartEngine).toHaveBeenCalledWith(80, 16, true, 'Start At Plan')
    expect(mockScheduledCharges[0]?.enabled).toBe(false)
  })

  test('end_at: stops charge and disables one-shot schedule', async () => {
    mockScheduledCharges = [
      {
        id: 2,
        vehicleId: 'vid1',
        name: 'End At Plan',
        scheduleType: 'end_at',
        scheduledAt: null,
        finishBy: new Date('2026-04-11T09:59:00.000Z'),
        startedAt: null,
        enabled: true,
        targetSoc: 80,
        targetAmps: 16,
      },
    ]

    await runInitialSchedulerTick()

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(1)
    expect(mockScheduledCharges[0]?.enabled).toBe(false)
  })

  test('end_at_weekly: stops charge and rolls finishBy by +7 days', async () => {
    const finish = new Date('2026-04-11T09:59:00.000Z')
    mockScheduledCharges = [
      {
        id: 3,
        vehicleId: 'vid1',
        name: 'End Weekly Plan',
        scheduleType: 'end_at_weekly',
        scheduledAt: null,
        finishBy: finish,
        startedAt: null,
        enabled: true,
        targetSoc: 80,
        targetAmps: 16,
      },
    ]

    await runInitialSchedulerTick()

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(1)
    expect(mockScheduledCharges[0]?.enabled).toBe(true)
    expect(mockScheduledCharges[0]?.finishBy?.getTime()).toBe(finish.getTime() + 7 * 24 * 60 * 60 * 1000)
  })

  test('start_end: starts session at start boundary and stamps startedAt', async () => {
    mockScheduledCharges = [
      {
        id: 4,
        vehicleId: 'vid1',
        name: 'Range Plan',
        scheduleType: 'start_end',
        scheduledAt: new Date('2026-04-11T09:58:00.000Z'),
        finishBy: new Date('2026-04-11T11:30:00.000Z'),
        startedAt: null,
        enabled: true,
        targetSoc: 85,
        targetAmps: 12,
      },
    ]

    await runInitialSchedulerTick()

    expect(mockStartEngine).toHaveBeenCalledTimes(1)
    expect(mockStartEngine).toHaveBeenCalledWith(85, 12, true, 'Range Plan')
    expect(mockScheduledCharges[0]?.startedAt).not.toBeNull()

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(0)
  })

  test('start_end: stops session at end boundary and disables one-shot schedule', async () => {
    mockScheduledCharges = [
      {
        id: 5,
        vehicleId: 'vid1',
        name: 'Range Stop Plan',
        scheduleType: 'start_end',
        scheduledAt: new Date('2026-04-11T08:00:00.000Z'),
        finishBy: new Date('2026-04-11T09:59:00.000Z'),
        startedAt: new Date('2026-04-11T08:00:00.000Z'),
        enabled: true,
        targetSoc: 85,
        targetAmps: 12,
      },
    ]

    await runInitialSchedulerTick()

    const stopCalls = mockSendProxyCommand.mock.calls.filter((c: unknown[]) => c[1] === 'charge_stop')
    expect(stopCalls).toHaveLength(1)
    expect(mockScheduledCharges[0]?.enabled).toBe(false)
  })

  test('finish_by: starts immediately when computed start is in the past', async () => {
    mockSoc = 40
    mockScheduledCharges = [
      {
        id: 6,
        vehicleId: 'vid1',
        name: 'Finish Plan',
        scheduleType: 'finish_by',
        scheduledAt: null,
        finishBy: new Date('2026-04-11T11:00:00.000Z'),
        startedAt: null,
        enabled: true,
        targetSoc: 90,
        targetAmps: 16,
      },
    ]

    await runInitialSchedulerTick()

    expect(mockStartEngine).toHaveBeenCalledTimes(1)
    expect(mockStartEngine).toHaveBeenCalledWith(90, 16, true, 'Finish Plan')
    expect(mockScheduledCharges[0]?.enabled).toBe(false)
  })

  test('finish_by: announces computed schedule when start is in the future', async () => {
    mockSoc = 85
    mockScheduledCharges = [
      {
        id: 7,
        vehicleId: 'vid1',
        name: 'Finish Future Plan',
        scheduleType: 'finish_by',
        scheduledAt: null,
        finishBy: new Date('2026-04-11T16:00:00.000Z'),
        startedAt: null,
        enabled: true,
        targetSoc: 90,
        targetAmps: 16,
      },
    ]

    await runInitialSchedulerTick()

    const scheduledNotifies = mockDispatchTelegramNotificationEvent.mock.calls.filter(
      (c: unknown[]) => c[0] === 'plan_finish_by_scheduled'
    )
    expect(mockStartEngine).toHaveBeenCalledTimes(0)
    expect(scheduledNotifies.length).toBeGreaterThan(0)
  })

  test('resolveNextPlannedCharge returns nearest next mode candidate', async () => {
    mockSoc = 60
    mockScheduledCharges = [
      {
        id: 10,
        vehicleId: 'vid1',
        name: 'Later Finish By',
        scheduleType: 'finish_by',
        scheduledAt: null,
        finishBy: new Date('2026-04-11T18:00:00.000Z'),
        startedAt: null,
        enabled: true,
        targetSoc: 85,
        targetAmps: 16,
      },
      {
        id: 11,
        vehicleId: 'vid1',
        name: 'Nearest Start At',
        scheduleType: 'start_at',
        scheduledAt: new Date('2026-04-11T10:15:00.000Z'),
        finishBy: null,
        startedAt: null,
        enabled: true,
        targetSoc: 80,
        targetAmps: 16,
      },
    ]

    const next = await resolveNextPlannedCharge(new Date('2026-04-11T10:00:00.000Z'))

    expect(next).not.toBeNull()
    expect(next?.id).toBe(11)
    expect(next?.scheduleType).toBe('start_at')
  })
})
