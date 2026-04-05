import { Router } from 'express'
import { exec } from 'child_process'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { logger } from '../logger'

const router = Router()
const garageActionLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

/**
 * POST /api/garage/display
 * Controls the physical RPi display power using vcgencmd.
 * Only available when GARAGE_MODE=true is set in the environment.
 *
 * Body: { on: boolean }
 */
router.post('/display', garageActionLimiter, requireAuth, (req, res) => {
  if (process.env.GARAGE_MODE !== 'true') {
    res.status(403).json({ error: 'Garage mode is not enabled. Set GARAGE_MODE=true in .env.' })
    return
  }

  const { on } = req.body as { on?: boolean }
  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'Body must contain { on: boolean }' })
    return
  }

  // vcgencmd display_power 1 = on, 0 = off
  const powerArg = on ? '1' : '0'
  const cmd = `vcgencmd display_power ${powerArg}`

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      logger.warn('GARAGE_DISPLAY: vcgencmd failed', { err, cmd, stderr })
      // Non-fatal: the command may not be available outside RPi
      res.status(500).json({ error: 'vcgencmd not available or failed', detail: stderr })
      return
    }
    logger.info(`GARAGE_DISPLAY: display ${on ? 'ON' : 'OFF'}`, { stdout })
    res.json({ success: true, on })
  })
})

export default router
