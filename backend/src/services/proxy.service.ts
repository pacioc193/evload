import axios, { type AxiosInstance } from 'axios'
import https from 'node:https'
import { EventEmitter } from 'events'
import { logger, sanitizeForLog } from '../logger'
import { getConfig } from '../config'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'
import { getEngineStatus } from '../engine/charging.engine'

export type VehicleSleepStatus = 'VEHICLE_SLEEP_STATUS_AWAKE' | 'VEHICLE_SLEEP_STATUS_ASLEEP' | 'VEHICLE_SLEEP_STATUS_UNKNOWN'

export type UserPresence = 'VEHICLE_USER_PRESENCE_PRESENT' | 'VEHICLE_USER_PRESENCE_NOT_PRESENT' | 'VEHICLE_USER_PRESENCE_UNKNOWN'

export interface VehicleState {
  connected: boolean
  pluggedIn: boolean
  cableType: string | null
  chargePortLatch: string | null
  chargePortDoorOpen: boolean | null
  chargeCurrentRequest: number | null
  chargeCurrentRequestMax: number | null
  chargeLimitSocMin: number | null
  chargeLimitSocMax: number | null
  rawChargeState?: Record<string, unknown> | null
  rawClimateState?: Record<string, unknown> | null
  charging: boolean
  stateOfCharge: number | null
  usableBatteryLevel: number | null
  chargeLimitSoc: number | null
  batteryRange: number | null
  chargingState: string | null
  chargerVoltage: number | null
  chargerActualCurrent: number | null
  chargerPilotCurrent: number | null
  chargerPhases: number | null
  chargeRateKw: number | null
  timeToFullChargeH: number | null
  insideTempC: number | null
  outsideTempC: number | null
  climateOn: boolean
  locked: boolean
  odometer: number | null
  vin: string | null
  displayName: string | null
  vehicleSleepStatus: VehicleSleepStatus | null
  userPresence: UserPresence | null
  reason: string | null
  error?: string
}

export type SimulatorEndpointKey =
  | 'vehicle.vehicle_data'
  | 'vehicle.charge_state'
  | 'vehicle.climate_state'
  | 'vehicle.body_controller_state'
  | 'command.charge_start'
  | 'command.charge_stop'
  | 'command.set_charging_amps'
  | 'command.set_temps'
  | 'command.wake_up'
  | 'command.sleep'

export interface SimulatorEndpointRecord {
  endpointKey: SimulatorEndpointKey
  timestamp: string
  source: 'simulated'
  payload: unknown
}

export interface SimulatorDebugState {
  lastResponses: SimulatorEndpointRecord[]
}

export interface ProxyHealthState {
  connected: boolean
  lastSuccessAt: string | null
  lastEndpoint: SimulatorEndpointKey | null
  error: string | null
  /** Unix timestamp (ms) when the vehicle_data polling window expires. null when inactive. */
  vehicleDataWindowExpiresAt: number | null
}

export const vehicleEvents = new EventEmitter()
export const proxyEvents = new EventEmitter()

let vehicleState: VehicleState = {
  connected: false,
  pluggedIn: false,
  cableType: null,
  chargePortLatch: null,
  chargePortDoorOpen: null,
  chargeCurrentRequest: null,
  chargeCurrentRequestMax: null,
  chargeLimitSocMin: null,
  chargeLimitSocMax: null,
  rawChargeState: null,
  rawClimateState: null,
  charging: false,
  stateOfCharge: null,
  usableBatteryLevel: null,
  chargeLimitSoc: null,
  batteryRange: null,
  chargingState: null,
  chargerVoltage: null,
  chargerActualCurrent: null,
  chargerPilotCurrent: null,
  chargerPhases: null,
  chargeRateKw: null,
  timeToFullChargeH: null,
  insideTempC: null,
  outsideTempC: null,
  climateOn: false,
  locked: true,
  odometer: null,
  vin: null,
  displayName: null,
  vehicleSleepStatus: null,
  userPresence: null,
  reason: null,
}

let proxyHealthState: ProxyHealthState = {
  connected: false,
  lastSuccessAt: null,
  lastEndpoint: null,
  error: null,
  vehicleDataWindowExpiresAt: null,
}

