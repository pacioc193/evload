import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { isFirstLaunch, setPassword, verifyPassword, signToken } from '../auth'
import { logger } from '../logger'

const router = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
})

router.get('/status', authLimiter, async (_req, res) => {
  try {
    const firstLaunch = await isFirstLaunch()
    res.json({ firstLaunch })
  } catch (err) {
    logger.error('auth status error', { err })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/setup', authLimiter, async (req, res) => {
  try {
    const firstLaunch = await isFirstLaunch()
    if (!firstLaunch) {
      res.status(409).json({ error: 'Password already set' })
      return
    }
    const { password } = req.body as { password?: string }
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }
    await setPassword(password)
    const token = signToken()
    res.json({ token })
  } catch (err) {
    logger.error('auth setup error', { err })
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { password } = req.body as { password?: string }
    if (!password) {
      res.status(400).json({ error: 'Password required' })
      return
    }
    const valid = await verifyPassword(password)
    if (!valid) {
      logger.warn('Failed login attempt')
      res.status(401).json({ error: 'Invalid password' })
      return
    }
    const token = signToken()
    res.json({ token })
  } catch (err) {
    logger.error('auth login error', { err })
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
