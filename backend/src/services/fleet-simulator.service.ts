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
  batteryLevel: number
  batteryRange: number
  chargerVoltage: number
  chargerActualCurrent: number
  chargerPilotCurrent: number
  chargerPhases: number
  chargeRate: number
  timeToFullCharge: number
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
  batteryLevel: 45,
  batteryRange: 202,
  chargerVoltage: 230,
  chargerActualCurrent: 0,
  chargerPilotCurrent: 16,
  chargerPhases: 1,
  chargeRate: 0,
  timeToFullCharge: 4.5,
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
  if (!state.pluggedIn) {
    state.chargingState = 'Disconnected'
    state.chargerActualCurrent = 0
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

function applyCommand(cmd: string, body: Record<string, unknown>): Record<string, unknown> {
  switch (cmd) {
    case 'charge_start':
      state.chargingState = state.pluggedIn ? 'Charging' : 'Disconnected'
      state.chargerActualCurrent = state.pluggedIn ? Math.max(0, state.chargerPilotCurrent) : 0
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
        if (state.chargingState.toLowerCase().includes('charging')) {
          state.chargerActualCurrent = state.chargerPilotCurrent
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
    if (body['plugged_in'] !== undefined) state.pluggedIn = Boolean(body['plugged_in'])
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
