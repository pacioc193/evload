import axios from 'axios'
import { EventEmitter } from 'events'
import { logger } from '../logger'
import { getConfig } from '../config'
import { prisma } from '../prisma'
import { getVehicleState } from './proxy.service'

export interface HaState {
  connected: boolean
  powerW: number | null
  chargerW: number | null
  lastUpdated: Date | null
  failureCount: number
  maxFailuresBeforeManualReconnect: number
  requiresManualReconnect: boolean
  lastError: string | null
  error?: string
}

export const haEvents = new EventEmitter()

let haState: HaState = {
  connected: false,
  powerW: null,
  chargerW: null,
  lastUpdated: null,
  failureCount: 0,
  maxFailuresBeforeManualReconnect: 3,
  requiresManualReconnect: false,
  lastError: null,
}

let pollLock = false
let pollTimer: NodeJS.Timeout | null = null
let haConsecutiveFailures = 0
let haBackoffUntilMs = 0
let haLastBackoffMs = 0

const HA_AUTH_BACKOFF_BASE_MS = 60_000
const HA_AUTH_BACKOFF_MAX_MS = 30 * 60_000
const HA_GENERAL_BACKOFF_BASE_MS = 2_000
const HA_GENERAL_BACKOFF_MAX_MS = 5 * 60_000
const HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT = 3

type HaEntityRead = {
  state: string
  attributes?: {
    unit_of_measurement?: string
  }
}

function parsePowerToWatts(stateRaw: string, unitRaw?: string): number | null {
  const normalized = stateRaw.trim().replace(',', '.')
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return null
  const unit = (unitRaw ?? '').trim().toLowerCase()
  if (unit === 'kw') return parsed * 1000
  return parsed
}

function computeBackoffMs(statusCode?: number): number {
  const isAuthFailure = statusCode === 401 || statusCode === 403
  const baseMs = isAuthFailure ? HA_AUTH_BACKOFF_BASE_MS : HA_GENERAL_BACKOFF_BASE_MS
  const maxMs = isAuthFailure ? HA_AUTH_BACKOFF_MAX_MS : HA_GENERAL_BACKOFF_MAX_MS
  const exponent = Math.max(0, haConsecutiveFailures - 1)
  return Math.min(maxMs, baseMs * (2 ** exponent))
}

function registerHaSuccess(): void {
  const wasConnected = haState.connected
  haConsecutiveFailures = 0
  haBackoffUntilMs = 0
  haLastBackoffMs = 0
  haState = {
    ...haState,
    failureCount: 0,
    maxFailuresBeforeManualReconnect: HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT,
    requiresManualReconnect: false,
    lastError: null,
  }
  if (!wasConnected) {
    haEvents.emit('connected', haState)
  }
}

function registerHaFailure(reason: string, statusCode?: number): void {
  const prevConnected = haState.connected
  haConsecutiveFailures += 1
  const nextFailureCount = Math.max(haConsecutiveFailures, haState.failureCount + 1)
  const requiresManualReconnect = nextFailureCount >= HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT
  const backoffMs = computeBackoffMs(statusCode)
  haBackoffUntilMs = requiresManualReconnect ? Number.POSITIVE_INFINITY : Date.now() + backoffMs
  haLastBackoffMs = requiresManualReconnect ? 0 : backoffMs

  const errorMessage = requiresManualReconnect
    ? `${reason} (stopped after ${nextFailureCount} failures; press Connect / Re-authorize to retry)`
    : `${reason} (retry in ${Math.ceil(backoffMs / 1000)}s)`

  haState = {
    connected: false,
    powerW: null,
    chargerW: null,
    lastUpdated: new Date(),
    failureCount: nextFailureCount,
    maxFailuresBeforeManualReconnect: HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT,
    requiresManualReconnect,
    lastError: reason,
    error: errorMessage,
  }

  if (prevConnected) {
    haEvents.emit('disconnected', haState)
  }
  haEvents.emit('state', haState)

  logger.warn('HA polling backoff activated', {
    statusCode,
    reason,
    consecutiveFailures: nextFailureCount,
    backoffMs: requiresManualReconnect ? null : backoffMs,
    requiresManualReconnect,
  })
}

export function requestHaReconnectAttempt(): void {
  haConsecutiveFailures = 0
  haBackoffUntilMs = 0
  haLastBackoffMs = 0
  haState = {
    ...haState,
    failureCount: 0,
    maxFailuresBeforeManualReconnect: HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT,
    requiresManualReconnect: false,
    error: undefined,
  }
  logger.info('HA reconnect attempt requested by user; retry lock cleared')
}

