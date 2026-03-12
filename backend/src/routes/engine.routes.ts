import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getEngineStatus, startEngine, stopEngine } from '../engine/charging.engine'
import { isFailsafeActive, getFailsafeReason, resetFailsafe } from '../services/failsafe.service'
import { logger } from '../logger'

const router = Router()

const engineActionLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 })

router.get('/status', engineActionLimiter, requireAuth, (_req, res) => {
  res.json({
    engine: getEngineStatus(),
    failsafe: { active: isFailsafeActive(), reason: getFailsafeReason() },
  })
})

router.post('/start', engineActionLimiter, requireAuth, async (req, res) => {
  if (isFailsafeActive()) {
    res.status(503).json({ error: 'Failsafe active' })
    return
  }
  const { targetSoc, targetAmps } = req.body as { targetSoc?: number; targetAmps?: number }
  if (!targetSoc || targetSoc < 1 || targetSoc > 100) {
    res.status(400).json({ error: 'targetSoc must be 1-100' })
    return
  }
  try {
    await startEngine(targetSoc, targetAmps)
    res.json({ success: true, status: getEngineStatus() })
  } catch (err) {
    logger.error('Engine start error', { err })
    res.status(500).json({ error: 'Failed to start engine' })
  }
})

router.post('/stop', engineActionLimiter, requireAuth, async (_req, res) => {
  try {
    await stopEngine()
    res.json({ success: true, status: getEngineStatus() })
  } catch (err) {
    logger.error('Engine stop error', { err })
    res.status(500).json({ error: 'Failed to stop engine' })
  }
})

router.post('/failsafe/reset', engineActionLimiter, requireAuth, async (_req, res) => {
  await resetFailsafe()
  res.json({ success: true })
})

export default router
