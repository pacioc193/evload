import { logger } from '../logger'
import { startEngine, getEngineStatus } from '../engine/charging.engine'
import { sendProxyCommand, getVehicleState, requestWakeMode } from './proxy.service'
import { getConfig } from '../config'
import { isFailsafeActive } from './failsafe.service'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'
import { prisma } from '../prisma'

let schedulerTimer: NodeJS.Timeout | null = null
let lastLeadWakeKey: string | null = null

async function startEngineWithWake(scheduleId: number, vehicleId: string, targetSoc: number, targetAmps?: number): Promise<void> {
  logger.debug('Scheduler: startEngineWithWake', { scheduleId, vehicleId, targetSoc, targetAmps })
  await requestWakeMode(true)
  // External charge takeover (stopChargeOnManualStart logic) is handled inside startEngine()
  await startEngine(targetSoc, targetAmps)
}

export async function getScheduleNextStartMs(now: Date = new Date()): Promise<number | null> {
  const next = await resolveNextPlannedCharge(now)
  if (!next) return null
  return next.computedStartAt.getTime() - now.getTime()
}

async function runSchedulerTick(): Promise<void> {
  const now = new Date()
  const cfg = getConfig()
  const chargeSchedulesEnabled = getEngineStatus().mode !== 'off'

  const nextPlanned = await resolveNextPlannedCharge(now)
  if (chargeSchedulesEnabled && nextPlanned) {
    const nextStartMs = nextPlanned.computedStartAt.getTime() - now.getTime()
    const leadWindowMs = Math.max(0, cfg.proxy.scheduleLeadTimeSec) * 1000
    if (nextStartMs > 0 && nextStartMs <= leadWindowMs) {
      const wakeKey = `${nextPlanned.id}:${nextPlanned.computedStartAt.getTime()}`
      if (lastLeadWakeKey !== wakeKey) {
        logger.info('Upcoming schedule within lead window, requesting wake mode', {
          scheduleId: nextPlanned.id,
          nextStartMs,
          leadWindowMs,
        })
        await requestWakeMode(true)
        lastLeadWakeKey = wakeKey
      }
    } else {
      lastLeadWakeKey = null
    }
  } else {
    lastLeadWakeKey = null
  }

  // ── Start-at scheduled charges ────────────────────────────────────────────
  const pendingStartAt = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'start_at', scheduledAt: { lte: now } },
  })

  for (const sc of pendingStartAt) {
    if (!chargeSchedulesEnabled) continue
    await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing start_at charge id=${sc.id} targetSoc=${sc.targetSoc}`)
    if (!isFailsafeActive() && !getEngineStatus().running) {
      try {
        dispatchTelegramNotificationEvent('plan_start', { planId: sc.id, targetSoc: sc.targetSoc }).catch(() => {})
        await startEngineWithWake(sc.id, sc.vehicleId || cfg.proxy.vehicleId, sc.targetSoc, sc.targetAmps ?? undefined)
      } catch (err) {
        logger.error(`Scheduled charge id=${sc.id} failed to start engine`, { err })
      }
    } else {
      dispatchTelegramNotificationEvent('plan_skipped', { planId: sc.id, reason: 'failsafe_active_or_running' }).catch(() => {})
      logger.warn(`Scheduled charge id=${sc.id} skipped (failsafe or engine already running)`)
    }
  }

  const pendingWeekly = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'weekly', scheduledAt: { lte: now } },
  })

  for (const sc of pendingWeekly) {
    if (!chargeSchedulesEnabled) continue
    const currentScheduledAt = sc.scheduledAt ?? now
    const nextWeeklyOccurrence = new Date(currentScheduledAt.getTime() + (7 * 24 * 60 * 60 * 1000))
    await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { scheduledAt: nextWeeklyOccurrence } })

    logger.info(`Executing weekly charge id=${sc.id} targetSoc=${sc.targetSoc}`)
    if (!isFailsafeActive() && !getEngineStatus().running) {
      try {
        dispatchTelegramNotificationEvent('plan_start', { planId: sc.id, targetSoc: sc.targetSoc }).catch(() => {})
        await startEngineWithWake(sc.id, sc.vehicleId || cfg.proxy.vehicleId, sc.targetSoc, sc.targetAmps ?? undefined)
      } catch (err) {
        logger.error(`Weekly charge id=${sc.id} failed to start engine`, { err })
      }
    } else {
      dispatchTelegramNotificationEvent('plan_skipped', { planId: sc.id, reason: 'failsafe_active_or_running' }).catch(() => {})
      logger.warn(`Weekly charge id=${sc.id} skipped (failsafe or engine already running)`)
    }
  }

  const pendingStartEndStart = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'start_end', startedAt: null, scheduledAt: { lte: now } },
  })

  for (const sc of pendingStartEndStart) {
    if (!chargeSchedulesEnabled) continue
    logger.info(`Executing start_end charge start id=${sc.id} targetSoc=${sc.targetSoc}`)
    if (!isFailsafeActive() && !getEngineStatus().running) {
      try {
        const started = new Date()
        await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { startedAt: started } })
        dispatchTelegramNotificationEvent('plan_start', { planId: sc.id, targetSoc: sc.targetSoc }).catch(() => {})
        await startEngineWithWake(sc.id, sc.vehicleId || cfg.proxy.vehicleId, sc.targetSoc, sc.targetAmps ?? undefined)
      } catch (err) {
        logger.error(`Scheduled start_end charge id=${sc.id} failed to start engine`, { err })
      }
    } else {
      await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
      dispatchTelegramNotificationEvent('plan_skipped', { planId: sc.id, reason: 'failsafe_active_or_running' }).catch(() => {})
      logger.warn(`Scheduled start_end charge id=${sc.id} skipped (failsafe or engine already running)`)
    }
  }

  // ── Finish-by scheduled charges ───────────────────────────────────────────
  const pendingFinishBy = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'finish_by', finishBy: { gte: now } },
  })

  const vState = getVehicleState()
  const currentSoc = vState.stateOfCharge ?? 0
  const batteryKwh = cfg.charging.batteryCapacityKwh
  const chargerVoltage = vState.chargerVoltage ?? 230

  for (const sc of pendingFinishBy) {
    if (!chargeSchedulesEnabled) continue
    if (!sc.finishBy) continue
    const amps = sc.targetAmps ?? cfg.charging.defaultAmps
    const powerKw = (amps * chargerVoltage) / 1000
    const requiredKwh = ((sc.targetSoc - currentSoc) / 100) * batteryKwh
    if (requiredKwh <= 0) {
      await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
      logger.info(`Finish-by charge id=${sc.id} already at/above target SoC ${sc.targetSoc}%`)
      continue
    }
    const requiredMs = (requiredKwh / powerKw) * 3600 * 1000
    const startMs = sc.finishBy.getTime() - requiredMs
    if (Date.now() >= startMs) {
      await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
      logger.info(`Executing finish_by charge id=${sc.id} targetSoc=${sc.targetSoc} (must finish by ${sc.finishBy.toISOString()})`)
      if (!isFailsafeActive() && !getEngineStatus().running) {
        try {
          dispatchTelegramNotificationEvent('plan_start', { planId: sc.id, targetSoc: sc.targetSoc }).catch(() => {})
          await startEngineWithWake(sc.id, sc.vehicleId || cfg.proxy.vehicleId, sc.targetSoc, amps)
        } catch (err) {
          logger.error(`Finish-by charge id=${sc.id} failed to start engine`, { err })
        }
      } else {
        dispatchTelegramNotificationEvent('plan_skipped', { planId: sc.id, reason: 'failsafe_active_or_running' }).catch(() => {})
        logger.warn(`Finish-by charge id=${sc.id} skipped (failsafe or engine already running)`)
      }
    }
  }

  const pendingStartEndStop = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'start_end', startedAt: { not: null }, finishBy: { lte: now } },
  })

  for (const sc of pendingStartEndStop) {
    await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing start_end charge stop id=${sc.id} finishBy=${sc.finishBy?.toISOString()}`)
    if (!isFailsafeActive()) {
      try {
        await sendProxyCommand(sc.vehicleId || cfg.proxy.vehicleId, 'charge_stop', {})
        dispatchTelegramNotificationEvent('plan_completed', { planId: sc.id, reason: 'finish_by_window_reached' }).catch(() => {})
      } catch (err) {
        logger.error(`Scheduled start_end charge id=${sc.id} failed to stop charging`, { err })
      }
    }
  }

  // ── Scheduled climate ────────────────────────────────────────────────────
  const pendingClimateStartAt = await prisma.scheduledClimate.findMany({
    where: { enabled: true, scheduleType: 'start_at', scheduledAt: { lte: now } },
  })

  for (const sc of pendingClimateStartAt) {
    await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing scheduled climate id=${sc.id} temp=${sc.targetTempC}°C`)
    if (!isFailsafeActive()) {
      try {
        const vid = sc.vehicleId || cfg.proxy.vehicleId
        if (!vid) {
          logger.warn(`Scheduled climate id=${sc.id} skipped: no vehicle ID`)
          continue
        }
        const latestState = getVehicleState()
        if (!latestState.pluggedIn && !cfg.demo) {
          logger.warn(`Scheduled climate id=${sc.id} skipped: vehicle not plugged in`)
          continue
        }
        await sendProxyCommand(vid, 'set_temps', {
          driver_temp: sc.targetTempC,
          passenger_temp: sc.targetTempC,
        })
        await sendProxyCommand(vid, 'auto_conditioning_start', {})
      } catch (err) {
        logger.error(`Scheduled climate id=${sc.id} failed`, { err })
      }
    } else {
      logger.warn(`Scheduled climate id=${sc.id} skipped (failsafe active)`)
    }
  }

  const pendingClimateWeekly = await prisma.scheduledClimate.findMany({
    where: { enabled: true, scheduleType: 'weekly', scheduledAt: { lte: now } },
  })

  for (const sc of pendingClimateWeekly) {
    const currentScheduledAt = sc.scheduledAt ?? now
    const nextWeeklyOccurrence = new Date(currentScheduledAt.getTime() + (7 * 24 * 60 * 60 * 1000))
    await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { scheduledAt: nextWeeklyOccurrence } })

    logger.info(`Executing weekly climate id=${sc.id} temp=${sc.targetTempC}°C`)
    if (!isFailsafeActive()) {
      try {
        const vid = sc.vehicleId || cfg.proxy.vehicleId
        if (!vid) {
          logger.warn(`Weekly climate id=${sc.id} skipped: no vehicle ID`)
          continue
        }
        const latestState = getVehicleState()
        if (!latestState.pluggedIn && !cfg.demo) {
          logger.warn(`Weekly climate id=${sc.id} skipped: vehicle not plugged in`)
          continue
        }
        await sendProxyCommand(vid, 'set_temps', {
          driver_temp: sc.targetTempC,
          passenger_temp: sc.targetTempC,
        })
        await sendProxyCommand(vid, 'auto_conditioning_start', {})
      } catch (err) {
        logger.error(`Weekly climate id=${sc.id} failed`, { err })
      }
    } else {
      logger.warn(`Weekly climate id=${sc.id} skipped (failsafe active)`)
    }
  }

  const pendingClimateStartEndStart = await prisma.scheduledClimate.findMany({
    where: { enabled: true, scheduleType: 'start_end', startedAt: null, scheduledAt: { lte: now } },
  })

  for (const sc of pendingClimateStartEndStart) {
    logger.info(`Executing start_end climate start id=${sc.id} temp=${sc.targetTempC}°C`)
    if (!isFailsafeActive()) {
      try {
        const vid = sc.vehicleId || cfg.proxy.vehicleId
        if (!vid) {
          logger.warn(`Scheduled start_end climate id=${sc.id} skipped: no vehicle ID`)
          await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { enabled: false } })
          continue
        }
        const latestState = getVehicleState()
        if (!latestState.pluggedIn && !cfg.demo) {
          logger.warn(`Scheduled start_end climate id=${sc.id} skipped: vehicle not plugged in`)
          await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { enabled: false } })
          continue
        }
        await sendProxyCommand(vid, 'set_temps', {
          driver_temp: sc.targetTempC,
          passenger_temp: sc.targetTempC,
        })
        await sendProxyCommand(vid, 'auto_conditioning_start', {})
        await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { startedAt: new Date() } })
      } catch (err) {
        logger.error(`Scheduled start_end climate id=${sc.id} failed at start`, { err })
      }
    } else {
      logger.warn(`Scheduled start_end climate id=${sc.id} skipped (failsafe active)`)
      await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { enabled: false } })
    }
  }

  const pendingClimateStartEndStop = await prisma.scheduledClimate.findMany({
    where: { enabled: true, scheduleType: 'start_end', startedAt: { not: null }, finishBy: { lte: now } },
  })

  for (const sc of pendingClimateStartEndStop) {
    await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing start_end climate stop id=${sc.id}`)
    if (!isFailsafeActive()) {
      try {
        const vid = sc.vehicleId || cfg.proxy.vehicleId
        if (!vid) continue
        await sendProxyCommand(vid, 'auto_conditioning_stop', {})
      } catch (err) {
        logger.error(`Scheduled start_end climate id=${sc.id} failed at stop`, { err })
      }
    }
  }
}

