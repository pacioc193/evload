import { PrismaClient } from '@prisma/client'
import { logger } from '../logger'
import { startEngine, getEngineStatus } from '../engine/charging.engine'
import { sendProxyCommand, getVehicleState } from './proxy.service'
import { getConfig } from '../config'
import { isFailsafeActive } from './failsafe.service'

const prisma = new PrismaClient()

let schedulerTimer: NodeJS.Timeout | null = null

async function runSchedulerTick(): Promise<void> {
  const now = new Date()

  // Scheduled charges
  const pendingCharges = await prisma.scheduledCharge.findMany({
    where: { enabled: true, scheduledAt: { lte: now } },
  })

  for (const sc of pendingCharges) {
    // Disable first to prevent double-firing
    await prisma.scheduledCharge.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing scheduled charge id=${sc.id} targetSoc=${sc.targetSoc}`)
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

  // Scheduled climate
  const pendingClimate = await prisma.scheduledClimate.findMany({
    where: { enabled: true, scheduledAt: { lte: now } },
  })

  for (const sc of pendingClimate) {
    await prisma.scheduledClimate.update({ where: { id: sc.id }, data: { enabled: false } })
    logger.info(`Executing scheduled climate id=${sc.id} temp=${sc.targetTempC}°C`)
    if (!isFailsafeActive()) {
      try {
        const cfg = getConfig()
        const vid = sc.vehicleId || cfg.proxy.vehicleId
        if (!vid) {
          logger.warn(`Scheduled climate id=${sc.id} skipped: no vehicle ID`)
          continue
        }
        const vState = getVehicleState()
        if (!vState.connected && !cfg.demo) {
          logger.warn(`Scheduled climate id=${sc.id} skipped: vehicle not connected`)
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
  // run immediately, then every 30s
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