let bodyPollLock = false
let vehicleDataPollLock = false
let bodyPollTimer: NodeJS.Timeout | null = null
let vehicleDataPollTimer: NodeJS.Timeout | null = null

/**
 * Timestamp (ms) when the vehicle_data polling window was last started.
 * null = no active window (only body_controller_state will be polled unless charging).
 * The window is started on wake-up, connect, or explicit requestWakeMode() call.
 */
let vehicleDataWindowStartMs: number | null = null

function proxyUrl(): string {
  return getConfig().proxy.url
}

function vehicleId(): string {
  return getConfig().proxy.vehicleId
}

function getAxiosProxy(): AxiosInstance {
  const cfg = getConfig()
  return axios.create({
    httpsAgent: new https.Agent({
      rejectUnauthorized: cfg.proxy.rejectUnauthorized,
    }),
  })
}

function computeChargeRateKw(currentA: number | null | undefined, voltageV: number | null | undefined, fallbackKw?: number | null): number | null {
  if (currentA != null && voltageV != null) {
    const kw = (currentA * voltageV) / 1000
    if (Number.isFinite(kw)) return parseFloat(kw.toFixed(2))
  }
  if (fallbackKw != null && Number.isFinite(fallbackKw)) return fallbackKw
  return null
}

function milesToKm(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Number((value * 1.609344).toFixed(2))
}

function computeTimeToFullChargeH(
  minutesToFull: number | null | undefined,
  stateOfCharge: number | null,
  chargeRateKw: number | null,
  batteryCapacityKwh: number
): number | null {
  if (minutesToFull != null && Number.isFinite(minutesToFull) && minutesToFull > 0) {
    return Number((minutesToFull / 60).toFixed(2))
  }

  if (
    stateOfCharge != null
    && chargeRateKw != null
    && chargeRateKw > 0
    && batteryCapacityKwh > 0
    && stateOfCharge < 100
  ) {
    const remainingEnergyKwh = ((100 - stateOfCharge) / 100) * batteryCapacityKwh
    return Number((remainingEnergyKwh / chargeRateKw).toFixed(2))
  }

  if (minutesToFull === 0) return 0
  return null
}

