import express, { Request, Response } from 'express'
import http from 'http'
import { logger } from '../logger'
import { getConfig } from '../config'

interface SimulatorState {
  vehicleId: string
  vin: string
  displayName: string
  state: 'online' | 'asleep'
  odometer: number
  chargingState: string
  chargeLimitSoc: number
  chargeLimitSocMin: number
  chargeLimitSocMax: number
  batteryLevel: number
  usableBatteryLevel: number
  batteryRange: number
  chargerVoltage: number
  chargerActualCurrent: number
  chargerPilotCurrent: number
  chargerPhases: number
  chargeCurrentRequest: number
  chargeCurrentRequestMax: number
  chargeRate: number
  timeToFullCharge: number
  chargePortDoorOpen: boolean
  chargePortLatch: string
  connChargeCable: string
  insideTemp: number
  outsideTemp: number
  climateOn: boolean
  pluggedIn: boolean
  locked: boolean
}

let simServer: http.Server | null = null
let simTick: NodeJS.Timeout | null = null

const state: SimulatorState = {
  vehicleId: 'DEMO000000000001',
  vin: 'DEMO000000000001',
  displayName: 'Demo Vehicle',
  state: 'online',
  odometer: 25241,
  chargingState: 'Connected',
  chargeLimitSoc: 80,
  chargeLimitSocMin: 50,
  chargeLimitSocMax: 100,
  batteryLevel: 45,
  usableBatteryLevel: 45,
  batteryRange: 202,
  chargerVoltage: 230,
  chargerActualCurrent: 0,
  chargerPilotCurrent: 16,
  chargerPhases: 1,
  chargeCurrentRequest: 16,
  chargeCurrentRequestMax: 16,
  chargeRate: 0,
  timeToFullCharge: 4.5,
  chargePortDoorOpen: true,
  chargePortLatch: 'Engaged',
  connChargeCable: 'IEC',
  insideTemp: 18,
  outsideTemp: 12,
  climateOn: false,
  pluggedIn: true,
  locked: false,
}

function recalcDerived(): void {
  state.batteryLevel = Math.max(0, Math.min(100, Math.round(state.batteryLevel)))
  state.batteryRange = Math.round(state.batteryLevel * 4.5)
  state.chargeRate = Number(((state.chargerActualCurrent * state.chargerVoltage) / 1000).toFixed(2))
  state.timeToFullCharge = Number((((100 - state.batteryLevel) / 100) * 8.5).toFixed(1))
  state.usableBatteryLevel = Math.max(0, Math.min(100, state.batteryLevel - 1))
  if (!state.pluggedIn) {
    state.chargingState = 'Disconnected'
    state.chargerActualCurrent = 0
    state.chargePortLatch = 'Disengaged'
    state.connChargeCable = '<nil>'
    state.chargePortDoorOpen = false
  } else {
    state.chargePortLatch = 'Engaged'
    state.connChargeCable = 'IEC'
    state.chargePortDoorOpen = true
  }
}

function ensureVehicle(req: Request, res: Response): boolean {
  const id = String(req.params['vehicleId'] ?? '')
  if (id !== state.vehicleId) {
    res.status(404).json({ error: 'Vehicle not found' })
    return false
  }
  return true
}

function jsonResult(res: Response, payload: unknown): void {
  res.json({ response: payload })
}

