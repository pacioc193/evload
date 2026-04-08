import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import {
  getUpdaterStatus,
  getGitBranches,
  getCurrentBranch,
  getLocalCommit,
  getRemoteCommit,
  getBehindCount,
  fetchRemote,
  getUpdateLogs,
  startUpdate,
} from '../services/updater.service'

const router = Router()

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })
// Tighter limit for start: max 3 updates in 5 minutes
const startLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 3 })
// Fetch limiter: avoid hammering GitHub
const fetchLimiter = rateLimit({ windowMs: 60 * 1000, max: 6 })

// GET /api/update/status
// Returns: update state + current branch + available branches + local/remote commit info
router.get('/status', limiter, requireAuth, async (_req, res) => {
  try {
    const [updaterStatus, currentBranch, branches, localCommit] = await Promise.all([
      Promise.resolve(getUpdaterStatus()),
      getCurrentBranch(),
      getGitBranches(),
      getLocalCommit(),
    ])
    // remote commit + behind count for current branch (uses local tracking refs — no network)
    const [remoteCommit, behindCount] = await Promise.all([
      getRemoteCommit(currentBranch),
      getBehindCount(currentBranch),
    ])
    res.json({
      ...updaterStatus,
      currentBranch,
      branches,
      localCommit,
      remoteCommit,
      behindCount,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/update/fetch — fetch remote without switching branch (refresh remote tracking refs)
router.post('/fetch', fetchLimiter, requireAuth, async (_req, res) => {
  try {
    await fetchRemote()
    const [currentBranch, localCommit] = await Promise.all([
      getCurrentBranch(),
      getLocalCommit(),
    ])
    const [remoteCommit, behindCount] = await Promise.all([
      getRemoteCommit(currentBranch),
      getBehindCount(currentBranch),
    ])
    res.json({ success: true, localCommit, remoteCommit, behindCount })
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