function debugEnabled(): boolean {
  return (process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug'
}

function markProxySuccess(url: string): void {
  const wasConnected = proxyHealthState.connected
  const endpointKey = endpointKeyFromUrl(url)
  proxyHealthState = {
    connected: true,
    lastSuccessAt: new Date().toISOString(),
    lastEndpoint: endpointKey,
    error: null,
    vehicleDataWindowExpiresAt: null,
  }
  if (!wasConnected) {
    logger.info('PROXY_CONNECTIVITY_TRANSITION', {
      from: 'disconnected',
      to: 'connected',
      endpointKey,
      url,
    })
    proxyEvents.emit('connected', proxyHealthState)
  }
  proxyEvents.emit('state', proxyHealthState)
}

function markProxyError(url: string, err: unknown): void {
  const wasConnected = proxyHealthState.connected
  const endpointKey = endpointKeyFromUrl(url)
  const statusCode = axios.isAxiosError(err) ? err.response?.status : undefined
  const errorCode = axios.isAxiosError(err) ? err.code : undefined
  proxyHealthState = {
    ...proxyHealthState,
    connected: false,
    lastEndpoint: endpointKey ?? proxyHealthState.lastEndpoint,
    error: String(err),
  }
  if (wasConnected) {
    logger.warn('PROXY_CONNECTIVITY_TRANSITION', {
      from: 'connected',
      to: 'disconnected',
      endpointKey,
      url,
      statusCode,
      errorCode,
      error: String(err),
    })
    proxyEvents.emit('disconnected', proxyHealthState)
  }
  logger.warn('PROXY_REQUEST_FAILURE', {
    endpointKey,
    url,
    statusCode,
    errorCode,
    error: String(err),
  })
  proxyEvents.emit('state', proxyHealthState)
}

async function proxyGet<T>(url: string, options?: { timeoutMs?: number }): Promise<T> {
  if (debugEnabled()) {
    logger.debug('Proxy outbound request', {
      method: 'GET',
      url,
    })
  }
  const axiosProxy = getAxiosProxy()
  try {
    const res = await axiosProxy.get<T>(url, { timeout: options?.timeoutMs ?? 4000 })
    markProxySuccess(url)
    const key = endpointKeyFromUrl(url)
    if (key) {
      recordSimulatorResponse(key, res.data, 'simulated')
    }
    if (debugEnabled()) {
      logger.debug('Proxy outbound response', {
        method: 'GET',
        url,
        statusCode: res.status,
        body: sanitizeForLog(res.data),
      })
    }
    return res.data
  } catch (err) {
    // Tesla proxy may return non-200 for sleeping/unavailable vehicle —
    // the proxy itself is reachable, so treat as proxy success but re-parse body.
    if (axios.isAxiosError(err) && err.response?.data != null) {
      const body = err.response.data as Record<string, unknown>
      const innerResponse = (body as Record<string, unknown>)?.response as Record<string, unknown> | undefined
      const reason = String(innerResponse?.reason ?? body?.reason ?? '')
      const isVehicleSleepResponse =
        reason.toLowerCase().includes('sleep') ||
        reason.toLowerCase().includes('asleep') ||
        reason.toLowerCase().includes('offline') ||
        reason.toLowerCase().includes('unavailable')
      if (isVehicleSleepResponse) {
        markProxySuccess(url)
        const key = endpointKeyFromUrl(url)
        if (key) recordSimulatorResponse(key, err.response.data, 'simulated')
        logger.debug('Proxy returned non-200 vehicle-state response (proxy reachable)', {
          url,
          statusCode: err.response.status,
          reason,
        })
        return err.response.data as T
      }
    }
    markProxyError(url, err)
    throw err
  }
}

async function proxyPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  if (debugEnabled()) {
    logger.debug('Proxy outbound request', {
      method: 'POST',
      url,
      body: sanitizeForLog(body),
    })
  }
  const axiosProxy = getAxiosProxy()
  try {
    const res = await axiosProxy.post<T>(url, body, { timeout: 10000 })
    markProxySuccess(url)
    const key = endpointKeyFromUrl(url)
    if (key) {
      recordSimulatorResponse(key, res.data, 'simulated')
    }
    if (debugEnabled()) {
      logger.debug('Proxy outbound response', {
        method: 'POST',
        url,
        statusCode: res.status,
        body: sanitizeForLog(res.data),
      })
    }
    return res.data
  } catch (err) {
    markProxyError(url, err)
    throw err
  }
}

const SIMULATOR_ENDPOINT_KEYS: SimulatorEndpointKey[] = [
  'vehicle.vehicle_data',
  'vehicle.charge_state',
  'vehicle.climate_state',
  'vehicle.body_controller_state',
  'command.charge_start',
  'command.charge_stop',
  'command.set_charging_amps',
  'command.set_temps',
  'command.wake_up',
  'command.sleep',
]

const simulatorLastResponses = new Map<SimulatorEndpointKey, SimulatorEndpointRecord>()

function safeClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

function isSimulatorEndpointKey(value: string): value is SimulatorEndpointKey {
  return SIMULATOR_ENDPOINT_KEYS.includes(value as SimulatorEndpointKey)
}

function endpointKeyFromUrl(url: string): SimulatorEndpointKey | null {
  try {
    const parsedUrl = new URL(url)
    const pathname = parsedUrl.pathname
    if (/\/api\/1\/vehicles\/[^/]+\/vehicle_data$/.test(pathname)) {
      const endpoint = parsedUrl.searchParams.get('endpoints')
      if (endpoint === 'charge_state') return 'vehicle.charge_state'
      if (endpoint === 'climate_state') return 'vehicle.climate_state'
      return 'vehicle.vehicle_data'
    }
    if (/\/api\/1\/vehicles\/[^/]+\/body_controller_state$/.test(pathname)) return 'vehicle.body_controller_state'
    if (/\/api\/1\/vehicles\/[^/]+\/data_request\/charge_state$/.test(pathname)) return 'vehicle.charge_state'
    if (/\/api\/1\/vehicles\/[^/]+\/data_request\/climate_state$/.test(pathname)) return 'vehicle.climate_state'
    const commandMatch = pathname.match(/\/api\/1\/vehicles\/[^/]+\/command\/([^/]+)$/)
    if (!commandMatch) return null
    const cmd = commandMatch[1]
    const map: Record<string, SimulatorEndpointKey> = {
      charge_start: 'command.charge_start',
      charge_stop: 'command.charge_stop',
      set_charging_amps: 'command.set_charging_amps',
      set_temps: 'command.set_temps',
      wake_up: 'command.wake_up',
      sleep: 'command.sleep',
    }
    return map[cmd] ?? null
  } catch {
    return null
  }
}

