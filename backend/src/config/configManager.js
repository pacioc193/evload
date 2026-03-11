const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../logger');
const defaultConfig = require('./defaultConfig');

const CONFIG_PATH = '/data/config.yml';

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

class ConfigManager {
  constructor() {
    this._config = null;
    this._writeQueue = Promise.resolve();
  }

  _ensureDataDir() {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  init() {
    this._ensureDataDir();
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = yaml.load(raw);
        this._config = deepMerge(defaultConfig, parsed || {});
        logger.info('Config loaded from disk');
      } else {
        this._config = { ...defaultConfig };
        this._writeToDisk(this._config);
        logger.info('No config file found; initialized with defaults');
      }
    } catch (err) {
      logger.error(`Failed to load config, using defaults: ${err.message}`);
      this._config = { ...defaultConfig };
    }
  }

  getConfig() {
    return this._config;
  }

  updateConfig(updates) {
    this._config = deepMerge(this._config, updates);
    this._enqueueWrite(this._config);
    return this._config;
  }

  getRawYaml() {
    return yaml.dump(this._config, { lineWidth: -1 });
  }

  setRawYaml(yamlStr) {
    const parsed = yaml.load(yamlStr);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid YAML: must be a key-value object');
    }
    this._config = deepMerge(defaultConfig, parsed);
    this._enqueueWrite(this._config);
    return this._config;
  }

  _enqueueWrite(config) {
    this._writeQueue = this._writeQueue
      .then(() => this._writeToDisk(config))
      .catch((err) => logger.error(`Config write failed: ${err.message}`));
  }

  _writeToDisk(config) {
    return new Promise((resolve, reject) => {
      try {
        this._ensureDataDir();
        const yamlStr = yaml.dump(config, { lineWidth: -1 });
        fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
        logger.debug('Config written to disk');
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }
}

const configManager = new ConfigManager();
module.exports = configManager;
