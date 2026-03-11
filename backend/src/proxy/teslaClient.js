const axios = require('axios');
const logger = require('../logger');
const configManager = require('../config/configManager');

function getBaseUrl() {
  const cfg = configManager.getConfig();
  const { host, port } = cfg.vehicle.proxy;
  return `http://${host}:${port}`;
}

function getTimeout() {
  const cfg = configManager.getConfig();
  return (cfg.polling.timeoutSeconds || 10) * 1000;
}

function getMaxRetries() {
  const cfg = configManager.getConfig();
  return cfg.polling.maxRetries || 3;
}

function getBackoffBase() {
  const cfg = configManager.getConfig();
  return (cfg.polling.backoffBaseSeconds || 5) * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(method, url, data, attempt = 0) {
  const maxRetries = getMaxRetries();
  const backoffBase = getBackoffBase();
  const timeout = getTimeout();

  try {
    const response = await axios({
      method,
      url,
      data,
      timeout,
      validateStatus: (status) => status < 500,
    });
    return response;
  } catch (err) {
    if (attempt < maxRetries) {
      const delay = backoffBase * Math.pow(2, attempt);
      logger.warn(`Request to ${url} failed (attempt ${attempt + 1}): ${err.message}. Retrying in ${delay}ms`);
      await sleep(delay);
      return requestWithRetry(method, url, data, attempt + 1);
    }
    logger.error(`Request to ${url} failed after ${maxRetries + 1} attempts: ${err.message}`);
    throw err;
  }
}

const teslaClient = {
  async getVehicleData(vin) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/vehicle_data`;
    const response = await requestWithRetry('get', url);
    return response.data?.response || response.data;
  },

  async getChargeState(vin) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/charge_state`;
    const response = await requestWithRetry('get', url);
    return response.data?.response || response.data;
  },

  async setChargeLimit(vin, percent) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/command/set_charge_limit`;
    const response = await requestWithRetry('post', url, { percent });
    logger.info(`Set charge limit to ${percent}% for VIN ${vin}`);
    return response.data?.response || response.data;
  },

  async startCharging(vin) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/command/charge_start`;
    const response = await requestWithRetry('post', url);
    logger.info(`Start charging command sent for VIN ${vin}`);
    return response.data?.response || response.data;
  },

  async stopCharging(vin) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/command/charge_stop`;
    const response = await requestWithRetry('post', url);
    logger.info(`Stop charging command sent for VIN ${vin}`);
    return response.data?.response || response.data;
  },

  async startClimate(vin) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/command/auto_conditioning_start`;
    const response = await requestWithRetry('post', url);
    logger.info(`Start climate command sent for VIN ${vin}`);
    return response.data?.response || response.data;
  },

  async stopClimate(vin) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/command/auto_conditioning_stop`;
    const response = await requestWithRetry('post', url);
    logger.info(`Stop climate command sent for VIN ${vin}`);
    return response.data?.response || response.data;
  },

  async setClimateTemp(vin, tempC) {
    const url = `${getBaseUrl()}/api/1/vehicles/${vin}/command/set_temps`;
    const response = await requestWithRetry('post', url, {
      driver_temp: tempC,
      passenger_temp: tempC,
    });
    logger.info(`Set climate temp to ${tempC}°C for VIN ${vin}`);
    return response.data?.response || response.data;
  },

  async isAwake(vin) {
    try {
      const url = `${getBaseUrl()}/api/1/vehicles/${vin}/vehicle_data`;
      const response = await axios.get(url, { timeout: getTimeout() });
      const state = response.data?.response?.state || response.data?.state;
      return state === 'online';
    } catch (err) {
      logger.debug(`isAwake check failed for VIN ${vin}: ${err.message}`);
      return false;
    }
  },
};

module.exports = teslaClient;