interface TeslaVehicleDataChargeState {
  charging_state?: string
  charge_limit_soc?: number
  charge_limit_soc_min?: number
  charge_limit_soc_max?: number
  battery_level?: number
  usable_battery_level?: number
  battery_range?: number
  charger_voltage?: number
  charger_actual_current?: number
  charger_pilot_current?: number
  charger_phases?: number
  charger_power?: number
  charge_rate?: number
  charge_current_request?: number
  charge_current_request_max?: number
  charge_port_latch?: string
  charge_port_door_open?: boolean
  conn_charge_cable?: string
  minutes_to_full_charge?: number
}

function normalizeTeslaNilLike(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed === '<nil>' || trimmed === '<invalid>' || trimmed.toLowerCase() === 'nil') return null
  return trimmed
}

interface TeslaVehicleDataClimateState {
  inside_temp?: number
  outside_temp?: number
  is_climate_on?: boolean
}

interface TeslaVehicleDataBody {
  charge_state?: TeslaVehicleDataChargeState
  climate_state?: TeslaVehicleDataClimateState
  vehicle_state?: {
    odometer?: number
    locked?: boolean
  }
}

interface TeslaVehicleDataEnvelope {
  response?: {
    result?: boolean
    reason?: string
    vin?: string
    command?: string
    response?: TeslaVehicleDataBody
  }
}

function recordSimulatorResponse(endpointKey: SimulatorEndpointKey, payload: unknown, source: 'simulated'): void {
  simulatorLastResponses.set(endpointKey, {
    endpointKey,
    timestamp: new Date().toISOString(),
    source,
    payload: safeClone(payload),
  })
}

interface BodyControllerStateResponse {
  vehicle_sleep_status?: string
  user_presence?: string
  vehicle_lock_state?: string
  closure_statuses?: Record<string, string>
}

interface BodyControllerStateEnvelope {
  response?: {
    result?: boolean
    reason?: string
    vin?: string
    command?: string
    response?: BodyControllerStateResponse
  }
}

/**
 * Fetch the body controller state from the proxy.
 * This endpoint does NOT wake up the vehicle.
 * Returns the parsed sleep status, or 'VEHICLE_SLEEP_STATUS_UNKNOWN' on any error.
 */
async function fetchBodyControllerStatus(vid: string): Promise<{ sleepStatus: VehicleSleepStatus; userPresence: UserPresence }> {
  const url = `${proxyUrl()}/api/1/vehicles/${vid}/body_controller_state`
  try {
    const res = await proxyGet<BodyControllerStateEnvelope>(url, { timeoutMs: 8000 })
    const inner = res.response?.response
    const rawSleep = inner?.vehicle_sleep_status ?? ''
    const rawPresence = inner?.user_presence ?? ''

    const sleepStatus: VehicleSleepStatus =
      rawSleep === 'VEHICLE_SLEEP_STATUS_ASLEEP'
        ? 'VEHICLE_SLEEP_STATUS_ASLEEP'
        : rawSleep === 'VEHICLE_SLEEP_STATUS_AWAKE'
          ? 'VEHICLE_SLEEP_STATUS_AWAKE'
          : 'VEHICLE_SLEEP_STATUS_UNKNOWN'

    const userPresence: UserPresence =
      rawPresence === 'VEHICLE_USER_PRESENCE_PRESENT'
        ? 'VEHICLE_USER_PRESENCE_PRESENT'
        : rawPresence === 'VEHICLE_USER_PRESENCE_NOT_PRESENT'
          ? 'VEHICLE_USER_PRESENCE_NOT_PRESENT'
          : 'VEHICLE_USER_PRESENCE_UNKNOWN'

    return { sleepStatus, userPresence }
  } catch (err) {
    logger.warn('😴[SLEEP_CHECK] body_controller_state fetch failed, assuming unknown', { err })
    return { sleepStatus: 'VEHICLE_SLEEP_STATUS_UNKNOWN', userPresence: 'VEHICLE_USER_PRESENCE_UNKNOWN' }
  }
}

