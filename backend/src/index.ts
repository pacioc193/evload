import 'dotenv/config'
import http from 'http'
import express from 'express'
import cors from 'cors'
import path from 'path'
import rateLimit from 'express-rate-limit'
import { logger } from './logger'
import { loadConfig } from './config'
import authRoutes from './routes/auth.routes'
import haRoutes from './routes/ha.routes'
import vehicleRoutes from './routes/vehicle.routes'
import engineRoutes from './routes/engine.routes'
import sessionRoutes from './routes/sessions.routes'
import configRoutes from './routes/config.routes'
import { startHaPoll } from './services/ha.service'
import { startProxyPoll } from './services/proxy.service'
import { initTelegram } from './services/telegram.service'
import { initFailsafe } from './services/failsafe.service'
import { initWebSocketServer, stopWebSocketServer } from './ws/broadcaster'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = express()

app.use(cors())
app.use(express.json())

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

const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist')

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(FRONTEND_DIST))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })
}

const server = http.createServer(app)

initWebSocketServer(server)

initFailsafe()
initTelegram()
startHaPoll()
startProxyPoll()

server.listen(PORT, () => {
  logger.info(`evload backend listening on port ${PORT}`)
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down')
  stopWebSocketServer()
  server.close(() => process.exit(0))
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise rejection', { reason })
})

export { app, server }
