import { create } from 'zustand'

export interface HaState {
  connected: boolean
  powerW: number | null
  chargerW: number | null
  lastUpdated: string | null
  error?: string
}

export interface VehicleState {
  connected: boolean
  pluggedIn: boolean
  cableType: string | null
  chargePortLatch: string | null
  chargePortDoorOpen: boolean | null
  chargeCurrentRequest: number | null
  chargeCurrentRequestMax: number | null
  charging: boolean
  rawChargeState?: Record<string, unknown> | null
  rawClimateState?: Record<string, unknown> | null
  stateOfCharge: number | null
  usableBatteryLevel: number | null
  chargeLimitSoc: number | null
  chargeLimitSocMin?: number | null
  chargeLimitSocMax?: number | null
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

export interface EngineStatus {
  running: boolean
  mode: 'off' | 'plan' | 'on'
  sessionId: number | null
  targetSoc: number
  targetAmps: number
  setpointAmps: number
  currentAmps: number
  balancing: boolean
  balancingStartedAt: string | null
  phase: 'idle' | 'charging' | 'balancing' | 'complete' | 'paused'
  message: string
  haThrottled: boolean
  debugLog: string[]
}

export interface FailsafeState {
  active: boolean
  reason: string
}

export interface SimulatorEndpointRecord {
  endpointKey: string
  timestamp: string
  source: 'simulated' | 'override'
  payload: unknown
}

export interface SimulatorDebugState {
  lastResponses: SimulatorEndpointRecord[]
}

export interface WsChargingSettings {
  energyPriceEurPerKwh: number
  batteryCapacityKwh: number
}

interface WsState {
  connected: boolean
  demo: boolean
  charging: WsChargingSettings | null
  ha: HaState | null
  vehicle: VehicleState | null
  engine: EngineStatus | null
  failsafe: FailsafeState | null
  simulator: SimulatorDebugState | null
  lastUpdate: string | null
  setConnected: (connected: boolean) => void
  setState: (state: {
    demo?: boolean
    charging?: WsChargingSettings
    ha: HaState
    vehicle: VehicleState
    engine: EngineStatus
    failsafe: FailsafeState
    simulator?: SimulatorDebugState
    timestamp: string
  }) => void
}

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  demo: false,
  charging: null,
  ha: null,
  vehicle: null,
  engine: null,
  failsafe: null,
  simulator: null,
  lastUpdate: null,
  setConnected: (connected) => set({ connected }),
  setState: (state) => set({
    demo: state.demo ?? false,
    charging: state.charging ?? null,
    ha: state.ha,
    vehicle: state.vehicle,
    engine: state.engine,
    failsafe: state.failsafe,
    simulator: state.simulator ?? null,
    lastUpdate: state.timestamp,
  }),
}))
