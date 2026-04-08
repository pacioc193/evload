import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import {
  getUpdaterStatus,
  getGitBranches,
  getCurrentBranch,
  getUpdateLogs,
  startUpdate,
} from '../services/updater.service'

const router = Router()

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })
// Tighter limit for start: max 3 updates in 5 minutes
const startLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 3 })

// GET /api/update/status — returns update state, current branch, available branches, log size
router.get('/status', limiter, requireAuth, async (_req, res) => {
  try {
    const [status, currentBranch, branches] = await Promise.all([
      Promise.resolve(getUpdaterStatus()),
      getCurrentBranch(),
      getGitBranches(),
    ])
    res.json({ ...status, currentBranch, branches })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/update/start — start OTA update on the given branch
router.post('/start', startLimiter, requireAuth, (req, res) => {
  const { branch } = req.body as { branch?: string }
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    res.status(400).json({ error: 'branch is required' })
    return
  }
  const result = startUpdate(branch.trim())
  if (!result.started) {
    res.status(409).json({ error: result.reason })
    return
  }
  res.json({ success: true, branch: branch.trim() })
})

// GET /api/update/logs?from=<byte> — return new log content since byte offset
router.get('/logs', limiter, requireAuth, (req, res) => {
  const fromByte = parseInt(String(req.query['from'] ?? '0'), 10)
  const result = getUpdateLogs(isNaN(fromByte) ? 0 : Math.max(0, fromByte))
  res.json(result)
})

export default router