function buildVehicleDataBody(): Record<string, unknown> {
  const nowTs = Math.floor(Date.now() / 1000)
  return {
    charge_state: {
      timestamp: nowTs,
      charging_state: state.chargingState,
      charge_limit_soc: state.chargeLimitSoc,
      charge_limit_soc_std: 80,
      charge_limit_soc_min: state.chargeLimitSocMin,
      charge_limit_soc_max: state.chargeLimitSocMax,
      battery_heater_on: false,
      not_enough_power_to_heat: false,
      max_range_charge_counter: 5,
      fast_charger_present: false,
      fast_charger_type: '<nil>',
      battery_level: state.batteryLevel,
      usable_battery_level: state.usableBatteryLevel,
      battery_range: state.batteryRange,
      est_battery_range: Number((state.batteryRange * 1.28).toFixed(5)),
      ideal_battery_range: state.batteryRange,
      charge_energy_added: 0,
      charge_miles_added_rated: 0,
      charge_miles_added_ideal: 0,
      charger_voltage: state.chargerVoltage,
      charger_actual_current: state.chargerActualCurrent,
      charger_pilot_current: state.chargerPilotCurrent,
      charger_power: state.chargeRate,
      charger_phases: state.chargerPhases,
      charge_rate: state.chargeRate,
      charge_port_door_open: state.chargePortDoorOpen,
      scheduled_charging_mode: 'ScheduledChargingModeStartAt',
      scheduled_departure_time: 1769932800,
      scheduled_departure_time_minutes: 0,
      supercharger_session_trip_planner: false,
      scheduled_charging_start_time: 1773702000000,
      scheduled_charging_pending: true,
      user_charge_enable_request: false,
      charge_enable_request: false,
      charge_port_latch: state.chargePortLatch,
      charge_current_request: state.chargeCurrentRequest,
      charge_current_request_max: state.chargeCurrentRequestMax,
      charge_amps: state.chargeCurrentRequest,
      off_peak_charging_enabled: false,
      off_peak_charging_times: 'weekdays',
      off_peak_hours_end_time: 0,
      preconditioning_enabled: false,
      preconditioning_times: 'all_week',
      managed_charging_active: false,
      managed_charging_user_canceled: false,
      managed_charging_start_time: 0,
      charge_port_cold_weather_mode: false,
      charge_port_color: 'ChargePortColorBlue',
      conn_charge_cable: state.connChargeCable,
      fast_charger_brand: '<nil>',
      minutes_to_full_charge: Math.max(0, Math.round(state.timeToFullCharge * 60)),
    },
    climate_state: {
      timestamp: nowTs,
      allow_cabin_overheat_protection: true,
      auto_seat_climate_left: true,
      auto_seat_climate_right: true,
      auto_steering_wheel_heat: true,
      bioweapon_mode: false,
      cabin_overheat_protection: 'CabinOverheatProtectionOff',
      cabin_overheat_protection_actively_cooling: false,
      cop_activation_temperature: 'CopActivationTempHigh',
      inside_temp: state.insideTemp,
      outside_temp: state.outsideTemp,
      driver_temp_setting: state.insideTemp,
      passenger_temp_setting: state.insideTemp,
      left_temp_direction: 0,
      right_temp_direction: 0,
      is_auto_conditioning_on: state.climateOn,
      is_front_defroster_on: false,
      is_rear_defroster_on: false,
      fan_status: state.climateOn ? 3 : 0,
      hvac_auto_request: 'HvacAutoRequestOn',
      is_climate_on: state.climateOn,
      min_avail_temp: 15,
      max_avail_temp: 28,
      seat_heater_left: 0,
      seat_heater_right: 0,
      seat_heater_rear_left: 0,
      seat_heater_rear_right: 0,
      seat_heater_rear_center: 0,
      seat_heater_rear_right_back: 0,
      seat_heater_rear_left_back: 0,
      steering_wheel_heat_level: 1,
      steering_wheel_heater: false,
      supports_fan_only_cabin_overheat_protection: true,
      battery_heater: false,
      battery_heater_no_power: false,
      climate_keeper_mode: 'Unknown',
      defrost_mode: 'Off',
      is_preconditioning: false,
      remote_heater_control_enabled: false,
      side_mirror_heaters: false,
      wiper_blade_heater: false,
    },
    vehicle_state: {
      odometer: state.odometer,
      locked: state.locked,
    },
  }
}

function vehicleDataResponseFor(endpointsParam: string | undefined): Record<string, unknown> {
  if (state.state === 'asleep') {
    return {
      result: false,
      reason: 'vehicle is sleeping',
      vin: state.vin,
      command: 'vehicle_data',
    }
  }

  const body = buildVehicleDataBody()
  let responseBody: Record<string, unknown> = body

  if (endpointsParam === 'charge_state') {
    responseBody = { charge_state: body.charge_state }
  } else if (endpointsParam === 'climate_state') {
    responseBody = { climate_state: body.climate_state }
  }

  return {
    result: true,
    reason: 'The request was successfully processed.',
    vin: state.vin,
    command: 'vehicle_data',
    response: responseBody,
  }
}