async function pollBodyController(): Promise<void> {
  if (bodyPollLock) {
    logger.debug('Body controller poll skipped - previous poll still in progress')
    return
  }
  bodyPollLock = true
  try {
    const vid = vehicleId()
    if (!vid) {
      vehicleState = { ...vehicleState, connected: false, error: 'No vehicle ID configured' }
      vehicleEvents.emit('state', vehicleState)
      return
    }

    const cfg = getConfig()
    const { sleepStatus, userPresence } = await fetchBodyControllerStatus(vid)
    const prevSleepStatus = vehicleState.vehicleSleepStatus

    if (sleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP') {
      // If the vehicle just went to sleep, close the vehicle_data window and stop the vehicle data timer.
      if (vehicleDataWindowStartMs !== null) {
        vehicleDataWindowStartMs = null
        scheduleVehicleDataPoll() // will detect no window/no charging and clear the timer
      }
      vehicleState = {
        ...vehicleState,
        vehicleSleepStatus: 'VEHICLE_SLEEP_STATUS_ASLEEP',
        userPresence,
        chargingState: 'Sleeping',
        charging: false,
        connected: true,
      }
      if (prevSleepStatus !== 'VEHICLE_SLEEP_STATUS_ASLEEP') {
        logger.info('😴[SLEEP_DETECTED] Vehicle is asleep – vehicle_data polling suspended', { vehicleId: vid })
      }
    } else {
      // Vehicle is awake (or unknown). On wake transition, open the vehicle_data window and start its timer.
      if (prevSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP') {
        logger.info('☀️[WAKE_DETECTED] Vehicle woke up – opening vehicle_data window', { vehicleId: vid })
        vehicleDataWindowStartMs = Date.now()
        scheduleVehicleDataPoll() // start polling vehicle_data now that window is open
      }
      vehicleState = {
        ...vehicleState,
        vehicleSleepStatus: sleepStatus,
        userPresence,
        connected: true,
      }
    }

    vehicleEvents.emit('state', vehicleState)
  } catch (err) {
    logger.error('Body controller poll error', { err })
  } finally {
    bodyPollLock = false
  }
}

