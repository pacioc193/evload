import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getVersionInfo, VERSION_HISTORY } from '../version'

const router = Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

router.get('/', limiter, requireAuth, async (_req, res) => {
  const info = await getVersionInfo()
  res.json({
    ...info,
    history: VERSION_HISTORY,
  })
})

export default router
