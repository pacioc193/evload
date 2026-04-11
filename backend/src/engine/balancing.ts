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
  // Stop the session as soon as the vehicle is no longer actively charging:
  //   - 'Complete'  → charging finished (normal end)
  //   - 'Sleeping'  → car completed and went to sleep (most common: Complete window may be missed)
  //   - 'Stopped'   → charging stopped for any reason
  // While 'Charging', keep the session alive (cell balancing still in progress).
  if (chargingState !== 'Charging') {
    const reason = chargingState === 'Complete'
      ? 'Vehicle reported charging complete (100%)'
      : `Charge ended at SoC 100% (state: ${chargingState ?? 'unknown'})`
    return { type: 'stop_charging', reason }
  }

  return {
    type: 'balancing_in_progress',
    message: `Vehicle balancing cells at SoC: ${soc}%`,
  }
}

export function shouldAdjustAmps(desiredAmps: number, actualAmps: number, threshold: number = 2): boolean {
  return Math.abs(desiredAmps - actualAmps) >= threshold
}

export function clampAmps(amps: number, minAmps: number, maxAmps: number): number {
  return Math.max(minAmps, Math.min(maxAmps, amps))
}
