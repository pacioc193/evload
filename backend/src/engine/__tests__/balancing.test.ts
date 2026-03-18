import { computeBalancingAction, shouldAdjustAmps, clampAmps } from '../balancing'

describe('computeBalancingAction', () => {
  const baseInput = {
    nowMs: Date.now(),
    actualAmps: 16,
  }

  test('returns continue_charging when soc < targetSoc', () => {
    const result = computeBalancingAction({
      ...baseInput,
      soc: 75,
      targetSoc: 80,
      balancingState: { balancing: false, balancingStartedAt: null },
    })
    expect(result.type).toBe('continue_charging')
  })

  test('returns stop_charging when soc reaches non-100 target', () => {
    const result = computeBalancingAction({
      ...baseInput,
      soc: 80,
      targetSoc: 80,
      balancingState: { balancing: false, balancingStartedAt: null },
    })
    expect(result.type).toBe('stop_charging')
    expect((result as { type: string; reason: string }).reason).toContain('80%')
  })

  test('returns balancing_in_progress when targetSoc is 100% (vehicle manages charging)', () => {
    const result = computeBalancingAction({
      ...baseInput,
      soc: 100,
      targetSoc: 100,
      balancingState: { balancing: false, balancingStartedAt: null },
    })
    expect(result.type).toBe('balancing_in_progress')
  })

  test('never stops charging when targetSoc is 100%', () => {
    const result = computeBalancingAction({
      ...baseInput,
      soc: 100,
      targetSoc: 100,
      balancingState: { balancing: true, balancingStartedAt: new Date(baseInput.nowMs - 60000) },
    })
    expect(result.type).toBe('balancing_in_progress')
    expect(result.type).not.toBe('stop_charging')
  })
})

describe('shouldAdjustAmps', () => {
  test('returns true when difference >= threshold', () => {
    expect(shouldAdjustAmps(16, 13, 2)).toBe(true)
    expect(shouldAdjustAmps(13, 16, 2)).toBe(true)
    expect(shouldAdjustAmps(16, 14, 2)).toBe(true)
  })

  test('returns false when difference < threshold', () => {
    expect(shouldAdjustAmps(16, 15, 2)).toBe(false)
    expect(shouldAdjustAmps(16, 16, 2)).toBe(false)
  })

  test('uses default threshold of 2', () => {
    expect(shouldAdjustAmps(16, 14)).toBe(true)
    expect(shouldAdjustAmps(16, 15)).toBe(false)
  })
})

describe('clampAmps', () => {
  test('clamps to minimum', () => {
    expect(clampAmps(3, 5, 32)).toBe(5)
  })

  test('clamps to maximum', () => {
    expect(clampAmps(40, 5, 32)).toBe(32)
  })

  test('returns value within range', () => {
    expect(clampAmps(16, 5, 32)).toBe(16)
  })

  test('handles boundary values', () => {
    expect(clampAmps(5, 5, 32)).toBe(5)
    expect(clampAmps(32, 5, 32)).toBe(32)
  })
})
