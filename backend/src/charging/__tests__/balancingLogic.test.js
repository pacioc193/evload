const {
  isScheduleActive,
  shouldStopForBalancing,
  shouldStopNormalCharging,
} = require('../chargingEngine');

describe('isScheduleActive', () => {
  const makeSchedule = (overrides) => ({
    enabled: true,
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '22:00',
    endTime: '06:00',
    targetLimit: 80,
    ...overrides,
  });

  it('returns false for disabled schedule', () => {
    const schedule = makeSchedule({ enabled: false });
    const now = new Date('2024-01-15T23:00:00'); // Monday 23:00
    expect(isScheduleActive(schedule, now)).toBe(false);
  });

  it('returns false when day not in schedule', () => {
    const schedule = makeSchedule({ days: ['mon', 'tue'] });
    const now = new Date('2024-01-20T23:00:00'); // Saturday
    expect(isScheduleActive(schedule, now)).toBe(false);
  });

  it('returns true during overnight schedule (after start)', () => {
    const schedule = makeSchedule();
    const now = new Date('2024-01-15T23:00:00'); // Monday 23:00
    expect(isScheduleActive(schedule, now)).toBe(true);
  });

  it('returns true during overnight schedule (before end)', () => {
    const schedule = makeSchedule();
    const now = new Date('2024-01-16T05:00:00'); // Tuesday 05:00
    expect(isScheduleActive(schedule, now)).toBe(true);
  });

  it('returns false outside overnight schedule', () => {
    const schedule = makeSchedule();
    const now = new Date('2024-01-15T10:00:00'); // Monday 10:00
    expect(isScheduleActive(schedule, now)).toBe(false);
  });

  it('handles same-day schedule (not overnight)', () => {
    const schedule = makeSchedule({ startTime: '09:00', endTime: '17:00' });
    const now = new Date('2024-01-15T12:00:00'); // Monday 12:00
    expect(isScheduleActive(schedule, now)).toBe(true);
  });
});

describe('shouldStopForBalancing', () => {
  const balancingConfig = { holdDurationMinutes: 30, minCurrentAmps: 1 };
  const now = new Date('2024-01-15T23:00:00');

  it('should not stop when target is not 100%', () => {
    const state = { targetLimit: 80, batteryLevel: 80, chargeCurrentRequest: 0 };
    expect(shouldStopForBalancing(state, balancingConfig, null, now)).toBe(false);
  });

  it('should not stop charging when target is 100% and current > 1A (balancing in progress)', () => {
    const state = { targetLimit: 100, batteryLevel: 100, chargeCurrentRequest: 5 };
    const balancingStart = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    expect(shouldStopForBalancing(state, balancingConfig, balancingStart, now)).toBe(false);
  });

  it('should stop charging when target is 100% and current drops to 0 (balancing complete)', () => {
    const state = { targetLimit: 100, batteryLevel: 100, chargeCurrentRequest: 0 };
    const balancingStart = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    expect(shouldStopForBalancing(state, balancingConfig, balancingStart, now)).toBe(true);
  });

  it('should stop charging when hold duration exceeded', () => {
    const state = { targetLimit: 100, batteryLevel: 100, chargeCurrentRequest: 3 };
    const balancingStart = new Date(now.getTime() - 35 * 60 * 1000); // 35 min ago
    expect(shouldStopForBalancing(state, balancingConfig, balancingStart, now)).toBe(true);
  });

  it('should not stop if battery not at 100 yet and hold not exceeded', () => {
    const state = { targetLimit: 100, batteryLevel: 98, chargeCurrentRequest: 10 };
    const balancingStart = new Date(now.getTime() - 5 * 60 * 1000);
    expect(shouldStopForBalancing(state, balancingConfig, balancingStart, now)).toBe(false);
  });
});

describe('shouldStopNormalCharging', () => {
  it('should stop charging normally when target < 100% and level reached', () => {
    const state = { targetLimit: 80, batteryLevel: 80, chargeCurrentRequest: 0 };
    expect(shouldStopNormalCharging(state)).toBe(true);
  });

  it('should not stop when battery below target', () => {
    const state = { targetLimit: 80, batteryLevel: 70, chargeCurrentRequest: 15 };
    expect(shouldStopNormalCharging(state)).toBe(false);
  });

  it('should not stop when target is 100% (balancing path)', () => {
    const state = { targetLimit: 100, batteryLevel: 100, chargeCurrentRequest: 0 };
    expect(shouldStopNormalCharging(state)).toBe(false);
  });

  it('should handle normal charging stop at target limit', () => {
    const state = { targetLimit: 90, batteryLevel: 91, chargeCurrentRequest: 0 };
    expect(shouldStopNormalCharging(state)).toBe(true);
  });
});
