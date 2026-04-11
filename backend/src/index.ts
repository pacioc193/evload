import 'dotenv/config'
import http from 'http'
import os from 'os'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { logger, sanitizeForLog, setLoggerLevel } from './logger'
import { loadConfig, getConfig, ensureConfigYaml } from './config'
import { prisma } from './prisma'
import authRoutes from './routes/auth.routes'
import haRoutes from './routes/ha.routes'
import vehicleRoutes from './routes/vehicle.routes'
import engineRoutes from './routes/engine.routes'
import sessionRoutes from './routes/sessions.routes'
import configRoutes from './routes/config.routes'
import scheduleRoutes from './routes/schedule.routes'
import settingsRoutes from './routes/settings.routes'
import versionRoutes from './routes/version.routes'
import garageRoutes from './routes/garage.routes'
import backupRoutes from './routes/backup.routes'
import updateRoutes from './routes/update.routes'
import { startHaPoll } from './services/ha.service'
import { startProxyPoll, getVehicleState, getProxyHealthState } from './services/proxy.service'
import { startFleetSimulator, stopFleetSimulator } from './services/fleet-simulator.service'
import { initTelegram, loadBotTokenFromDB, registerTelegramCommand } from './services/telegram.service'
import { initFailsafe } from './services/failsafe.service'
import { startScheduler } from './services/scheduler.service'
import { startAutoFetch } from './services/updater.service'
import { initWebSocketServer, stopWebSocketServer } from './ws/broadcaster'
import { startEngine, stopEngine, getEngineStatus, initializeEngineState, initExternalChargeGuard } from './engine/charging.engine'
import { isFailsafeActive } from './services/failsafe.service'
import { notificationEvents, dispatchTelegramNotificationEvent } from './services/notification-rules.service'
import { runScheduledBackupCheck } from './services/backup.service'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

// Detect machine's LAN IP address for HA OAuth callback routing
function detectLanIp(): string | null {
  const interfaces = os.networkInterfaces()
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue
    for (const addr of addrs) {
      // Prefer IPv4, skip loopback and internal
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('127')) {
        return addr.address
      }
    }
  }
  return null
}

// Auto-configure APP_URL: prioritize LAN IP, use mDNS as fallback
const configuredAppUrl = (process.env.APP_URL ?? '').trim()
const isLocalhostUrl = configuredAppUrl.includes('localhost') || configuredAppUrl.includes('127.0.0.1')

const appUrlToUse = (() => {
  // If explicitly set to a non-localhost address, use it as-is
  if (configuredAppUrl && !isLocalhostUrl) {
    return configuredAppUrl
  }

  // Try to detect LAN IP
  const lanIp = detectLanIp()
  if (lanIp) {
    const url = `http://${lanIp}:${PORT}`
    logger.info(`Auto-detected LAN IP: ${lanIp}, APP_URL will be ${url}`)
    return url
  }

  // Fall back to mDNS hostname if available
  const hostname = os.hostname()
  if (hostname && hostname !== 'localhost') {
    const mdnsUrl = `http://${hostname}.local:${PORT}`
    logger.info(`Using mDNS hostname: ${hostname}.local, APP_URL will be ${mdnsUrl}`)
    return mdnsUrl
  }

  logger.warn('Could not auto-detect LAN IP or mDNS hostname; using localhost (HA OAuth may not reach this backend)')
  return `http://localhost:${PORT}`
})()

// Update environment so ha.routes.ts picks up the potentially auto-detected URL
if (!configuredAppUrl || isLocalhostUrl) {
  process.env.APP_URL = appUrlToUse
}

logger.info(`HA OAuth will use APP_URL: ${process.env.APP_URL}`)

// ============================================================
// FIRST-RUN INITIALIZATION FUNCTIONS
// ============================================================

/**
 * Ensure .env exists - copy from .env.example if not present
 * Called during boot to initialize environment variables
 */
function ensureEnvFile(): void {
  const envPath = '.env'
  const envExamplePath = '.env.example'

  if (fs.existsSync(envPath)) {
    return
  }

  if (!fs.existsSync(envExamplePath)) {
    logger.warn(`.env.example not found at ${envExamplePath}, skipping .env initialization`)
    return
  }

  try {
    fs.copyFileSync(envExamplePath, envPath)
    logger.info(`✅ Created .env from .env.example (restart needed to load new variables)`)
  } catch (err) {
    logger.error('Failed to copy .env from example', { err })
  }
}

/**
 * Initialize secrets in database if not already present
 * Called during boot after Prisma is ready
 */
