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
  /** EMA-smoothed grid/home power (W). Null until first valid sample. */
  smoothedPowerW: number | null
  /** EMA-smoothed charger power (W). Null until first valid sample. */
  smoothedChargerW: number | null
  /** True when the last chargerW reading was negative (sensor fault). */
  chargerFault: boolean
  lastUpdated: Date | null
  failureCount: number
  maxFailuresBeforeManualReconnect: number
  requiresManualReconnect: boolean
  lastError: string | null
  error?: string
}

export const haEvents = new EventEmitter()

export interface HaTokenObj {
  access_token: string
  refresh_token: string
  expires_in: number
  issued_at_ms?: number
}

let haState: HaState = {
  connected: false,
  powerW: null,
  chargerW: null,
  smoothedPowerW: null,
  smoothedChargerW: null,
  chargerFault: false,
  lastUpdated: null,
  failureCount: 0,
  maxFailuresBeforeManualReconnect: 3,
  requiresManualReconnect: false,
  lastError: null,
}

/** EMA smoothing factor (0 < α ≤ 1). Lower = more smoothing, slower response. */
const HA_EMA_ALPHA = 0.3

/** Apply an EMA step: returns new smoothed value given the previous and the new raw sample. */
function applyEma(prev: number | null, raw: number): number {
  if (prev === null) return raw
  return prev + HA_EMA_ALPHA * (raw - prev)
}

let pollLock = false
let pollTimer: NodeJS.Timeout | null = null
let haConsecutiveFailures = 0
let haBackoffUntilMs = 0
let haLastBackoffMs = 0
let lastHaInputQualityWarningAtMs = 0

const HA_AUTH_BACKOFF_BASE_MS = 60_000
const HA_AUTH_BACKOFF_MAX_MS = 30 * 60_000
const HA_GENERAL_BACKOFF_BASE_MS = 2_000
const HA_GENERAL_BACKOFF_MAX_MS = 5 * 60_000
const HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT = 3
const HA_TOKEN_REFRESH_MARGIN_MS = 60_000

let haTokenRefreshPromise: Promise<string | null> | null = null

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

function normalizeHaFailureReason(reason: string, statusCode?: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return `Home Assistant token invalid or revoked (HTTP ${statusCode})`
  }
  return reason
}

function isHaAuthStatus(statusCode?: number): boolean {
  return statusCode === 400 || statusCode === 401 || statusCode === 403
}

function isTransientLocalStateError(err: unknown): boolean {
  const msg = String(err)
  return msg.includes('P1008') || msg.includes('SQLITE_BUSY') || msg.includes('database is locked')
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
    logger.info('HA_CONNECTIVITY_TRANSITION', {
      from: 'disconnected',
      to: 'connected',
      failureCount: haState.failureCount,
      requiresManualReconnect: haState.requiresManualReconnect,
    })
    haEvents.emit('connected', haState)
  }
}