async function pollVehicleData(): Promise<void> {
  if (vehicleDataPollLock) {
    logger.debug('Vehicle data poll skipped - previous poll still in progress')
    return
  }

  const cfg = getConfig()
  const isCurrentlyCharging = vehicleState.charging
  const engineRunning = getEngineStatus().running
  const windowActive = vehicleDataWindowStartMs !== null
    && (Date.now() - vehicleDataWindowStartMs) < cfg.proxy.vehicleDataWindowMs

  if (!isCurrentlyCharging && !engineRunning && !windowActive) {
    // Nothing to do — the timer should not have been scheduled, but guard here just in case.
    return
  }

  vehicleDataPollLock = true
  try {
    const vid = vehicleId()
    if (!vid) return

    // ── Step: Fetch full vehicle data ──
    const vehicleDataRes = await proxyGet<TeslaVehicleDataEnvelope>(`${proxyUrl()}/api/1/vehicles/${vid}/vehicle_data`, { timeoutMs: 8000 })

    const fullResponse = vehicleDataRes.response
    const fullBody = fullResponse?.response
    const cd = fullBody?.charge_state ?? null
    const cl = fullBody?.climate_state ?? null
    const vd = fullBody?.vehicle_state ?? null
    const vehicleReachable = fullResponse?.result === true
    const vehicleAsleep = fullResponse?.result === false && String(fullResponse.reason ?? '').toLowerCase().includes('sleep')

    const prevConnected = vehicleState.connected
    const nextConnected = vehicleReachable
    const prevPluggedIn = vehicleState.pluggedIn
    const prevCharging = vehicleState.charging

    if (!prevConnected && nextConnected) {
      // Vehicle just connected — open the vehicle_data window
      vehicleDataWindowStartMs = Date.now()
      logger.info('🔗[CONNECT_DETECTED] Vehicle connected – opening vehicle_data window', { vehicleId: vid })
      vehicleEvents.emit('connected', vehicleState)
      dispatchTelegramNotificationEvent('vehicle_connected', { vehicleId: vid }).catch(() => {})
    } else if (prevConnected && !nextConnected) {
      vehicleEvents.emit('disconnected', vehicleState)
      dispatchTelegramNotificationEvent('vehicle_disconnected', { vehicleId: vid }).catch(() => {})
      dispatchTelegramNotificationEvent('proxy_error', { vehicleId: vid, reason: 'Connection lost' }).catch(() => {})
    }

    const prevSoc = vehicleState.stateOfCharge
    const nextSoc = cd?.battery_level != null ? Math.round(cd.battery_level) : null

    if (prevSoc !== null && nextSoc !== null && nextSoc > prevSoc) {
      dispatchTelegramNotificationEvent('soc_increased', {
        soc: nextSoc,
        deltaSoc: nextSoc - prevSoc,
      }).catch(() => {})
    }

    if (prevSoc !== null && nextSoc !== null && nextSoc >= cfg.charging.defaultTargetSoc && prevSoc < cfg.charging.defaultTargetSoc) {
      dispatchTelegramNotificationEvent('target_soc_reached', {
        soc: nextSoc,
        targetSoc: cfg.charging.defaultTargetSoc,
      }).catch(() => {})
    }

    const chargingState = cd?.charging_state || (vehicleAsleep ? 'Sleeping' : 'Disconnected')
    const charging = chargingState === 'Charging'

    const sleepStatus: VehicleSleepStatus = vehicleAsleep
      ? 'VEHICLE_SLEEP_STATUS_ASLEEP'
      : 'VEHICLE_SLEEP_STATUS_AWAKE'
    const cableType = normalizeTeslaNilLike(cd?.conn_charge_cable ?? null)
    const chargePortLatch = normalizeTeslaNilLike(cd?.charge_port_latch ?? null)
    const chargePortDoorOpen = typeof cd?.charge_port_door_open === 'boolean' ? cd.charge_port_door_open : null
    const pluggedIn = Boolean(
      ['Charging', 'Stopped', 'Complete', 'Connected'].includes(chargingState)
      || (chargePortLatch && chargePortLatch.toLowerCase() !== 'disengaged')
      || cableType
    )

    logger.debug('Vehicle data poll parsed', {
      httpResult: fullResponse?.result,
      reason: fullResponse?.reason,
      vehicleReachable,
      vehicleAsleep,
      chargingState,
      pluggedIn,
      stateOfCharge: nextSoc,
    })
    const chargeLimitSoc = cd?.charge_limit_soc != null ? Math.round(cd.charge_limit_soc) : null
    const chargeLimitSocMin = cd?.charge_limit_soc_min != null ? Math.round(cd.charge_limit_soc_min) : null
    const chargeLimitSocMax = cd?.charge_limit_soc_max != null ? Math.round(cd.charge_limit_soc_max) : null
    const usableBatteryLevel = cd?.usable_battery_level != null ? Math.round(cd.usable_battery_level) : null
    const chargeRateKw = computeChargeRateKw(
      cd?.charger_actual_current ?? null,
      cd?.charger_voltage ?? null,
      cd?.charger_power ?? null
    )
    const timeToFullChargeH = computeTimeToFullChargeH(
      cd?.minutes_to_full_charge ?? null,
      nextSoc,
      chargeRateKw,
      cfg.charging.batteryCapacityKwh
    )

    vehicleState = {
      connected: nextConnected,
      pluggedIn,
      cableType,
      chargePortLatch,
      chargePortDoorOpen,
      chargeCurrentRequest: cd?.charge_current_request ?? null,
      chargeCurrentRequestMax: cd?.charge_current_request_max ?? null,
      chargeLimitSocMin,
      chargeLimitSocMax,
      rawChargeState: cd ? safeClone(cd as Record<string, unknown>) : null,
      rawClimateState: cl ? safeClone(cl as Record<string, unknown>) : null,
      charging,
      stateOfCharge: nextSoc,
      usableBatteryLevel,
      chargeLimitSoc,
      batteryRange: milesToKm(cd?.battery_range ?? null),
      chargingState,
      chargerVoltage: cd?.charger_voltage ?? null,
      chargerActualCurrent: cd?.charger_actual_current ?? null,
      chargerPilotCurrent: cd?.charger_pilot_current ?? null,
      chargerPhases: cd?.charger_phases ?? null,
      chargeRateKw,
      timeToFullChargeH,
      insideTempC: cl?.inside_temp ?? null,
      outsideTempC: cl?.outside_temp ?? null,
      climateOn: cl?.is_climate_on ?? false,
      locked: vd?.locked ?? true,
      odometer: milesToKm(vd?.odometer ?? null),
      vin: fullResponse?.vin ?? vehicleState.vin ?? vid,
      displayName: cfg.proxy.vehicleName || vehicleState.displayName || 'Vehicle',
      vehicleSleepStatus: sleepStatus,
      userPresence: 'VEHICLE_USER_PRESENCE_UNKNOWN',
      reason: String(fullResponse?.reason ?? (vehicleReachable ? 'The request was successfully processed.' : 'Vehicle unreachable')),
      error: fullResponse?.result === false ? String(fullResponse.reason ?? 'Vehicle unavailable') : undefined,
    }

    vehicleEvents.emit('state', vehicleState)

    // ── Charging state transition logs ────────────────────────────────────────
    if (!prevCharging && charging) {
      logger.info('🔌 [PROXY_POLL] Vehicle entered Charging state (detected via poll)', {
        vehicleId: vid,
        chargingState,
        soc: nextSoc,
        chargerActualCurrent: cd?.charger_actual_current ?? null,
        chargerVoltage: cd?.charger_voltage ?? null,
        chargeRateKw: computeChargeRateKw(
          cd?.charger_actual_current ?? null,
          cd?.charger_voltage ?? null,
          cd?.charger_power ?? null
        ),
      })
      vehicleEvents.emit('charging_started', {
        vehicleId: vid,
        chargingState,
        soc: nextSoc,
        chargerActualCurrent: cd?.charger_actual_current ?? null,
        chargerVoltage: cd?.charger_voltage ?? null,
      })
    } else if (prevCharging && !charging) {
      logger.info('🔋 [PROXY_POLL] Vehicle left Charging state (detected via poll)', {
        vehicleId: vid,
        chargingState,
        soc: nextSoc,
        chargerActualCurrent: cd?.charger_actual_current ?? null,
      })
    }

    // Detect and emit garage state changes
    if (!prevPluggedIn && pluggedIn) {
      dispatchTelegramNotificationEvent('vehicle_in_garage', { vehicleId: vid, reason: 'Cable connected' }).catch(() => {})
    } else if (prevPluggedIn && !pluggedIn) {
      dispatchTelegramNotificationEvent('vehicle_not_in_garage', { vehicleId: vid, reason: 'Cable disconnected' }).catch(() => {})
    }
  } catch (err) {
    logger.error('Vehicle data poll error', { err })
    const prevConnected = vehicleState.connected
    const nextConnected = false
    vehicleState = { ...vehicleState, connected: nextConnected, reason: String(err), error: String(err) }
    if (prevConnected && !nextConnected) {
      vehicleEvents.emit('disconnected', vehicleState)
      dispatchTelegramNotificationEvent('proxy_error', { vehicleId: vehicleId(), reason: String(err) }).catch(() => {})
    }
    vehicleEvents.emit('state', vehicleState)
  } finally {
    vehicleDataPollLock = false
  }
}

