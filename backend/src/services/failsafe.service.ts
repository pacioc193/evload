import { EventEmitter } from 'events'
import { logger } from '../logger'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'
import { haEvents } from './ha.service'
import { proxyEvents } from './proxy.service'
import { getConfig } from '../config'

export const failsafeEvents = new EventEmitter()

let failsafeActive = false
let failsafeReason = ''
let failsafeActivatedAtMs: number | null = null

export function isFailsafeActive(): boolean {
  return failsafeActive
}

export function getFailsafeReason(): string {
  return failsafeReason
}

async function activateFailsafe(reason: string, source: 'ha' | 'proxy' | 'manual' | 'unknown' = 'unknown'): Promise<void> {
  if (getConfig().demo) {
    logger.debug(`[DEMO] Failsafe skipped: ${reason}`)
    return
  }
  if (failsafeActive) {
    logger.warn('FAILSAFE_ALREADY_ACTIVE', {
      source,
      reason,
      activeReason: failsafeReason,
      activeForSec: failsafeActivatedAtMs ? Math.round((Date.now() - failsafeActivatedAtMs) / 1000) : null,
    })
    return
  }
  failsafeActive = true
  failsafeReason = reason
  failsafeActivatedAtMs = Date.now()
  logger.error('FAILSAFE_ACTIVATED', {
    source,
    reason,
  })
  failsafeEvents.emit('activated', { reason })
  await dispatchTelegramNotificationEvent(
    'failsafe_activated',
    { reason }
  ).catch((err) => logger.error('Failsafe notification failed', { err }))
}

export async function resetFailsafe(): Promise<void> {
  const activeForSec = failsafeActivatedAtMs ? Math.round((Date.now() - failsafeActivatedAtMs) / 1000) : null
  const previousReason = failsafeReason
  failsafeActive = false
  failsafeReason = ''
  failsafeActivatedAtMs = null
  logger.info('FAILSAFE_RESET', {
    previousReason,
    activeForSec,
  })
  failsafeEvents.emit('reset')
  dispatchTelegramNotificationEvent('failsafe_cleared', { reason: 'manual_reset' }).catch(() => {})
}

export function initFailsafe(): void {
  haEvents.on('disconnected', () => {
    activateFailsafe('Home Assistant disconnected', 'ha').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  haEvents.on('connected', () => {
    if (failsafeActive && failsafeReason.includes('Home Assistant')) {
      resetFailsafe().catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  haEvents.on('state', (state: { connected?: boolean }) => {
    if (state.connected && failsafeActive && failsafeReason.includes('Home Assistant')) {
      resetFailsafe().catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  proxyEvents.on('disconnected', () => {
    activateFailsafe('Vehicle proxy disconnected', 'proxy').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  proxyEvents.on('connected', () => {
    if (failsafeActive && failsafeReason.includes('Vehicle')) {
      resetFailsafe().catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  logger.info('Failsafe service initialized')
}
