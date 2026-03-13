import { create } from 'zustand'

export interface HaState {
  connected: boolean
  powerW: number | null
  gridW: number | null
  lastUpdated: string | null
  error?: string
}

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

interface WsState {
  connected: boolean
  demo: boolean
  ha: HaState | null
  vehicle: VehicleState | null
  engine: EngineStatus | null
  failsafe: FailsafeState | null
  simulator: SimulatorDebugState | null
  lastUpdate: string | null
  setConnected: (connected: boolean) => void
  setState: (state: {
    demo?: boolean
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
  ha: null,
  vehicle: null,
  engine: null,
  failsafe: null,
  simulator: null,
  lastUpdate: null,
  setConnected: (connected) => set({ connected }),
  setState: (state) => set({
    demo: state.demo ?? false,
    ha: state.ha,
    vehicle: state.vehicle,
    engine: state.engine,
    failsafe: state.failsafe,
    simulator: state.simulator ?? null,
    lastUpdate: state.timestamp,
  }),
}))
