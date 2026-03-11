const http = require('http');
const app = require('./app');
const logger = require('./logger');
const configManager = require('./config/configManager');
const wsServer = require('./realtime/wsServer');
const { ChargingEngine } = require('./charging/chargingEngine');
const ClimateScheduler = require('./climate/climateScheduler');
const teslaClient = require('./proxy/teslaClient');
const { setChargingEngine } = require('./routes/vehicleRoutes');

// Initialize config before anything else
configManager.init();

const cfg = configManager.getConfig();
const PORT = cfg.app.port || 3001;

const server = http.createServer(app);

// Attach WebSocket server
wsServer.attach(server);

// Initialize charging engine and wire up events
const chargingEngine = new ChargingEngine(teslaClient);
setChargingEngine(chargingEngine);

chargingEngine.on('vehicleState', (state) => {
  wsServer.broadcastVehicleState(state);
});

chargingEngine.on('chargingStatus', (status) => {
  wsServer.broadcastChargingStatus(status);
});

// Initialize climate scheduler
const climateScheduler = new ClimateScheduler(teslaClient);

// Start services
chargingEngine.start();
climateScheduler.start();

server.listen(PORT, () => {
  logger.info(`${cfg.app.name} server listening on port ${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  chargingEngine.stop();
  climateScheduler.stop();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('Forcing process exit after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`, err);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});
