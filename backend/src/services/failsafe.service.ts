import { EventEmitter } from 'events'
import { logger } from '../logger'
import { sendTelegramNotification } from './telegram.service'
import { haEvents } from './ha.service'
import { vehicleEvents } from './proxy.service'
import { getConfig } from '../config'

export const failsafeEvents = new EventEmitter()

let failsafeActive = false
let failsafeReason = ''

export function isFailsafeActive(): boolean {
  return failsafeActive
}

export function getFailsafeReason(): string {
  return failsafeReason
}

async function activateFailsafe(reason: string): Promise<void> {
  if (getConfig().demo) {
    logger.debug(`[DEMO] Failsafe skipped: ${reason}`)
    return
  }
  if (failsafeActive) return
  failsafeActive = true
  failsafeReason = reason
  logger.error(`FAILSAFE ACTIVATED: ${reason}`)
  failsafeEvents.emit('activated', { reason })
  await sendTelegramNotification(
    `🚨 evload FAILSAFE ACTIVATED\nReason: ${reason}\nAll automated control halted. Use Tesla app manually.`
  ).catch((err) => logger.error('Failsafe notification failed', { err }))
}

export async function resetFailsafe(): Promise<void> {
  failsafeActive = false
  failsafeReason = ''
  logger.info('Failsafe reset')
  failsafeEvents.emit('reset')
}

export function initFailsafe(): void {
  haEvents.on('disconnected', () => {
    activateFailsafe('Home Assistant disconnected').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  vehicleEvents.on('disconnected', () => {
    activateFailsafe('Vehicle proxy disconnected').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  logger.info('Failsafe service initialized')
}
