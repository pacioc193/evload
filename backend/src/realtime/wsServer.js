const WebSocket = require('ws');
const logger = require('../logger');

class WsServer {
  constructor() {
    this._wss = null;
    this._clients = new Set();
  }

  attach(httpServer) {
    this._wss = new WebSocket.Server({ server: httpServer });

    this._wss.on('connection', (ws, req) => {
      this._clients.add(ws);
      logger.info(`WebSocket client connected (${this._clients.size} total)`);

      ws.on('close', () => {
        this._clients.delete(ws);
        logger.info(`WebSocket client disconnected (${this._clients.size} remaining)`);
      });

      ws.on('error', (err) => {
        logger.error(`WebSocket client error: ${err.message}`);
        this._clients.delete(ws);
      });
    });

    logger.info('WebSocket server attached to HTTP server');
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of this._clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload, (err) => {
          if (err) {
            logger.error(`WebSocket send error: ${err.message}`);
          }
        });
      }
    }
  }

  broadcastVehicleState(data) {
    this.broadcast({ type: 'vehicleState', data });
  }

  broadcastChargingStatus(data) {
    this.broadcast({ type: 'chargingStatus', data });
  }
}

const wsServer = new WsServer();
module.exports = wsServer;