export function startProxyPoll(): void {
  if (bodyPollTimer) return
  logger.info('Starting proxy polling — body timer always on, vehicle_data timer conditional')
  scheduleBodyPoll()
  scheduleVehicleDataPoll() // will start if window/charging, otherwise no-op
}

export function stopProxyPoll(): void {
  if (bodyPollTimer) {
    clearTimeout(bodyPollTimer)
    bodyPollTimer = null
  }
  if (vehicleDataPollTimer) {
    clearTimeout(vehicleDataPollTimer)
    vehicleDataPollTimer = null
  }
  logger.info('Proxy polling stopped')
}

export async function triggerImmediatePoll(): Promise<void> {
  if (bodyPollTimer) {
    clearTimeout(bodyPollTimer)
    bodyPollTimer = null
  }
  if (vehicleDataPollTimer) {
    clearTimeout(vehicleDataPollTimer)
    vehicleDataPollTimer = null
  }
  logger.debug('Proxy immediate poll triggered')
  try {
    await pollBodyController()
  } catch (err) {
    logger.error('Unhandled immediate body poll rejection', { err })
  }
  try {
    await pollVehicleData()
  } catch (err) {
    logger.error('Unhandled immediate vehicle data poll rejection', { err })
  }
  scheduleBodyPoll()
  scheduleVehicleDataPoll()
}

