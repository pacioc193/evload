import { Router } from 'express'
import { execFile } from 'child_process'
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
  // Use execFile (no shell) to avoid any injection
  const powerArg = on ? '1' : '0'

  execFile('vcgencmd', ['display_power', powerArg], (err, stdout, stderr) => {
    if (err) {
      // Distinguish "command not found" from other failures so users get a clear message
      const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (notFound) {
        logger.warn('GARAGE_DISPLAY: vcgencmd not found – is this running on a Raspberry Pi with vcgencmd installed?')
        res.status(503).json({ error: 'vcgencmd not found. Ensure GARAGE_MODE is only enabled on a Raspberry Pi.' })
      } else {
        logger.warn('GARAGE_DISPLAY: vcgencmd failed', { err, stderr })
        res.status(500).json({ error: 'vcgencmd failed', detail: stderr })
      }
      return
    }
    logger.info(`GARAGE_DISPLAY: display ${on ? 'ON' : 'OFF'}`, { stdout })
    res.json({ success: true, on })
  })
})

export default router