async function getHaToken(): Promise<string | null> {
  const rec = await prisma.appConfig.findUnique({ where: { key: 'ha_token' } })
  return rec?.value ?? null
}

export async function saveHaToken(token: string): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key: 'ha_token' },
    update: { value: token },
    create: { key: 'ha_token', value: token },
  })
  logger.info('HA token saved')
}

export async function getHaTokenObj(): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const rec = await prisma.appConfig.findUnique({ where: { key: 'ha_token_obj' } })
  if (!rec) return null
  try {
    return JSON.parse(rec.value) as { access_token: string; refresh_token: string; expires_in: number }
  } catch {
    return null
  }
}

export async function saveHaTokenObj(obj: { access_token: string; refresh_token: string; expires_in: number }): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key: 'ha_token_obj' },
    update: { value: JSON.stringify(obj) },
    create: { key: 'ha_token_obj', value: JSON.stringify(obj) },
  })
  logger.info('HA token object saved')
}

async function pollHaOnce(): Promise<void> {
  if (haState.requiresManualReconnect) {
    return
  }

  if (Date.now() < haBackoffUntilMs) {
    return
  }

  if (pollLock) {
    logger.debug('HA poll skipped - previous poll still in progress')
    return
  }
  pollLock = true
  try {
    const cfg = getConfig()
    if (cfg.demo) {
      const v = getVehicleState()
      const carW = Math.max(0, ((v.chargerActualCurrent ?? 0) * (v.chargerVoltage ?? 0)))
      const baseHomeW = 900 + Math.round((Date.now() / 1000) % 120)
      const homePowerW = baseHomeW + carW
      haState = {
        ...haState,
        connected: true,
        powerW: homePowerW,
        chargerW: carW,
        lastUpdated: new Date(),
        error: undefined,
      }
      haEvents.emit('state', haState)
      return
    }
    const tokenObj = await getHaTokenObj()
    const token = tokenObj?.access_token ?? (await getHaToken())
    if (!token) {
      haState = {
        ...haState,
        connected: false,
        powerW: null,
        chargerW: null,
        lastUpdated: new Date(),
        error: 'No HA token',
        lastError: 'No HA token',
      }
      haEvents.emit('state', haState)
      return
    }
    const haUrl = cfg.homeAssistant.url
    const headers = { Authorization: `Bearer ${token}` }

    const [powerRes, chargerRes] = await Promise.allSettled([
      axios.get<HaEntityRead>(`${haUrl}/api/states/${cfg.homeAssistant.powerEntityId}`, { headers, timeout: 5000 }),
      cfg.homeAssistant.chargerEntityId
        ? axios.get<HaEntityRead>(`${haUrl}/api/states/${cfg.homeAssistant.chargerEntityId}`, { headers, timeout: 5000 })
        : Promise.resolve(null),
    ])

    const powerFailureStatus = powerRes.status === 'rejected' && axios.isAxiosError(powerRes.reason)
      ? powerRes.reason.response?.status
      : undefined

    const powerW = powerRes.status === 'fulfilled' && powerRes.value
      ? parsePowerToWatts(powerRes.value.data.state, powerRes.value.data.attributes?.unit_of_measurement)
      : null

    const chargerW = chargerRes.status === 'fulfilled' && chargerRes.value
      ? parsePowerToWatts(
        (chargerRes.value as { data: HaEntityRead }).data.state,
        (chargerRes.value as { data: HaEntityRead }).data.attributes?.unit_of_measurement
      )
      : null

    if (powerW == null) {
      const reason = powerRes.status === 'rejected'
        ? String(powerRes.reason)
        : `Invalid numeric state for ${cfg.homeAssistant.powerEntityId}`
      registerHaFailure(reason, powerFailureStatus)
      return
    }

    haState = {
      ...haState,
      connected: true,
      powerW,
      chargerW,
      lastUpdated: new Date(),
      error: undefined,
    }
    registerHaSuccess()
    haEvents.emit('state', haState)
  } catch (err) {
    logger.error('HA poll error', { err })
    const statusCode = axios.isAxiosError(err) ? err.response?.status : undefined
    registerHaFailure(String(err), statusCode)
  } finally {
    pollLock = false
  }
}

export function startHaPoll(): void {
  if (pollTimer) return
  logger.info('Starting HA polling at 1Hz')
  pollTimer = setInterval(() => {
    pollHaOnce().catch((err) => logger.error('Unhandled HA poll rejection', { err }))
  }, 1000)
}

export function stopHaPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    logger.info('HA polling stopped')
  }
}

export function getHaState(): HaState {
  return haState
}
