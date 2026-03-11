const EventEmitter = require('events');
const logger = require('../logger');
const configManager = require('../config/configManager');

// Pure function: determine if a schedule is active for the given time
function isScheduleActive(schedule, now) {
  if (!schedule.enabled) return false;

  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDay = dayNames[now.getDay()];
  if (!schedule.days.includes(currentDay)) return false;

  const [startHour, startMin] = schedule.startTime.split(':').map(Number);
  const [endHour, endMin] = schedule.endTime.split(':').map(Number);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Handle overnight schedules (e.g. 22:00 - 06:00)
  if (startMinutes > endMinutes) {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

// Pure function: decide if balancing is complete or should stop
function shouldStopForBalancing(chargeState, balancingConfig, balancingStartTime, now) {
  const { targetLimit, batteryLevel, chargeCurrentRequest } = chargeState;

  if (targetLimit !== 100) return false;

  if (batteryLevel >= 100 && chargeCurrentRequest <= (balancingConfig.minCurrentAmps || 1)) {
    return true;
  }

  if (balancingStartTime) {
    const elapsed = (now - balancingStartTime) / 1000 / 60;
    if (elapsed >= (balancingConfig.holdDurationMinutes || 30)) {
      return true;
    }
  }

  return false;
}

// Pure function: decide if normal charging should stop
function shouldStopNormalCharging(chargeState) {
  const { targetLimit, batteryLevel } = chargeState;
  if (targetLimit >= 100) return false;
  return batteryLevel >= targetLimit;
}

class ChargingEngine extends EventEmitter {
  constructor(teslaClient) {
    super();
    this._client = teslaClient;
    this._running = false;
    this._pollTimer = null;
    this._vehicleState = null;
    this._chargingStatus = {
      active: false,
      scheduleId: null,
      balancing: false,
      balancingStartTime: null,
      lastUpdated: null,
    };
  }

  start() {
    if (this._running) return;
    this._running = true;
    logger.info('Charging engine started');
    this._schedulePoll();
  }

  stop() {
    this._running = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    logger.info('Charging engine stopped');
  }

  getStatus() {
    return {
      vehicleState: this._vehicleState,
      chargingStatus: this._chargingStatus,
    };
  }

  _schedulePoll() {
    if (!this._running) return;
    const cfg = configManager.getConfig();
    const interval = (cfg.polling.intervalSeconds || 30) * 1000;
    this._pollTimer = setTimeout(() => this._poll(), interval);
  }

  async _poll() {
    if (!this._running) return;

    const cfg = configManager.getConfig();
    if (!cfg.charging.enabled) {
      this._schedulePoll();
      return;
    }

    const vin = cfg.vehicle.vin;
    if (!vin) {
      logger.warn('No VIN configured, skipping poll');
      this._schedulePoll();
      return;
    }

    try {
      const awake = await this._client.isAwake(vin);
      if (!awake) {
        logger.debug('Vehicle is asleep, skipping charging poll');
        this._schedulePoll();
        return;
      }

      const vehicleData = await this._client.getVehicleData(vin);
      this._vehicleState = { ...vehicleData, lastPolled: new Date().toISOString() };
      this.emit('vehicleState', this._vehicleState);

      await this._evaluateSchedules(cfg, vin, vehicleData);
    } catch (err) {
      logger.error(`Charging poll error: ${err.message}`);
    }

    this._schedulePoll();
  }

  async _evaluateSchedules(cfg, vin, vehicleData) {
    const now = new Date();
    const schedules = cfg.charging.schedules || [];
    const balancingCfg = cfg.charging.balancing || {};

    const chargeData = vehicleData.charge_state || {};
    const batteryLevel = chargeData.battery_level || 0;
    const chargeCurrentRequest = chargeData.charge_current_request || 0;
    const charging = chargeData.charging_state === 'Charging';

    const activeSchedule = schedules.find((s) => isScheduleActive(s, now));

    if (!activeSchedule) {
      if (this._chargingStatus.active) {
        logger.info('No active schedule, stopping charging');
        await this._client.stopCharging(vin).catch((e) => logger.error(`Stop charging failed: ${e.message}`));
        this._chargingStatus = { active: false, scheduleId: null, balancing: false, balancingStartTime: null, lastUpdated: new Date().toISOString() };
        this.emit('chargingStatus', this._chargingStatus);
      }
      return;
    }

    const targetLimit = activeSchedule.targetLimit;
    const chargeState = { targetLimit, batteryLevel, chargeCurrentRequest };

    // Handle 100% balancing
    if (targetLimit === 100 && charging) {
      if (batteryLevel >= 100 && !this._chargingStatus.balancing) {
        this._chargingStatus.balancing = true;
        this._chargingStatus.balancingStartTime = now;
        logger.info('Battery at 100%, monitoring balancing current');
      }

      if (
        this._chargingStatus.balancing &&
        shouldStopForBalancing(chargeState, balancingCfg, this._chargingStatus.balancingStartTime, now)
      ) {
        logger.info('Balancing complete or hold duration exceeded, stopping charging');
        await this._client.stopCharging(vin).catch((e) => logger.error(`Stop charging failed: ${e.message}`));
        this._chargingStatus = { active: false, scheduleId: null, balancing: false, balancingStartTime: null, lastUpdated: new Date().toISOString() };
        this.emit('chargingStatus', this._chargingStatus);
        return;
      }
    }

    // Normal charge limit reached
    if (shouldStopNormalCharging(chargeState) && charging) {
      logger.info(`Battery at ${batteryLevel}% >= target ${targetLimit}%, stopping charging`);
      await this._client.stopCharging(vin).catch((e) => logger.error(`Stop charging failed: ${e.message}`));
      this._chargingStatus = { active: false, scheduleId: null, balancing: false, balancingStartTime: null, lastUpdated: new Date().toISOString() };
      this.emit('chargingStatus', this._chargingStatus);
      return;
    }

    // Start charging if not already active
    if (!charging && batteryLevel < targetLimit) {
      logger.info(`Starting charging for schedule "${activeSchedule.name}" (target: ${targetLimit}%)`);
      await this._client.setChargeLimit(vin, targetLimit).catch((e) => logger.error(`Set limit failed: ${e.message}`));
      await this._client.startCharging(vin).catch((e) => logger.error(`Start charging failed: ${e.message}`));
      this._chargingStatus = {
        active: true,
        scheduleId: activeSchedule.id,
        balancing: false,
        balancingStartTime: null,
        lastUpdated: new Date().toISOString(),
      };
      this.emit('chargingStatus', this._chargingStatus);
    }
  }
}

module.exports = { ChargingEngine, isScheduleActive, shouldStopForBalancing, shouldStopNormalCharging };