function simulatorSleepStatus(): 'VEHICLE_SLEEP_STATUS_AWAKE' | 'VEHICLE_SLEEP_STATUS_ASLEEP' {
  return state.state === 'online' ? 'VEHICLE_SLEEP_STATUS_AWAKE' : 'VEHICLE_SLEEP_STATUS_ASLEEP'
}

function simulatorUserPresence(): 'VEHICLE_USER_PRESENCE_PRESENT' | 'VEHICLE_USER_PRESENCE_NOT_PRESENT' {
  return (state.pluggedIn || state.chargePortDoorOpen)
    ? 'VEHICLE_USER_PRESENCE_PRESENT'
    : 'VEHICLE_USER_PRESENCE_NOT_PRESENT'
}

function buildBodyControllerState(): Record<string, unknown> {
  return {
    vehicleSleepStatus: simulatorSleepStatus(),
    vehicleLockState: state.locked ? 'VEHICLE_LOCK_STATE_LOCKED' : 'VEHICLE_LOCK_STATE_UNLOCKED',
    userPresence: simulatorUserPresence(),
  }
}

function applyCommand(cmd: string, body: Record<string, unknown>): Record<string, unknown> {
  switch (cmd) {
    case 'charge_start':
      state.chargingState = state.pluggedIn ? 'Charging' : 'Disconnected'
      state.chargerActualCurrent = state.pluggedIn ? Math.max(0, state.chargeCurrentRequest) : 0
      break
    case 'charge_stop':
      state.chargingState = state.pluggedIn ? 'Connected' : 'Disconnected'
      state.chargerActualCurrent = 0
      break
    case 'auto_conditioning_start':
      state.climateOn = true
      break
    case 'auto_conditioning_stop':
      state.climateOn = false
      break
    case 'set_charging_amps': {
      const amps = Number(body['charging_amps'])
      if (Number.isFinite(amps)) {
        state.chargerPilotCurrent = Math.max(0, Math.round(amps))
        state.chargeCurrentRequest = state.chargerPilotCurrent
        state.chargeCurrentRequestMax = Math.max(state.chargeCurrentRequestMax, state.chargeCurrentRequest)
        if (state.chargingState.toLowerCase().includes('charging')) {
          state.chargerActualCurrent = state.chargeCurrentRequest
        }
      }
      break
    }
    case 'set_temps': {
      const temp = Number(body['driver_temp'])
      if (Number.isFinite(temp)) {
        state.insideTemp = temp
      }
      break
    }
    case 'wake_up':
      state.state = 'online'
      break
    case 'sleep':
      state.state = 'asleep'
      state.chargerActualCurrent = 0
      break
    default:
      return { result: false, reason: `Unsupported command: ${cmd}` }
  }

  recalcDerived()
  return { result: true, reason: 'simulator', command: cmd }
}

function syncStateFromConfig(): void {
  const cfg = getConfig()
  state.vehicleId = cfg.proxy.vehicleId || state.vehicleId
  state.vin = cfg.proxy.vehicleId || state.vin
  state.displayName = cfg.proxy.vehicleName || state.displayName
}