export interface NextPlannedCharge {
  id: number
  scheduleType: string
  targetSoc: number
  targetAmps: number | null
  computedStartAt: Date
  finishBy: Date | null
}

export async function resolveNextPlannedCharge(now: Date = new Date()): Promise<NextPlannedCharge | null> {
  const cfg = getConfig()

  const futureStartAt = await prisma.scheduledCharge.findFirst({
    where: {
      enabled: true,
      scheduleType: { in: ['start_at', 'weekly'] },
      scheduledAt: { gt: now },
    },
    orderBy: { scheduledAt: 'asc' },
  })
  if (futureStartAt?.scheduledAt) {
    return {
      id: futureStartAt.id,
      scheduleType: futureStartAt.scheduleType,
      targetSoc: futureStartAt.targetSoc,
      targetAmps: futureStartAt.targetAmps,
      computedStartAt: futureStartAt.scheduledAt,
      finishBy: null,
    }
  }

  const futureStartEnd = await prisma.scheduledCharge.findFirst({
    where: { enabled: true, scheduleType: 'start_end', startedAt: null, scheduledAt: { gt: now } },
    orderBy: { scheduledAt: 'asc' },
  })
  if (futureStartEnd?.scheduledAt) {
    return {
      id: futureStartEnd.id,
      scheduleType: 'start_end',
      targetSoc: futureStartEnd.targetSoc,
      targetAmps: futureStartEnd.targetAmps,
      computedStartAt: futureStartEnd.scheduledAt,
      finishBy: futureStartEnd.finishBy,
    }
  }

  const pendingFinishBy = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'finish_by', finishBy: { gt: now } },
    orderBy: { finishBy: 'asc' },
  })
  const vState = getVehicleState()
  const currentSoc = vState.stateOfCharge ?? 0
  const batteryKwh = cfg.charging.batteryCapacityKwh
  const chargerVoltage = vState.chargerVoltage ?? 230

  for (const sc of pendingFinishBy) {
    if (!sc.finishBy) continue
    const amps = sc.targetAmps ?? cfg.charging.defaultAmps
    const powerKw = (amps * chargerVoltage) / 1000
    const requiredKwh = ((sc.targetSoc - currentSoc) / 100) * batteryKwh
    if (requiredKwh <= 0) continue
    const requiredMs = (requiredKwh / powerKw) * 3600 * 1000
    const computedStartAt = new Date(sc.finishBy.getTime() - requiredMs)
    if (computedStartAt > now) {
      return {
        id: sc.id,
        scheduleType: 'finish_by',
        targetSoc: sc.targetSoc,
        targetAmps: sc.targetAmps,
        computedStartAt,
        finishBy: sc.finishBy,
      }
    }
  }

  return null
}

export function startScheduler(): void {
  if (schedulerTimer) return
  runSchedulerTick().catch((err) => logger.error('Scheduler initial tick error', { err }))
  schedulerTimer = setInterval(() => {
    runSchedulerTick().catch((err) => logger.error('Scheduler tick error', { err }))
  }, 30_000)
  logger.info('Scheduler service started (30s interval)')
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
    logger.info('Scheduler service stopped')
  }
}

