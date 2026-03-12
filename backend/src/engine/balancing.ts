export interface BalancingState {
  balancing: boolean
  balancingStartedAt: Date | null
}

export interface BalancingInput {
  soc: number
  targetSoc: number
  actualAmps: number
  balancingState: BalancingState
  holdMinutes: number
  nowMs: number
}

export type BalancingAction =
  | { type: 'continue_charging' }
  | { type: 'start_balancing' }
  | { type: 'balancing_in_progress'; message: string }
  | { type: 'stop_charging'; reason: string }

export function computeBalancingAction(input: BalancingInput): BalancingAction {
  const { soc, targetSoc, actualAmps, balancingState, holdMinutes, nowMs } = input

  if (soc < targetSoc) {
    return { type: 'continue_charging' }
  }

  if (targetSoc < 100) {
    return { type: 'stop_charging', reason: `Target SoC ${targetSoc}% reached` }
  }

  if (!balancingState.balancing) {
    if (actualAmps > 0) {
      return { type: 'start_balancing' }
    }
    return { type: 'stop_charging', reason: 'SoC 100% and no current flowing' }
  }

  if (actualAmps === 0 && balancingState.balancingStartedAt) {
    const elapsedMs = nowMs - balancingState.balancingStartedAt.getTime()
    const elapsedMin = elapsedMs / 60000
    if (elapsedMin >= holdMinutes) {
      return { type: 'stop_charging', reason: 'Cell balancing complete' }
    }
  }

  return {
    type: 'balancing_in_progress',
    message: `Balancing: ${actualAmps}A flowing, SoC: ${soc}%`,
  }
}

export function shouldAdjustAmps(desiredAmps: number, actualAmps: number, threshold: number = 2): boolean {
  return Math.abs(desiredAmps - actualAmps) >= threshold
}

export function clampAmps(amps: number, minAmps: number, maxAmps: number): number {
  return Math.max(minAmps, Math.min(maxAmps, amps))
}