export function startFleetSimulator(): void {
  const cfg = getConfig()
  if (!cfg.demo) return
  if (simServer) return

  syncStateFromConfig()

  const parsed = new URL(cfg.proxy.url)
  const host = parsed.hostname || '127.0.0.1'
  const port = parseInt(parsed.port || '8080', 10)

  const app = express()
  app.use(express.json())

  app.get('/api/1/vehicles/:vehicleId', (req, res) => {
    if (!ensureVehicle(req, res)) return
    jsonResult(res, {
      vin: state.vin,
      display_name: state.displayName,
      state: state.state,
      odometer: state.odometer,
    })
  })

  app.get('/api/1/vehicles/:vehicleId/vehicle_data', (req, res) => {
    if (!ensureVehicle(req, res)) return
    const endpointsParam = typeof req.query['endpoints'] === 'string' ? req.query['endpoints'] : undefined
    jsonResult(res, vehicleDataResponseFor(endpointsParam))
  })

  app.get('/api/1/vehicles/:vehicleId/body_controller_state', (req, res) => {
    if (!ensureVehicle(req, res)) return
    res.json(buildBodyControllerState())
  })

  app.get('/api/1/vehicles/:vehicleId/data_request/charge_state', (req, res) => {
    if (!ensureVehicle(req, res)) return
    jsonResult(res, {
      charging_state: state.chargingState,
      battery_level: state.batteryLevel,
      battery_range: state.batteryRange,
      charger_voltage: state.chargerVoltage,
      charger_actual_current: state.chargerActualCurrent,
      charger_pilot_current: state.chargerPilotCurrent,
      charger_phases: state.chargerPhases,
      charge_rate: state.chargeRate,
      time_to_full_charge: state.timeToFullCharge,
    })
  })

  app.get('/api/1/vehicles/:vehicleId/data_request/climate_state', (req, res) => {
    if (!ensureVehicle(req, res)) return
    jsonResult(res, {
      inside_temp: state.insideTemp,
      outside_temp: state.outsideTemp,
      is_climate_on: state.climateOn,
    })
  })

  app.put('/api/1/vehicles/:vehicleId/data_request/charge_state', (req, res) => {
    if (!ensureVehicle(req, res)) return
    const body = req.body as Record<string, unknown>
    if (body['battery_level'] !== undefined) state.batteryLevel = Number(body['battery_level'])
    if (body['charging_state'] !== undefined) state.chargingState = String(body['charging_state'])
    if (body['charger_voltage'] !== undefined) state.chargerVoltage = Number(body['charger_voltage'])
    if (body['charger_actual_current'] !== undefined) state.chargerActualCurrent = Number(body['charger_actual_current'])
    if (body['charger_pilot_current'] !== undefined) state.chargerPilotCurrent = Number(body['charger_pilot_current'])
    if (body['charger_phases'] !== undefined) state.chargerPhases = Number(body['charger_phases'])
    if (body['charge_limit_soc'] !== undefined) state.chargeLimitSoc = Math.max(state.chargeLimitSocMin, Math.min(state.chargeLimitSocMax, Number(body['charge_limit_soc'])))
    if (body['charge_current_request'] !== undefined) state.chargeCurrentRequest = Number(body['charge_current_request'])
    if (body['charge_current_request_max'] !== undefined) state.chargeCurrentRequestMax = Number(body['charge_current_request_max'])
    if (body['plugged_in'] !== undefined) state.pluggedIn = Boolean(body['plugged_in'])
    if (body['charge_port_door_open'] !== undefined) state.chargePortDoorOpen = Boolean(body['charge_port_door_open'])
    recalcDerived()
    jsonResult(res, { result: true })
  })

  app.put('/api/1/vehicles/:vehicleId/data_request/climate_state', (req, res) => {
    if (!ensureVehicle(req, res)) return
    const body = req.body as Record<string, unknown>
    if (body['inside_temp'] !== undefined) state.insideTemp = Number(body['inside_temp'])
    if (body['outside_temp'] !== undefined) state.outsideTemp = Number(body['outside_temp'])
    if (body['is_climate_on'] !== undefined) state.climateOn = Boolean(body['is_climate_on'])
    recalcDerived()
    jsonResult(res, { result: true })
  })

  app.post('/api/1/vehicles/:vehicleId/command/:cmd', (req, res) => {
    if (!ensureVehicle(req, res)) return
    const cmd = String(req.params['cmd'] ?? '')
    const result = applyCommand(cmd, (req.body ?? {}) as Record<string, unknown>)
    jsonResult(res, result)
  })

  simServer = app.listen(port, host, () => {
    logger.info(`Fleet simulator listening on ${host}:${port} for vehicleId=${state.vehicleId}`)
  })

  simTick = setInterval(() => {
    if (state.chargingState.toLowerCase().includes('charging') && state.chargerActualCurrent > 0) {
      state.batteryLevel = Math.min(100, state.batteryLevel + (state.chargerActualCurrent / 16) * 0.005)
      recalcDerived()
    }
  }, 1000)
}

export function stopFleetSimulator(): void {
  if (simTick) {
    clearInterval(simTick)
    simTick = null
  }
  if (simServer) {
    simServer.close()
    simServer = null
    logger.info('Fleet simulator stopped')
  }
}
