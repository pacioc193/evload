import 'dotenv/config'
import http from 'http'
import express from 'express'
import cors from 'cors'
import path from 'path'
import rateLimit from 'express-rate-limit'
import { logger, sanitizeForLog } from './logger'
import { loadConfig, getConfig } from './config'
import authRoutes from './routes/auth.routes'
import haRoutes from './routes/ha.routes'
import vehicleRoutes from './routes/vehicle.routes'
import engineRoutes from './routes/engine.routes'
import sessionRoutes from './routes/sessions.routes'
import configRoutes from './routes/config.routes'
import scheduleRoutes from './routes/schedule.routes'
import settingsRoutes from './routes/settings.routes'
import { startHaPoll } from './services/ha.service'
import { startProxyPoll } from './services/proxy.service'
import { startFleetSimulator, stopFleetSimulator } from './services/fleet-simulator.service'
import { initTelegram, registerTelegramCommand } from './services/telegram.service'
import { initFailsafe } from './services/failsafe.service'
import { startScheduler } from './services/scheduler.service'
import { initWebSocketServer, stopWebSocketServer } from './ws/broadcaster'
import { startEngine, stopEngine, getEngineStatus } from './engine/charging.engine'
import { isFailsafeActive } from './services/failsafe.service'
import { notificationEvents, dispatchTelegramNotificationEvent } from './services/notification-rules.service'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = express()

app.use(cors())
app.use(express.json())

if ((process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug') {
  app.use((req, res, next) => {
    const startedAt = Date.now()
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    let responseBody: unknown = undefined

    const originalJson = res.json.bind(res)
    const originalSend = res.send.bind(res)

    ;(res as unknown as { json: (body: unknown) => unknown }).json = (body: unknown) => {
      responseBody = body
      return originalJson(body)
    }

    ;(res as unknown as { send: (body: unknown) => unknown }).send = (body: unknown) => {
      if (responseBody === undefined) responseBody = body
      return originalSend(body)
    }

    res.on('finish', () => {
      logger.debug('HTTP request completed', {
        requestId,
        method: req.method,
        path: req.path,
        query: sanitizeForLog(req.query),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        reqHeaders: sanitizeForLog(req.headers),
        reqBody: sanitizeForLog(req.body),
        resBody: sanitizeForLog(responseBody),
      })
    })

    next()
  })
}

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })
app.use('/api/', apiLimiter)

loadConfig()

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/ha', haRoutes)
app.use('/api/vehicle', vehicleRoutes)
app.use('/api/engine', engineRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/config', configRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/settings', settingsRoutes)

const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist')

if (process.env.NODE_ENV === 'production') {
  const staticLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 })
  app.use(express.static(FRONTEND_DIST))
  app.get('*', staticLimiter, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })
}

const server = http.createServer(app)

initWebSocketServer(server)

initFailsafe()
initTelegram()

notificationEvents.on('emit', async (event: string, payload: Record<string, unknown>) => {
  try {
    await dispatchTelegramNotificationEvent(event, payload)
  } catch (err) {
    logger.error('Failed to dispatch external event for notifications', { err, event })
  }
})

registerTelegramCommand('start', async (_chatId, args) => {
  const cfg = getConfig()
  const soc = args[0] ? parseInt(args[0], 10) : cfg.charging.defaultTargetSoc
  const amps = args[1] ? parseInt(args[1], 10) : undefined
  if (isNaN(soc) || soc < 1 || soc > 100) {
    return 'Usage: /start [targetSoc 1-100] [targetAmps]\nExample: /start 80 16'
  }
  if (isFailsafeActive()) return '🚨 Failsafe active — cannot start charging'
  if (getEngineStatus().running) return 'ℹ️ Charging already running'
  await startEngine(soc, amps)
  return `✅ Charging started → ${soc}%${amps ? ` at ${amps}A` : ''}`
})

registerTelegramCommand('stop', async () => {
  if (!getEngineStatus().running) return 'ℹ️ Charging is not running'
  await stopEngine()
  return '🛑 Charging stopped'
})

startHaPoll()
startFleetSimulator()
startProxyPoll()
startScheduler()

stopEngine().catch((err) => {
  logger.error('Startup OFF enforcement failed', { err })
})

server.listen(PORT, () => {
  logger.info(`evload backend listening on port ${PORT}`)
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down')
  stopFleetSimulator()
  stopWebSocketServer()
  server.close(() => process.exit(0))
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise rejection', { reason })
})

export { app, server }
