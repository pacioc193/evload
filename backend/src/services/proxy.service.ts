import axios from 'axios'
import { EventEmitter } from 'events'
import { logger, sanitizeForLog } from '../logger'
import { getConfig } from '../config'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'

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
  error?: string
}

export type SimulatorEndpointKey =
  | 'vehicle.vehicle_data'
  | 'vehicle.charge_state'
  | 'vehicle.climate_state'
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

export const vehicleEvents = new EventEmitter()

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
}

let pollLock = false
let pollTimer: NodeJS.Timeout | null = null

function proxyUrl(): string {
  return getConfig().proxy.url
}

function vehicleId(): string {
  return getConfig().proxy.vehicleId
}

function computeChargeRateKw(currentA: number | null | undefined, voltageV: number | null | undefined, fallbackKw?: number | null): number | null {
  if (currentA != null && voltageV != null) {
    const kw = (currentA * voltageV) / 1000
    if (Number.isFinite(kw)) return parseFloat(kw.toFixed(2))
  }
  if (fallbackKw != null && Number.isFinite(fallbackKw)) return fallbackKw
  return null
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

async function proxyGet<T>(url: string): Promise<T> {
  if (debugEnabled()) {
    logger.debug('Proxy outbound request', {
      method: 'GET',
      url,
    })
  }
  const res = await axios.get<T>(url, { timeout: 4000 })
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
}

async function proxyPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  if (debugEnabled()) {
    logger.debug('Proxy outbound request', {
      method: 'POST',
      url,
      body: sanitizeForLog(body),
    })
  }
  const res = await axios.post<T>(url, body, { timeout: 10000 })
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
}

const SIMULATOR_ENDPOINT_KEYS: SimulatorEndpointKey[] = [
  'vehicle.vehicle_data',
  'vehicle.charge_state',
  'vehicle.climate_state',
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

async function pollProxyOnce(): Promise<void> {
  if (pollLock) {
    logger.debug('Proxy poll skipped - previous poll still in progress')
    return
  }
  pollLock = true
  try {
    const vid = vehicleId()
    if (!vid) {
      vehicleState = { ...vehicleState, connected: false, error: 'No vehicle ID configured' }
      vehicleEvents.emit('state', vehicleState)
      return
    }

    const vehicleDataRes = await proxyGet<TeslaVehicleDataEnvelope>(`${proxyUrl()}/api/1/vehicles/${vid}/vehicle_data`)

    const fullResponse = vehicleDataRes.response
    const fullBody = fullResponse?.response
    let cd = fullBody?.charge_state ?? null
    let fallbackBody: TeslaVehicleDataBody | undefined

    if (!cd && fullResponse?.result !== false) {
      try {
        const chargeOnlyResponse = await proxyGet<TeslaVehicleDataEnvelope>(`${proxyUrl()}/api/1/vehicles/${vid}/vehicle_data?endpoints=charge_state`)
        fallbackBody = chargeOnlyResponse.response?.response
        cd = fallbackBody?.charge_state ?? null
      } catch (fallbackErr) {
        logger.warn('Proxy charge_state fallback request failed', { fallbackErr })
      }
    }

    const cl = fullBody?.climate_state ?? null
    const vd = fullBody?.vehicle_state ?? null
    const backendReachable = Boolean(fullResponse)
    const vehicleAsleep = fullResponse?.result === false && String(fullResponse.reason ?? '').toLowerCase().includes('sleep')

    const prevConnected = vehicleState.connected
    const VD_CONNECTED = backendReachable
    if (!prevConnected && VD_CONNECTED) {
      vehicleEvents.emit('connected', vehicleState)
      dispatchTelegramNotificationEvent('vehicle_connected', { vehicleId: vid }).catch(() => {})
    } else if (prevConnected && !VD_CONNECTED) {
      vehicleEvents.emit('disconnected', vehicleState)
      dispatchTelegramNotificationEvent('vehicle_disconnected', { vehicleId: vid }).catch(() => {})
    }

    const prevSoc = vehicleState.stateOfCharge
    const nextSoc = cd?.battery_level != null ? Math.round(cd.battery_level) : null

    if (prevSoc !== null && nextSoc !== null && nextSoc > prevSoc) {
      dispatchTelegramNotificationEvent('soc_increased', {
        soc: nextSoc,
        deltaSoc: nextSoc - prevSoc,
      }).catch(() => {})
    }

    const cfg = getConfig()
    if (prevSoc !== null && nextSoc !== null && nextSoc >= cfg.charging.defaultTargetSoc && prevSoc < cfg.charging.defaultTargetSoc) {
      dispatchTelegramNotificationEvent('target_soc_reached', {
        soc: nextSoc,
        targetSoc: cfg.charging.defaultTargetSoc,
      }).catch(() => {})
    }

    const chargingState = cd?.charging_state || (vehicleAsleep ? 'Sleeping' : 'Disconnected')
    const charging = chargingState === 'Charging'
    const cableType = normalizeTeslaNilLike(cd?.conn_charge_cable ?? null)
    const chargePortLatch = normalizeTeslaNilLike(cd?.charge_port_latch ?? null)
    const chargePortDoorOpen = typeof cd?.charge_port_door_open === 'boolean' ? cd.charge_port_door_open : null
    const pluggedIn = Boolean(
      ['Charging', 'Stopped', 'Complete', 'Connected'].includes(chargingState)
      || (chargePortLatch && chargePortLatch.toLowerCase() !== 'disengaged')
      || cableType
    )
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
      connected: VD_CONNECTED,
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
      batteryRange: cd?.battery_range ?? null,
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
      odometer: vd?.odometer ?? null,
      vin: fullResponse?.vin ?? vehicleState.vin ?? vid,
      displayName: cfg.proxy.vehicleName || vehicleState.displayName || 'Vehicle',
      error: fullResponse?.result === false ? String(fullResponse.reason ?? 'Vehicle unavailable') : undefined,
    }

    vehicleEvents.emit('state', vehicleState)
  } catch (err) {
    logger.error('Proxy poll error', { err })
    const prevConnected = vehicleState.connected
    vehicleState = { ...vehicleState, connected: false, error: String(err) }
    if (prevConnected) {
      vehicleEvents.emit('disconnected', vehicleState)
    }
    vehicleEvents.emit('state', vehicleState)
  } finally {
    pollLock = false
  }
}

export function startProxyPoll(): void {
  if (pollTimer) return
  logger.info('Starting proxy polling at 1Hz')
  pollTimer = setInterval(() => {
    pollProxyOnce().catch((err) => logger.error('Unhandled proxy poll rejection', { err }))
  }, 1000)
}

export function stopProxyPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    logger.info('Proxy polling stopped')
  }
}

export function getVehicleState(): VehicleState {
  return vehicleState
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
  const res = await axios.put<unknown>(url, body, { timeout: 10000 })
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
}

export function getSimulatorDebugState(): SimulatorDebugState {
  return {
    lastResponses: Array.from(simulatorLastResponses.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map((entry) => ({ ...entry, payload: safeClone(entry.payload) })),
  }
}