function registerHaFailure(reason: string, statusCode?: number): void {
  const prevConnected = haState.connected
  haConsecutiveFailures += 1
  const rawFailureCount = Math.max(haConsecutiveFailures, haState.failureCount + 1)
  const nextFailureCount = Math.min(HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT, rawFailureCount)
  const normalizedReason = normalizeHaFailureReason(reason, statusCode)
  const requiresManualReconnect = nextFailureCount >= HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT
  const backoffMs = computeBackoffMs(statusCode)
  haBackoffUntilMs = requiresManualReconnect ? Number.POSITIVE_INFINITY : Date.now() + backoffMs
  haLastBackoffMs = requiresManualReconnect ? 0 : backoffMs

  const errorMessage = requiresManualReconnect
    ? `${normalizedReason} (stopped after ${nextFailureCount} failures; press Connect / Re-authorize to retry)`
    : `${normalizedReason} (retry in ${Math.ceil(backoffMs / 1000)}s)`

  haState = {
    connected: false,
    powerW: null,
    chargerW: null,
    smoothedPowerW: null,
    smoothedChargerW: null,
    chargerFault: false,
    lastUpdated: new Date(),
    failureCount: nextFailureCount,
    maxFailuresBeforeManualReconnect: HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT,
    requiresManualReconnect,
    lastError: normalizedReason,
    error: errorMessage,
  }

  if (prevConnected) {
    logger.warn('HA_CONNECTIVITY_TRANSITION', {
      from: 'connected',
      to: 'disconnected',
      statusCode,
      reason,
      failureCount: nextFailureCount,
      requiresManualReconnect,
    })
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

function registerHaEntityFailure(reason: string, statusCode?: number): void {
  const prevConnected = haState.connected
  const normalizedReason = normalizeHaFailureReason(reason, statusCode)

  // Entity/value failures must not mutate token retry counters.
  haState = {
    ...haState,
    connected: false,
    powerW: null,
    chargerW: null,
    smoothedPowerW: null,
    smoothedChargerW: null,
    chargerFault: false,
    lastUpdated: new Date(),
    lastError: normalizedReason,
    error: `HA entity read failed: ${normalizedReason}`,
  }

  if (prevConnected) {
    logger.warn('HA_CONNECTIVITY_TRANSITION', {
      from: 'connected',
      to: 'disconnected',
      statusCode,
      reason,
      failureCount: haState.failureCount,
      requiresManualReconnect: haState.requiresManualReconnect,
      category: 'entity_read_failure',
    })
    haEvents.emit('disconnected', haState)
  }
  haEvents.emit('state', haState)

  logger.warn('HA entity/state read failed', {
    statusCode,
    reason,
    failureCount: haState.failureCount,
    requiresManualReconnect: haState.requiresManualReconnect,
  })
}

function markHaManualReconnectRequired(reason: string): void {
  const prevConnected = haState.connected
  haConsecutiveFailures = HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT
  haBackoffUntilMs = Number.POSITIVE_INFINITY
  haLastBackoffMs = 0

  haState = {
    connected: false,
    powerW: null,
    chargerW: null,
    smoothedPowerW: null,
    smoothedChargerW: null,
    chargerFault: false,
    lastUpdated: new Date(),
    failureCount: HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT,
    maxFailuresBeforeManualReconnect: HA_MAX_FAILURES_BEFORE_MANUAL_RECONNECT,
    requiresManualReconnect: true,
    lastError: reason,
    error: `${reason} (manual reconnect required)`,
  }

  if (prevConnected) {
    haEvents.emit('disconnected', haState)
  }
  haEvents.emit('state', haState)
  logger.warn('HA manual reconnect required', { reason })
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
    lastError: null,
    error: undefined,
  }
  logger.info('HA reconnect attempt requested by user; retry lock cleared')
}

export async function triggerHaHealthCheckNow(): Promise<HaState> {
  await pollHaOnce()
  return haState
}

function getAppUrl(): string {
  const raw = process.env.APP_URL?.trim() ?? ''
  return raw.replace(/\/+$/, '')
}

function getOauthClientId(): string {
  const configuredClientId = (process.env.HA_CLIENT_ID ?? '').trim()
  if (configuredClientId) return configuredClientId
  const appUrl = getAppUrl()
  if (appUrl) return appUrl
  return ''
}

function getOauthClientSecret(): string {
  return (process.env.HA_CLIENT_SECRET ?? '').trim()
}

function isHaTokenExpired(tokenObj: HaTokenObj): boolean {
  if (!tokenObj.expires_in || tokenObj.expires_in <= 0) return false
  if (!tokenObj.issued_at_ms || tokenObj.issued_at_ms <= 0) return false
  const expiresAtMs = tokenObj.issued_at_ms + (tokenObj.expires_in * 1000)
  return Date.now() >= (expiresAtMs - HA_TOKEN_REFRESH_MARGIN_MS)
}

export async function getHaTokenValidity(): Promise<{
  hasToken: boolean
  issuedAt: string | null
  expiresAt: string | null
  expiresInSec: number | null
  secondsRemaining: number | null
  isExpired: boolean
  refreshWindowSec: number
}> {
  const tokenObj = await getHaTokenObj()
  if (!tokenObj) {
    return {
      hasToken: false,
      issuedAt: null,
      expiresAt: null,
      expiresInSec: null,
      secondsRemaining: null,
      isExpired: false,
      refreshWindowSec: Math.floor(HA_TOKEN_REFRESH_MARGIN_MS / 1000),
    }
  }

  const issuedAtMs = tokenObj.issued_at_ms ?? null
  const expiresInSec = Number.isFinite(tokenObj.expires_in) ? tokenObj.expires_in : null
  const expiresAtMs = issuedAtMs != null && expiresInSec != null
    ? issuedAtMs + (expiresInSec * 1000)
    : null
  const secondsRemaining = expiresAtMs != null
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : null

  return {
    hasToken: true,
    issuedAt: issuedAtMs != null ? new Date(issuedAtMs).toISOString() : null,
    expiresAt: expiresAtMs != null ? new Date(expiresAtMs).toISOString() : null,
    expiresInSec,
    secondsRemaining,
    isExpired: secondsRemaining != null ? secondsRemaining <= 0 : false,
    refreshWindowSec: Math.floor(HA_TOKEN_REFRESH_MARGIN_MS / 1000),
  }
}

export async function getHaTokenObj(): Promise<HaTokenObj | null> {
  const rec = await prisma.appConfig.findUnique({ where: { id: 1 } })
  if (!rec?.ha_token_obj) return null
  try {
    return JSON.parse(rec.ha_token_obj) as HaTokenObj
  } catch {
    return null
  }
}

export async function saveHaTokenObj(obj: HaTokenObj): Promise<void> {
  const normalized: HaTokenObj = {
    ...obj,
    issued_at_ms: obj.issued_at_ms ?? Date.now(),
  }
  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: { ha_token_obj: JSON.stringify(normalized) },
    create: { id: 1, ha_token_obj: JSON.stringify(normalized) },
  })
  logger.info('HA token object saved')
}

