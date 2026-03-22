import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { IncomingMessage } from 'http'
import { logger } from '../logger'
import { getConfig } from '../config'
import { getHaState } from '../services/ha.service'
import { getVehicleState, getSimulatorDebugState, getProxyHealthState } from '../services/proxy.service'
import { getEngineStatus } from '../engine/charging.engine'
import { isFailsafeActive, getFailsafeReason } from '../services/failsafe.service'
import { verifyToken } from '../auth'

const PING_INTERVAL_MS = 30000
const BROADCAST_INTERVAL_MS = 1000

let wss: WebSocketServer | null = null
let broadcastTimer: NodeJS.Timeout | null = null
let pingTimer: NodeJS.Timeout | null = null

interface ExtendedWs extends WebSocket {
  isAlive: boolean
}

export function initWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const extWs = ws as ExtendedWs

    const rawUrl = req.url ?? ''
    const queryStart = rawUrl.indexOf('?')
    const queryString = queryStart !== -1 ? rawUrl.slice(queryStart + 1) : ''
    const params = new URLSearchParams(queryString)
    const token = params.get('token')

    const isTokenValid = token ? await verifyToken(token) : false
    if (!isTokenValid) {
      logger.warn('WebSocket connection rejected: invalid or missing token')
      extWs.close(1008, 'Unauthorized')
      return
    }

    extWs.isAlive = true

    logger.info('WebSocket client connected')
    sendStateToClient(extWs)

    extWs.on('pong', () => {
      extWs.isAlive = true
    })

    extWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'ping') {
          extWs.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {
        // ignore malformed messages
      }
    })

    extWs.on('close', () => {
      logger.info('WebSocket client disconnected')
    })

    extWs.on('error', (err) => {
      logger.error('WebSocket client error', { err })
    })
  })

  pingTimer = setInterval(() => {
    if (!wss) return
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWs
      if (!extWs.isAlive) {
        logger.info('Dropping dead WebSocket connection')
        extWs.terminate()
        return
      }
      extWs.isAlive = false
      extWs.ping()
    })
  }, PING_INTERVAL_MS)

  broadcastTimer = setInterval(() => {
    broadcastState()
  }, BROADCAST_INTERVAL_MS)

  logger.info('WebSocket server initialized')
}

function getAppState() {
  const cfg = getConfig()
  return {
    type: 'state',
    timestamp: new Date().toISOString(),
    demo: cfg.demo,
    charging: {
      energyPriceEurPerKwh: cfg.charging.energyPriceEurPerKwh,
      batteryCapacityKwh: cfg.charging.batteryCapacityKwh,
    },
    ha: getHaState(),
    proxy: getProxyHealthState(),
    vehicle: getVehicleState(),
    simulator: getSimulatorDebugState(),
    engine: getEngineStatus(),
    failsafe: {
      active: isFailsafeActive(),
      reason: getFailsafeReason(),
    },
  }
}

function sendStateToClient(ws: ExtendedWs): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(getAppState()))
    } catch (err) {
      logger.error('Failed to send WS state to client', { err })
    }
  }
}

function broadcastState(): void {
  if (!wss) return
  const payload = JSON.stringify(getAppState())
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload)
      } catch (err) {
        logger.error('Failed to broadcast WS state', { err })
      }
    }
  })
}

export function stopWebSocketServer(): void {
  if (broadcastTimer) clearInterval(broadcastTimer)
  if (pingTimer) clearInterval(pingTimer)
  if (wss) {
    wss.close(() => logger.info('WebSocket server closed'))
    wss = null
  }
}
