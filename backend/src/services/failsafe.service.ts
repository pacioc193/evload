import { EventEmitter } from 'events'
import { logger } from '../logger'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'
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
  await dispatchTelegramNotificationEvent(
    'failsafe_activated',
    { reason }
  ).catch((err) => logger.error('Failsafe notification failed', { err }))
}

export async function resetFailsafe(): Promise<void> {
  failsafeActive = false
  failsafeReason = ''
  logger.info('Failsafe reset')
  failsafeEvents.emit('reset')
  dispatchTelegramNotificationEvent('failsafe_cleared', { reason: 'manual_reset' }).catch(() => {})
}

export function initFailsafe(): void {
  haEvents.on('disconnected', () => {
    activateFailsafe('Home Assistant disconnected').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  haEvents.on('connected', () => {
    if (failsafeActive && failsafeReason.includes('Home Assistant')) {
      resetFailsafe().catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  vehicleEvents.on('disconnected', () => {
    activateFailsafe('Vehicle proxy disconnected').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  vehicleEvents.on('connected', () => {
    if (failsafeActive && failsafeReason.includes('Vehicle')) {
      resetFailsafe().catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  logger.info('Failsafe service initialized')
}
