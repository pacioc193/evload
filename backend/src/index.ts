import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { logger } from './logger'
import { loadConfig } from './config'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = express()

app.use(cors())
app.use(express.json())

loadConfig()

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const FRONTEND_DIST = process.env.FRONTEND_DIST ?? path.join(__dirname, '../../frontend/dist')

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(FRONTEND_DIST))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })
}

app.listen(PORT, () => {
  logger.info(`evload backend listening on port ${PORT}`)
})

export { app }
