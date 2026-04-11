export interface BalancingState {
  balancing: boolean
  balancingStartedAt: Date | null
}

export interface BalancingInput {
  soc: number
  targetSoc: number
  actualAmps: number
  balancingState: BalancingState
  nowMs: number
  /** Vehicle charging_state as reported by proxy (e.g. 'Charging', 'Complete', 'Stopped', ...) */
  chargingState?: string | null
}

export type BalancingAction =
  | { type: 'continue_charging' }
  | { type: 'balancing_in_progress'; message: string }
  | { type: 'stop_charging'; reason: string }

export function computeBalancingAction(input: BalancingInput): BalancingAction {
  const { soc, targetSoc, chargingState } = input

  if (soc < targetSoc) {
    return { type: 'continue_charging' }
  }

  if (targetSoc < 100) {
    return { type: 'stop_charging', reason: `Target SoC ${targetSoc}% reached` }
  }

  // targetSoc == 100: vehicle manages charging and cell balancing autonomously.
  // Stop the session when the vehicle explicitly reports charging as complete.
  if (chargingState === 'Complete') {
    return { type: 'stop_charging', reason: 'Vehicle reported charging complete (100%)' }
  }

  return {
    type: 'balancing_in_progress',
    message: `Vehicle managing charge at SoC: ${soc}%`,
  }
}

export function shouldAdjustAmps(desiredAmps: number, actualAmps: number, threshold: number = 2): boolean {
  return Math.abs(desiredAmps - actualAmps) >= threshold
}

export function clampAmps(amps: number, minAmps: number, maxAmps: number): number {
  return Math.max(minAmps, Math.min(maxAmps, amps))
}