function scheduleBodyPoll(): void {
  if (bodyPollTimer) clearTimeout(bodyPollTimer)
  const cfg = getConfig()
  bodyPollTimer = setTimeout(async () => {
    try {
      await pollBodyController()
    } catch (err) {
      logger.error('Unhandled body poll rejection', { err })
    }
    scheduleBodyPoll()
  }, cfg.proxy.bodyPollIntervalMs)
}

function scheduleVehicleDataPoll(): void {
  if (vehicleDataPollTimer) {
    clearTimeout(vehicleDataPollTimer)
    vehicleDataPollTimer = null
  }

  const cfg = getConfig()
  const isCharging = vehicleState.charging
  const engineRunning = getEngineStatus().running
  const windowActive = vehicleDataWindowStartMs !== null
    && (Date.now() - vehicleDataWindowStartMs) < cfg.proxy.vehicleDataWindowMs

  if (!isCharging && !engineRunning && !windowActive) {
    // No condition requires vehicle_data — timer stays stopped.
    return
  }

  const interval = (isCharging || engineRunning)
    ? cfg.proxy.chargingPollIntervalMs
    : cfg.proxy.windowPollIntervalMs

  vehicleDataPollTimer = setTimeout(async () => {
    try {
      await pollVehicleData()
    } catch (err) {
      logger.error('Unhandled vehicle data poll rejection', { err })
    }
    scheduleVehicleDataPoll()
  }, interval)
}

export function getVehicleState(): VehicleState {
  return vehicleState
}

export function getProxyHealthState(): ProxyHealthState {
  const cfg = getConfig()
  const now = Date.now()
  const expiry = vehicleDataWindowStartMs !== null
    ? vehicleDataWindowStartMs + cfg.proxy.vehicleDataWindowMs
    : null
  return {
    ...proxyHealthState,
    vehicleDataWindowExpiresAt: expiry !== null && expiry > now ? expiry : null,
  }
}

export function onUserPresenceChange(callback: (presence: UserPresence) => void): void {
  void callback
}

export async function requestWakeMode(sendWakeCommand = false): Promise<void> {
  if (sendWakeCommand) {
    try {
      const vid = vehicleId()
      if (vid) {
        logger.info('Sending wake_up command via proxy')
        await sendProxyCommand(vid, 'wake_up')
      }
    } catch (err) {
      logger.error('Failed to send wake_up command', { err })
    }
  }

  // Open the vehicle_data window so we immediately start fetching full vehicle data
  vehicleDataWindowStartMs = Date.now()
  logger.info('☀️[WAKE_MODE] vehicle_data window opened (requestWakeMode)')

  if (vehicleDataPollTimer) clearTimeout(vehicleDataPollTimer)
  scheduleVehicleDataPoll()
}

export async function sendProxyCommand(vehicleId: string, command: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `${proxyUrl()}/api/1/vehicles/${vehicleId}/command/${command}`
  return proxyPost<unknown>(url, body ?? {})
}

export async function updateProxyDataRequest(
  vehicleId: string,
  section: 'charge_state' | 'climate_state',
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${proxyUrl()}/api/1/vehicles/${vehicleId}/data_request/${section}`
  if (debugEnabled()) {
    logger.debug('Proxy outbound request', {
      method: 'PUT',
      url,
      body: sanitizeForLog(body),
    })
  }
  try {
    const res = await getAxiosProxy().put<unknown>(url, body, { timeout: 10000 })
    markProxySuccess(url)
    const key = endpointKeyFromUrl(url)
    if (key) {
      recordSimulatorResponse(key, res.data, 'simulated')
    }
    if (debugEnabled()) {
      logger.debug('Proxy outbound response', {
        method: 'PUT',
        url,
        statusCode: res.status,
        body: sanitizeForLog(res.data),
      })
    }
    return res.data
  } catch (err) {
    markProxyError(url, err)
    throw err
  }
}

export function getSimulatorDebugState(): SimulatorDebugState {
  return {
    lastResponses: Array.from(simulatorLastResponses.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map((entry) => ({ ...entry, payload: safeClone(entry.payload) })),
  }
}