async function clearHaTokenState(reason: string): Promise<void> {
  try {
    await prisma.appConfig.upsert({
      where: { id: 1 },
      update: {
        ha_token_obj: null,
      },
      create: {
        id: 1,
        ha_token_obj: null,
      },
    })
    logger.warn('HA token state cleared', { reason })
  } catch (err) {
    logger.error('Failed to clear HA token state', { err, reason })
  }
}

async function refreshHaAccessToken(tokenObj: HaTokenObj): Promise<string | null> {
  if (!tokenObj.refresh_token) return tokenObj.access_token || null
  if (haTokenRefreshPromise) return haTokenRefreshPromise

  haTokenRefreshPromise = (async () => {
    const cfg = getConfig()
    const haUrl = cfg.homeAssistant.url
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenObj.refresh_token,
    })
    const clientId = getOauthClientId()
    const clientSecret = getOauthClientSecret()
    if (clientId) params.set('client_id', clientId)
    if (clientSecret) params.set('client_secret', clientSecret)

    try {
      const tokenRes = await axios.post<{ access_token: string; refresh_token?: string; expires_in: number }>(
        `${haUrl}/auth/token`,
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
      )

      const refreshed: HaTokenObj = {
        access_token: tokenRes.data.access_token,
        refresh_token: tokenRes.data.refresh_token ?? tokenObj.refresh_token,
        expires_in: tokenRes.data.expires_in,
        issued_at_ms: Date.now(),
      }
      await saveHaTokenObj(refreshed)
      logger.info('HA access token refreshed successfully')
      return refreshed.access_token
    } catch (err) {
      logger.error('HA access token refresh failed', { err })
      const statusCode = axios.isAxiosError(err) ? err.response?.status : undefined
      const isHardAuthFailure = isHaAuthStatus(statusCode)
      if (isHardAuthFailure) {
        await clearHaTokenState(`refresh-failed-${statusCode ?? 'unknown'}`)
        markHaManualReconnectRequired(`HA token refresh rejected (status ${statusCode})`)
      }
      return null
    } finally {
      haTokenRefreshPromise = null
    }
  })()

  return haTokenRefreshPromise
}