async function initializeSecrets(): Promise<void> {
  try {
    const config = await prisma.appConfig.findUnique({ where: { id: 1 } })

    // Initialize JWT secret if missing
    if (!config?.jwt_secret) {
      const jwtSecret = crypto.randomBytes(32).toString('hex')
      await prisma.appConfig.upsert({
        where: { id: 1 },
        update: { jwt_secret: jwtSecret },
        create: {
          id: 1,
          jwt_secret: jwtSecret,
        },
      })
      logger.info(`✅ JWT Secret generated and saved to database`)
    }

    logger.debug('Secrets initialization complete')
  } catch (err) {
    logger.error('Failed to initialize secrets in database', { err })
  }

  // Load Telegram token from DB (migrates from env if needed)
  await loadBotTokenFromDB()
}

const app = express()

const corsOrigin = process.env.CORS_ORIGIN?.trim()
app.use(
  cors(
    corsOrigin
      ? { origin: corsOrigin, credentials: true }
      : undefined
  )
)

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  })
)

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

// ============================================================
// FIRST-RUN INITIALIZATION
// ============================================================
ensureEnvFile()
ensureConfigYaml()

loadConfig()
setLoggerLevel(getConfig().logLevel)

app.get('/api/health', (_req, res) => {
  const vState = getVehicleState()
  const proxyHealth = getProxyHealthState()
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    proxy: {
      connected: proxyHealth.connected,
      vehicleSleepStatus: vState.vehicleSleepStatus,
    },
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/ha', haRoutes)
app.use('/api/vehicle', vehicleRoutes)
app.use('/api/engine', engineRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/config', configRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/version', versionRoutes)
app.use('/api/garage', garageRoutes)
app.use('/api/backup', backupRoutes)
app.use('/api/update', updateRoutes)

const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist')

// HA IndieAuth / OAuth client identity page.
// HA fetches the client_id URL to validate the OAuth app and look for <link rel="redirect_uri">.
// APP_URL must be reachable by the HA server — use the evload machine LAN IP, e.g. http://192.168.1.X:3001.
app.get('/', (req, res, next) => {
  const userAgent = req.get('user-agent') || ''
  
  // Only intercept the root route for HA validation.
  // Home Assistant user agent typically includes "HomeAssistant" or "aiohttp"
  // If it's a standard browser request, pass it to express.static (the frontend)
  if (!userAgent.toLowerCase().includes('homeassistant') && !userAgent.toLowerCase().includes('aiohttp') && !req.accepts('html')) {
     return next()
  }

  // Also check if it's explicitly asking for text/html from a generic client but allow browsers through
  if(req.accepts('html') && userAgent.toLowerCase().includes('mozilla') && !userAgent.toLowerCase().includes('homeassistant')) {
     return next()
  }

  const appUrl = (process.env.APP_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
  const redirectUri = `${appUrl}/api/ha/callback`
  
  logger.debug('GET / requested (likely HA OAuth validation)', {
    userAgent: req.get('user-agent'),
    appUrl,
    redirectUri,
  })
  
  // Set HTTP Link header for IndieAuth (some clients check this first)
  res.setHeader('Link', `<${redirectUri}>; rel="redirect_uri"`)
  
  // Also set the traditional Content-Type header
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  
  // Return HTML with both <link> tag variants for maximum compatibility
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>evload OAuth Client</title>
<link rel="redirect_uri" href="${redirectUri}">
</head>
<body>
<h1>evload</h1>
<p>OAuth Provider: Home Assistant</p>
<p>Redirect URI: ${redirectUri}</p>
</body>
</html>`

  res.send(html)
})

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
  await stopEngine({ forceOff: true })
  return '🛑 Charging stopped'
})

async function bootstrap(): Promise<void> {
  // Initialize secrets in database (JWT, HA credentials, etc)
  await initializeSecrets()

  // Restore engine state from previous session
  await initializeEngineState()
  initExternalChargeGuard()

  startHaPoll()
  startFleetSimulator()
  startProxyPoll()
  startScheduler()
  startAutoFetch()

  // Backup scheduler: check every minute if a scheduled backup should run
  setInterval(() => {
    runScheduledBackupCheck().catch((err) => logger.error('Backup scheduler error', { err }))
  }, 60_000)

  server.listen(PORT, () => {
    logger.info(`evload backend listening on port ${PORT}`)
  })
}

bootstrap().catch((err) => {
  logger.error('Backend startup failed', { err })
  process.exit(1)
})

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, starting graceful shutdown')
  const shutdownTimeout = setTimeout(() => {
    logger.warn('Graceful shutdown timeout – forcing exit')
    process.exit(1)
  }, 10_000)
  shutdownTimeout.unref()

  stopEngine({ forceOff: false }).catch(() => {})
  stopFleetSimulator()
  stopWebSocketServer()
  server.close(() => {
    logger.info('HTTP server closed, exiting')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  process.emit('SIGTERM')
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise rejection', { reason })
})

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err })
  process.exit(1)
})

export { app, server }
