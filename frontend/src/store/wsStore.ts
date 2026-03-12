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
  sessionId: number | null
  targetSoc: number
  targetAmps: number
  currentAmps: number
  balancing: boolean
  balancingStartedAt: string | null
  phase: 'idle' | 'charging' | 'balancing' | 'complete' | 'paused'
  message: string
  haThrottled: boolean
}

export interface FailsafeState {
  active: boolean
  reason: string
}

interface WsState {
  connected: boolean
  ha: HaState | null
  vehicle: VehicleState | null
  engine: EngineStatus | null
  failsafe: FailsafeState | null
  lastUpdate: string | null
  setConnected: (connected: boolean) => void
  setState: (state: { ha: HaState; vehicle: VehicleState; engine: EngineStatus; failsafe: FailsafeState; timestamp: string }) => void
}

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  ha: null,
  vehicle: null,
  engine: null,
  failsafe: null,
  lastUpdate: null,
  setConnected: (connected) => set({ connected }),
  setState: (state) => set({
    ha: state.ha,
    vehicle: state.vehicle,
    engine: state.engine,
    failsafe: state.failsafe,
    lastUpdate: state.timestamp,
  }),
}))