export async function getValidHaAccessToken(forceRefresh = false): Promise<string | null> {
  const tokenObj = await getHaTokenObj()
  if (!tokenObj) {
    return null
  }

  if (forceRefresh || isHaTokenExpired(tokenObj)) {
    const refreshed = await refreshHaAccessToken(tokenObj)
    if (refreshed) return refreshed
  }

  return tokenObj.access_token || null
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
      const nextSmoothedPower = applyEma(haState.smoothedPowerW, homePowerW)
      const nextSmoothedCharger = applyEma(haState.smoothedChargerW, carW)
      haState = {
        ...haState,
        connected: true,
        powerW: homePowerW,
        chargerW: carW,
        smoothedPowerW: nextSmoothedPower,
        smoothedChargerW: nextSmoothedCharger,
        chargerFault: false,
        lastUpdated: new Date(),
        error: undefined,
      }
      haEvents.emit('state', haState)
      return
    }
    let token = await getValidHaAccessToken()
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
    const fetchPowerStates = async (accessToken: string) => {
      const headers = { Authorization: `Bearer ${accessToken}` }
      return Promise.allSettled([
        axios.get<HaEntityRead>(`${haUrl}/api/states/${cfg.homeAssistant.powerEntityId}`, { headers, timeout: 5000 }),
        cfg.homeAssistant.chargerEntityId
          ? axios.get<HaEntityRead>(`${haUrl}/api/states/${cfg.homeAssistant.chargerEntityId}`, { headers, timeout: 5000 })
          : Promise.resolve(null),
      ])
    }

    let [powerRes, chargerRes] = await fetchPowerStates(token)

    const firstFailureStatus = powerRes.status === 'rejected' && axios.isAxiosError(powerRes.reason)
      ? powerRes.reason.response?.status
      : undefined
    const shouldRefreshAndRetry = firstFailureStatus === 401 || firstFailureStatus === 403
    if (shouldRefreshAndRetry) {
      const refreshedToken = await getValidHaAccessToken(true)
      if (refreshedToken && refreshedToken !== token) {
        token = refreshedToken
        ;[powerRes, chargerRes] = await fetchPowerStates(token)
      }
    }

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

      if (isHaAuthStatus(powerFailureStatus)) {
        await clearHaTokenState(`poll-failed-${powerFailureStatus}`)
        registerHaFailure(reason, powerFailureStatus)
        return
      }

      registerHaEntityFailure(reason, powerFailureStatus)
      return
    }

    registerHaSuccess()
    const nowMs = Date.now()

    // ── Anomaly detection ────────────────────────────────────────────────────
    // powerW < 0 is VALID: it means solar surplus is exported to the grid.
    // Only chargerW < 0 is a true sensor fault.
    const chargerFault = chargerW != null && chargerW < 0

    if (chargerFault) {
      if (nowMs - lastHaInputQualityWarningAtMs >= 30000) {
        lastHaInputQualityWarningAtMs = nowMs
        logger.warn('HA_INPUT_QUALITY_ANOMALY', {
          kind: 'negative_charger_power',
          powerEntityId: cfg.homeAssistant.powerEntityId,
          chargerEntityId: cfg.homeAssistant.chargerEntityId,
          powerW,
          chargerW,
        })
      }
    }
    if (chargerW != null && powerW > 0 && chargerW > powerW * 1.2) {
      if (nowMs - lastHaInputQualityWarningAtMs >= 30000) {
        lastHaInputQualityWarningAtMs = nowMs
        logger.warn('HA_INPUT_QUALITY_ANOMALY', {
          kind: 'charger_exceeds_total_home',
          powerEntityId: cfg.homeAssistant.powerEntityId,
          chargerEntityId: cfg.homeAssistant.chargerEntityId,
          powerW,
          chargerW,
        })
      }
    }

    // ── EMA smoothing ────────────────────────────────────────────────────────
    // When chargerW is faulty (< 0), exclude it from the smoothed value so the
    // engine can fall back to vehicle telemetry.
    const nextSmoothedPower = applyEma(haState.smoothedPowerW, powerW)
    const nextSmoothedCharger = chargerFault || chargerW == null
      ? haState.smoothedChargerW   // keep previous smoothed value on fault/unavailable
      : applyEma(haState.smoothedChargerW, chargerW)

    haState = {
      ...haState,
      connected: true,
      powerW,
      chargerW,
      smoothedPowerW: nextSmoothedPower,
      smoothedChargerW: nextSmoothedCharger,
      chargerFault,
      lastUpdated: new Date(),
      error: undefined,
    }
    haEvents.emit('state', haState)
  } catch (err) {
    logger.error('HA poll error', { err })
    if (isTransientLocalStateError(err)) {
      logger.warn('HA poll transient local-state error ignored (keeping previous HA connectivity state)', { err: String(err) })
      return
    }
    const statusCode = axios.isAxiosError(err) ? err.response?.status : undefined
    if (isHaAuthStatus(statusCode)) {
      await clearHaTokenState(`poll-exception-${statusCode}`)
      registerHaFailure(String(err), statusCode)
      return
    }
    registerHaEntityFailure(String(err), statusCode)
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
