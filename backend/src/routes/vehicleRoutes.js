const express = require('express');
const logger = require('../logger');
const configManager = require('../config/configManager');
const teslaClient = require('../proxy/teslaClient');

const router = express.Router();

// Lazy-loaded charging engine reference (set from server.js to avoid circular deps)
let _chargingEngine = null;
function setChargingEngine(engine) {
  _chargingEngine = engine;
}

router.get('/vehicle/state', (req, res) => {
  try {
    const status = _chargingEngine ? _chargingEngine.getStatus() : { vehicleState: null, chargingStatus: null };
    res.json(status);
  } catch (err) {
    logger.error(`GET /vehicle/state error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get vehicle state' });
  }
});

router.post('/vehicle/charging/start', async (req, res) => {
  try {
    const cfg = configManager.getConfig();
    const vin = cfg.vehicle.vin;
    if (!vin) return res.status(400).json({ error: 'VIN not configured' });
    const result = await teslaClient.startCharging(vin);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`POST /vehicle/charging/start error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/vehicle/charging/stop', async (req, res) => {
  try {
    const cfg = configManager.getConfig();
    const vin = cfg.vehicle.vin;
    if (!vin) return res.status(400).json({ error: 'VIN not configured' });
    const result = await teslaClient.stopCharging(vin);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`POST /vehicle/charging/stop error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/vehicle/climate/start', async (req, res) => {
  try {
    const cfg = configManager.getConfig();
    const vin = cfg.vehicle.vin;
    if (!vin) return res.status(400).json({ error: 'VIN not configured' });
    const { tempC } = req.body || {};
    if (tempC !== undefined) {
      await teslaClient.setClimateTemp(vin, tempC);
    }
    const result = await teslaClient.startClimate(vin);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`POST /vehicle/climate/start error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/vehicle/climate/stop', async (req, res) => {
  try {
    const cfg = configManager.getConfig();
    const vin = cfg.vehicle.vin;
    if (!vin) return res.status(400).json({ error: 'VIN not configured' });
    const result = await teslaClient.stopClimate(vin);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`POST /vehicle/climate/stop error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setChargingEngine };
