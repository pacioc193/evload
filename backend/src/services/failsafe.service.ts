import { EventEmitter } from 'events'
import { logger } from '../logger'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'
import { haEvents } from './ha.service'
import { proxyEvents } from './proxy.service'
import { getConfig } from '../config'

export const failsafeEvents = new EventEmitter()

/**
 * Failsafe severity:
 *  - 'hard': critical condition (e.g. HA disconnected) → engine must stop immediately
 *  - 'soft': transient condition (e.g. proxy disconnected) → engine suspends and auto-resumes on reconnect
 */
export type FailsafeType = 'hard' | 'soft'

let failsafeActive = false
let failsafeType: FailsafeType = 'hard'
let failsafeReason = ''
let failsafeActivatedAtMs: number | null = null

export function isFailsafeActive(): boolean {
  return failsafeActive
}

export function getFailsafeType(): FailsafeType {
  return failsafeType
}

export function getFailsafeReason(): string {
  return failsafeReason
}

async function activateFailsafe(
  reason: string,
  source: 'ha' | 'proxy' | 'manual' | 'unknown' = 'unknown',
  type: FailsafeType = 'hard'
): Promise<void> {
  if (getConfig().demo) {
    logger.debug(`[DEMO] Failsafe skipped: ${reason}`)
    return
  }
  if (failsafeActive) {
    logger.warn('FAILSAFE_ALREADY_ACTIVE', {
      source,
      reason,
      type,
      activeReason: failsafeReason,
      activeType: failsafeType,
      activeForSec: failsafeActivatedAtMs ? Math.round((Date.now() - failsafeActivatedAtMs) / 1000) : null,
    })
    return
  }
  failsafeActive = true
  failsafeType = type
  failsafeReason = reason
  failsafeActivatedAtMs = Date.now()
  logger.error('FAILSAFE_ACTIVATED', {
    source,
    reason,
    type,
  })
  failsafeEvents.emit('activated', { reason, type })
  await dispatchTelegramNotificationEvent(
    'failsafe_activated',
    { reason }
  ).catch((err) => logger.error('Failsafe notification failed', { err }))
}

export async function resetFailsafe(clearReason?: string): Promise<void> {
  const activeForSec = failsafeActivatedAtMs ? Math.round((Date.now() - failsafeActivatedAtMs) / 1000) : null
  const previousReason = failsafeReason
  const previousType = failsafeType
  failsafeActive = false
  failsafeType = 'hard'
  failsafeReason = ''
  failsafeActivatedAtMs = null
  logger.info('FAILSAFE_RESET', {
    previousReason,
    previousType,
    activeForSec,
    clearReason: clearReason ?? 'manual_reset',
  })
  failsafeEvents.emit('reset', { previousType })
  dispatchTelegramNotificationEvent('failsafe_cleared', { reason: clearReason ?? 'manual_reset' }).catch(() => {})
}

export function initFailsafe(): void {
  // HA disconnect → hard failsafe (engine must stop)
  haEvents.on('disconnected', () => {
    activateFailsafe('Home Assistant disconnected', 'ha', 'hard').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  haEvents.on('connected', () => {
    if (failsafeActive && failsafeReason.includes('Home Assistant')) {
      resetFailsafe('ha_reconnected').catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  haEvents.on('state', (state: { connected?: boolean }) => {
    if (state.connected && failsafeActive && failsafeReason.includes('Home Assistant')) {
      resetFailsafe('ha_reconnected').catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  // Proxy disconnect → soft failsafe (engine suspends, auto-resumes on reconnect)
  proxyEvents.on('disconnected', () => {
    activateFailsafe('Vehicle proxy disconnected', 'proxy', 'soft').catch((err) =>
      logger.error('Failsafe activation error', { err })
    )
  })

  proxyEvents.on('connected', () => {
    if (failsafeActive && failsafeReason.includes('Vehicle')) {
      resetFailsafe('proxy_reconnected').catch((err) => logger.error('Failsafe reset error', { err }))
    }
  })

  logger.info('Failsafe service initialized')
}
