import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getVehicleState, sendProxyCommand } from '../services/proxy.service'
import { isFailsafeActive } from '../services/failsafe.service'
import { logger } from '../logger'
import { getConfig } from '../config'

const router = Router()

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })

router.get('/state', limiter, requireAuth, (_req, res) => {
  res.json(getVehicleState())
})

router.post('/command/:cmd', limiter, requireAuth, async (req, res) => {
  if (isFailsafeActive()) {
    res.status(503).json({ error: 'Failsafe active - commands disabled' })
    return
  }
  const cmd = req.params['cmd'] as string
  const vid = getConfig().proxy.vehicleId
  if (!vid) {
    res.status(400).json({ error: 'No vehicle ID configured' })
    return
  }
  try {
    const result = await sendProxyCommand(vid, cmd, req.body as Record<string, unknown>)
    res.json({ success: true, result })
  } catch (err) {
    logger.error(`Vehicle command ${cmd} failed`, { err })
    res.status(500).json({ error: 'Command failed' })
  }
})

export default router
