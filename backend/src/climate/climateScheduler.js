const cron = require('node-cron');
const logger = require('../logger');
const configManager = require('../config/configManager');

const DAY_MAP = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// Convert day abbreviations to cron day-of-week list
function toCronDays(days) {
  return days.map((d) => DAY_MAP[d]).join(',');
}

// Parse "HH:MM" into { hour, minute }
function parseTime(timeStr) {
  const [hour, minute] = timeStr.split(':').map(Number);
  return { hour, minute };
}

class ClimateScheduler {
  constructor(teslaClient) {
    this._client = teslaClient;
    this._tasks = [];
    this._stopTimers = [];
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._loadSchedules();
    logger.info('Climate scheduler started');
  }

  stop() {
    this._running = false;
    this._clearAll();
    logger.info('Climate scheduler stopped');
  }

  reload() {
    this._clearAll();
    if (this._running) {
      this._loadSchedules();
      logger.info('Climate scheduler reloaded');
    }
  }

  _clearAll() {
    for (const task of this._tasks) {
      task.stop();
    }
    for (const timer of this._stopTimers) {
      clearTimeout(timer);
    }
    this._tasks = [];
    this._stopTimers = [];
  }

  _loadSchedules() {
    const cfg = configManager.getConfig();
    if (!cfg.climate.enabled) {
      logger.info('Climate scheduling is disabled');
      return;
    }

    const vin = cfg.vehicle.vin;
    if (!vin) {
      logger.warn('No VIN configured, skipping climate schedule setup');
      return;
    }

    for (const schedule of cfg.climate.schedules || []) {
      if (!schedule.enabled) continue;

      const { hour, minute } = parseTime(schedule.startTime);
      const cronDays = toCronDays(schedule.days);
      const cronExpr = `${minute} ${hour} * * ${cronDays}`;

      logger.info(`Registering climate schedule "${schedule.name}" at cron: ${cronExpr}`);

      const task = cron.schedule(cronExpr, async () => {
        logger.info(`Climate schedule "${schedule.name}" triggered`);
        const currentCfg = configManager.getConfig();
        if (!currentCfg.climate.enabled) return;

        const currentVin = currentCfg.vehicle.vin;
        if (!currentVin) return;

        try {
          if (schedule.targetTempC) {
            await this._client.setClimateTemp(currentVin, schedule.targetTempC);
          }
          await this._client.startClimate(currentVin);
          logger.info(`Climate started for schedule "${schedule.name}"`);

          const stopDelay = (schedule.durationMinutes || 20) * 60 * 1000;
          const timer = setTimeout(async () => {
            try {
              await this._client.stopClimate(currentVin);
              logger.info(`Climate stopped after ${schedule.durationMinutes}min for schedule "${schedule.name}"`);
            } catch (err) {
              logger.error(`Failed to stop climate for schedule "${schedule.name}": ${err.message}`);
            }
          }, stopDelay);
          this._stopTimers.push(timer);
        } catch (err) {
          logger.error(`Failed to start climate for schedule "${schedule.name}": ${err.message}`);
        }
      });

      this._tasks.push(task);
    }
  }
}

module.exports = ClimateScheduler;
