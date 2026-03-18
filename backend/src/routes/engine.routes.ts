import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getEngineStatus, startEngine, stopEngine, setPlanMode } from '../engine/charging.engine'
import { requestWakeMode, triggerImmediatePoll } from '../services/proxy.service'
import { isFailsafeActive, getFailsafeReason, resetFailsafe } from '../services/failsafe.service'
import {
  dispatchTelegramNotificationEvent,
  getNotificationEventOptions,
  validateNotificationPayload,
} from '../services/notification-rules.service'
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
    triggerImmediatePoll().catch(() => {})
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

router.post('/wake', engineActionLimiter, requireAuth, async (_req, res) => {
  try {
    await requestWakeMode(true)
    res.json({ success: true })
  } catch (err) {
    logger.error('Vehicle wake request error', { err })
    res.status(500).json({ error: 'Failed to request wake mode' })
  }
})

router.post('/mode', engineActionLimiter, requireAuth, (req, res) => {
  const { mode, targetSoc } = req.body as { mode?: string; targetSoc?: number }
  if (mode !== 'plan') {
    res.status(400).json({ error: 'mode must be "plan"' })
    return
  }
  const soc = targetSoc ?? 80
  if (soc < 1 || soc > 100) {
    res.status(400).json({ error: 'targetSoc must be 1-100' })
    return
  }
  setPlanMode(soc)
  res.json({ success: true, status: getEngineStatus() })
})

router.post('/failsafe/reset', engineActionLimiter, requireAuth, async (_req, res) => {
  await resetFailsafe()
  res.json({ success: true })
})

router.post('/test-event', engineActionLimiter, requireAuth, async (req, res) => {
  const { event, payload } = req.body as { event: string; payload?: Record<string, unknown> }
  if (!event) return res.status(400).json({ error: 'event is required' })
  if (!getNotificationEventOptions().includes(event)) {
    return res.status(400).json({ error: 'unknown event', event })
  }
  const validation = validateNotificationPayload(event, payload || {})
  if (!validation.valid) {
    return res.status(400).json({
      error: 'payload does not match selected event schema',
      schema: validation,
    })
  }
  try {
    const result = await dispatchTelegramNotificationEvent(event, payload || {})
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

export default router
