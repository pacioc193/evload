import axios from 'axios'
import { EventEmitter } from 'events'
import { logger, sanitizeForLog } from '../logger'
import { getConfig } from '../config'
import { dispatchTelegramNotificationEvent } from './notification-rules.service'

export interface VehicleState {
  connected: boolean
  pluggedIn: boolean
  charging: boolean
  stateOfCharge: number | null
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
  | 'vehicle.summary'
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
  charging: false,
  stateOfCharge: null,
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
  'vehicle.summary',
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
    const pathname = new URL(url).pathname
    if (/\/api\/1\/vehicles\/[^/]+$/.test(pathname)) return 'vehicle.summary'
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

    const [vehicleRes, chargeRes, climateRes] = await Promise.allSettled([
      proxyGet<{ response: { vin: string; display_name: string; state: string; odometer: number } }>(
        `${proxyUrl()}/api/1/vehicles/${vid}`
      ),
      proxyGet<{ response: { charging_state: string; battery_level: number; battery_range: number; charger_voltage: number; charger_actual_current: number; charger_pilot_current: number; charger_phases: number; charge_rate: number; time_to_full_charge: number } }>(
        `${proxyUrl()}/api/1/vehicles/${vid}/data_request/charge_state`
      ),
      proxyGet<{ response: { inside_temp: number; outside_temp: number; is_climate_on: boolean } }>(
        `${proxyUrl()}/api/1/vehicles/${vid}/data_request/climate_state`
      ),
    ])

    const vd = vehicleRes.status === 'fulfilled' ? vehicleRes.value.response : null
    const cd = chargeRes.status === 'fulfilled' ? chargeRes.value.response : null
    const cl = climateRes.status === 'fulfilled' ? climateRes.value.response : null

    const prevConnected = vehicleState.connected
    const VD_CONNECTED = vd !== null
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

    const chargingState = cd?.charging_state || 'Disconnected'
    const charging = chargingState === 'Charging'
    const pluggedIn = ['Charging', 'Stopped', 'Complete'].includes(chargingState)
    const chargeRateKw = cd?.charge_rate != null ? Math.round(cd.charge_rate * 10) / 10 : null

    vehicleState = {
      connected: VD_CONNECTED,
      pluggedIn,
      charging,
      stateOfCharge: nextSoc,
      batteryRange: cd?.battery_range ?? null,
      chargingState,
      chargerVoltage: cd?.charger_voltage ?? null,
      chargerActualCurrent: cd?.charger_actual_current ?? null,
      chargerPilotCurrent: cd?.charger_pilot_current ?? null,
      chargerPhases: cd?.charger_phases ?? null,
      chargeRateKw,
      timeToFullChargeH: cd?.time_to_full_charge ?? null,
      insideTempC: cl?.inside_temp ?? null,
      outsideTempC: cl?.outside_temp ?? null,
      climateOn: cl?.is_climate_on ?? false,
      locked: true,
      odometer: vd?.odometer ?? null,
      vin: vd?.vin ?? null,
      displayName: vd?.display_name ?? null,
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
