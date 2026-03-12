import axios from 'axios'
import { EventEmitter } from 'events'
import { logger } from '../logger'
import { getConfig } from '../config'

export interface VehicleState {
  connected: boolean
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

export const vehicleEvents = new EventEmitter()

let vehicleState: VehicleState = {
  connected: false,
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

// Demo mode state
let demoSoc = 45
let demoClimateOn = false
let demoClimateTemp = 21

function getDemoVehicleState(): VehicleState {
  return {
    connected: true,
    charging: true,
    stateOfCharge: Math.min(demoSoc, 100),
    batteryRange: Math.round(Math.min(demoSoc, 100) * 4.5),
    chargingState: 'Charging',
    chargerVoltage: 230,
    chargerActualCurrent: 16,
    chargerPilotCurrent: 16,
    chargerPhases: 1,
    chargeRateKw: 3.68,
    timeToFullChargeH: parseFloat(((100 - Math.min(demoSoc, 100)) / 100 * 8.5).toFixed(1)),
    insideTempC: demoClimateOn ? demoClimateTemp : 18,
    outsideTempC: 12,
    climateOn: demoClimateOn,
    locked: false,
    odometer: 25241,
    vin: 'DEMO000000000001',
    displayName: 'Demo Vehicle',
  }
}

async function pollProxyOnce(): Promise<void> {
  if (pollLock) {
    logger.debug('Proxy poll skipped - previous poll still in progress')
    return
  }
  pollLock = true
  try {
    if (getConfig().demo) {
      demoSoc = Math.min(demoSoc + 0.005, 100) // ~1% per 200s in demo
      const prev = vehicleState.connected
      vehicleState = getDemoVehicleState()
      if (!prev) vehicleEvents.emit('connected', vehicleState)
      vehicleEvents.emit('state', vehicleState)
      return
    }
    const vid = vehicleId()
    if (!vid) {
      vehicleState = { ...vehicleState, connected: false, error: 'No vehicle ID configured' }
      vehicleEvents.emit('state', vehicleState)
      return
    }

    const [vehicleRes, chargeRes, climateRes] = await Promise.allSettled([
      axios.get<{ response: { vin: string; display_name: string; state: string; odometer: number } }>(
        `${proxyUrl()}/api/1/vehicles/${vid}`, { timeout: 4000 }
      ),
      axios.get<{ response: { charging_state: string; battery_level: number; battery_range: number; charger_voltage: number; charger_actual_current: number; charger_pilot_current: number; charger_phases: number; charge_rate: number; time_to_full_charge: number } }>(
        `${proxyUrl()}/api/1/vehicles/${vid}/data_request/charge_state`, { timeout: 4000 }
      ),
      axios.get<{ response: { inside_temp: number; outside_temp: number; is_climate_on: boolean } }>(
        `${proxyUrl()}/api/1/vehicles/${vid}/data_request/climate_state`, { timeout: 4000 }
      ),
    ])

    const prevConnected = vehicleState.connected
    const vd = vehicleRes.status === 'fulfilled' ? vehicleRes.value.data.response : null
    const cd = chargeRes.status === 'fulfilled' ? chargeRes.value.data.response : null
    const cl = climateRes.status === 'fulfilled' ? climateRes.value.data.response : null

    vehicleState = {
      connected: vd !== null,
      charging: cd?.charging_state === 'Charging',
      stateOfCharge: cd?.battery_level ?? null,
      batteryRange: cd?.battery_range ?? null,
      chargingState: cd?.charging_state ?? null,
      chargerVoltage: cd?.charger_voltage ?? null,
      chargerActualCurrent: cd?.charger_actual_current ?? null,
      chargerPilotCurrent: cd?.charger_pilot_current ?? null,
      chargerPhases: cd?.charger_phases ?? null,
      chargeRateKw: cd?.charge_rate ?? null,
      timeToFullChargeH: cd?.time_to_full_charge ?? null,
      insideTempC: cl?.inside_temp ?? null,
      outsideTempC: cl?.outside_temp ?? null,
      climateOn: cl?.is_climate_on ?? false,
      locked: true,
      odometer: vd?.odometer ?? null,
      vin: vd?.vin ?? null,
      displayName: vd?.display_name ?? null,
    }

    if (!prevConnected && vehicleState.connected) {
      vehicleEvents.emit('connected', vehicleState)
    } else if (prevConnected && !vehicleState.connected) {
      vehicleEvents.emit('disconnected', vehicleState)
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
  if (getConfig().demo) {
    logger.debug(`[DEMO] sendProxyCommand ${command}`, { body })
    if (command === 'auto_conditioning_start') demoClimateOn = true
    if (command === 'auto_conditioning_stop') demoClimateOn = false
    if (command === 'set_temps' && body?.['driver_temp'] !== undefined) {
      demoClimateTemp = Number(body['driver_temp'])
    }
    return { result: true, reason: 'demo' }
  }
  const url = `${proxyUrl()}/api/1/vehicles/${vehicleId}/command/${command}`
  const res = await axios.post<unknown>(url, body ?? {}, { timeout: 10000 })
  return res.data
}
