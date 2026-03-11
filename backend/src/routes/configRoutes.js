const express = require('express');
const yaml = require('js-yaml');
const configManager = require('../config/configManager');
const logger = require('../logger');

const router = express.Router();

router.get('/config', (req, res) => {
  try {
    res.json(configManager.getConfig());
  } catch (err) {
    logger.error(`GET /config error: ${err.message}`);
    res.status(500).json({ error: 'Failed to read config' });
  }
});

router.put('/config', (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Body must be a JSON object' });
    }
    const updated = configManager.updateConfig(updates);
    logger.info('Config updated via API');
    res.json(updated);
  } catch (err) {
    logger.error(`PUT /config error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

router.get('/config/yaml', (req, res) => {
  try {
    const raw = configManager.getRawYaml();
    res.type('text/yaml').send(raw);
  } catch (err) {
    logger.error(`GET /config/yaml error: ${err.message}`);
    res.status(500).json({ error: 'Failed to read YAML config' });
  }
});

router.put('/config/yaml', (req, res) => {
  try {
    const body = req.body;
    const yamlStr = typeof body === 'string' ? body : body?.yaml;
    if (!yamlStr || typeof yamlStr !== 'string') {
      return res.status(400).json({ error: 'Body must contain a YAML string' });
    }
    // Validate it parses
    yaml.load(yamlStr);
    const updated = configManager.setRawYaml(yamlStr);
    logger.info('Config updated via YAML API');
    res.json(updated);
  } catch (err) {
    logger.error(`PUT /config/yaml error: ${err.message}`);
    res.status(400).json({ error: `Invalid YAML: ${err.message}` });
  }
});

module.exports = router;
