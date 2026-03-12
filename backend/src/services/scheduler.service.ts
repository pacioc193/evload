import { PrismaClient } from '@prisma/client'
import { logger } from '../logger'
import { startEngine, getEngineStatus } from '../engine/charging.engine'
import { sendProxyCommand, getVehicleState } from './proxy.service'
import { getConfig } from '../config'
import { isFailsafeActive } from './failsafe.service'
import { sendTelegramNotification } from './telegram.service'

const prisma = new PrismaClient()

let schedulerTimer: NodeJS.Timeout | null = null

async function runSchedulerTick(): Promise<void> {
  const now = new Date()
  const cfg = getConfig()

  // ── Start-at scheduled charges ────────────────────────────────────────────
  const pendingStartAt = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduleType: 'start_at', scheduledAt: { lte: now } },
  })

  for (const sc of pendingStartAt) {
    await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing start_at charge id=${sc.id} targetSoc=${sc.targetSoc}`)
    if (!isFailsafeActive() && !getEngineStatus().running) {
      try {
        await startEngine(sc.targetSoc, sc.targetAmps ?? undefined)
      } catch (err) {
        logger.error(`Scheduled charge id=${sc.id} failed to start engine`, { err })
      }
    } else {
      logger.warn(`Scheduled charge id=${sc.id} skipped (failsafe or engine already running)`)
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
          await startEngine(sc.targetSoc, amps)
          await sendTelegramNotification(
            `⚡ Charging started for "finish by ${sc.finishBy.toLocaleTimeString()}" schedule → ${sc.targetSoc}%`
          )
        } catch (err) {
          logger.error(`Finish-by charge id=${sc.id} failed to start engine`, { err })
        }
      } else {
        logger.warn(`Finish-by charge id=${sc.id} skipped (failsafe or engine already running)`)
      }
    }
  }

  // ── Scheduled climate ────────────────────────────────────────────────────
  const pendingClimate = await prisma.scheduledClimate.findMany({
    where: { enabled: true, scheduledAt: { lte: now } },
  })

  for (const sc of pendingClimate) {
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

