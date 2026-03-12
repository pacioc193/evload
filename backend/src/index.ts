import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import rateLimit from 'express-rate-limit'
import { logger } from './logger'
import { loadConfig } from './config'
import authRoutes from './routes/auth.routes'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = express()

app.use(cors())
app.use(express.json())

loadConfig()

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)

const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist')

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(FRONTEND_DIST))
  app.get('*', generalLimiter, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })
}

app.listen(PORT, () => {
  logger.info(`evload backend listening on port ${PORT}`)
})

export { app }
