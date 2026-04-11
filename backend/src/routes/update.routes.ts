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
import { getEngineStatus } from '../engine/charging.engine'
import { getVehicleState, getProxyHealthState } from '../services/proxy.service'
import { isFailsafeActive, getFailsafeReason } from '../services/failsafe.service'

const router = Router()

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })
// Tighter limit for start: max 3 updates in 5 minutes
const startLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 3 })
// Fetch limiter: avoid hammering GitHub
const fetchLimiter = rateLimit({ windowMs: 60 * 1000, max: 6 })

interface OtaGuardCheck {
  blocked: boolean
  reasons: string[]
  engineRunning: boolean
  engineMode: 'off' | 'plan' | 'on'
  sessionActive: boolean
  vehicleCharging: boolean
  chargingState: string | null
  proxyConnected: boolean
  failsafeActive: boolean
  failsafeReason: string | null
}

function getOtaGuardCheck(): OtaGuardCheck {
  const engine = getEngineStatus()
  const vehicle = getVehicleState()
  const proxy = getProxyHealthState()
  const failsafeActive = isFailsafeActive()
  const failsafeReason = getFailsafeReason() || null

  const reasons: string[] = []
  if (engine.running) reasons.push('Engine is running')
  if (engine.sessionId !== null) reasons.push('Charging session is active')
  if (engine.mode === 'plan') reasons.push('Plan mode is armed')
  if (vehicle.charging) reasons.push('Vehicle reports active charging')
  if (vehicle.chargingState === 'Charging') reasons.push('Vehicle charging_state is Charging')
  if (failsafeActive) reasons.push(`Failsafe active${failsafeReason ? `: ${failsafeReason}` : ''}`)
  if (!proxy.connected) reasons.push('Proxy is disconnected')

  return {
    blocked: reasons.length > 0,
    reasons,
    engineRunning: engine.running,
    engineMode: engine.mode,
    sessionActive: engine.sessionId !== null,
    vehicleCharging: vehicle.charging,
    chargingState: vehicle.chargingState,
    proxyConnected: proxy.connected,
    failsafeActive,
    failsafeReason,
  }
}

// GET /api/update/status
// Returns: update state + current branch + available branches + local/remote commit info
// Optional ?branch= to get remote info for a specific branch (e.g. the target branch selected in UI)
router.get('/status', limiter, requireAuth, async (req, res) => {
  try {
    const [updaterStatus, currentBranch, branches, localCommit] = await Promise.all([
      Promise.resolve(getUpdaterStatus()),
      getCurrentBranch(),
      getGitBranches(),
      getLocalCommit(),
    ])
    // Use the requested branch for remote comparison (defaults to currently checked-out branch)
    const targetBranch =
      typeof req.query['branch'] === 'string' && req.query['branch'].trim()
        ? req.query['branch'].trim()
        : currentBranch
    const [remoteCommit, behindCount] = await Promise.all([
      getRemoteCommit(targetBranch),
      getBehindCount(targetBranch),
    ])
    const guard = getOtaGuardCheck()
    res.json({
      ...updaterStatus,
      currentBranch,
      branches,
      localCommit,
      remoteCommit,
      behindCount,
      otaGuards: guard,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/update/fetch — fetch remote without switching branch (refresh remote tracking refs)
// Optional body { branch } to get remote info for a specific target branch
router.post('/fetch', fetchLimiter, requireAuth, async (req, res) => {
  try {
    await fetchRemote()
    const [currentBranch, localCommit] = await Promise.all([
      getCurrentBranch(),
      getLocalCommit(),
    ])
    const { branch: bodyBranch } = req.body as { branch?: string }
    const targetBranch =
      typeof bodyBranch === 'string' && bodyBranch.trim() ? bodyBranch.trim() : currentBranch
    const [remoteCommit, behindCount] = await Promise.all([
      getRemoteCommit(targetBranch),
      getBehindCount(targetBranch),
    ])
    res.json({ success: true, localCommit, remoteCommit, behindCount })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/update/start — start OTA update on the given branch
router.post('/start', startLimiter, requireAuth, (req, res) => {
  const { branch, force } = req.body as { branch?: string; force?: boolean }
  if (!branch || typeof branch !== 'string' || !branch.trim()) {
    res.status(400).json({ error: 'branch is required' })
    return
  }

  const guard = getOtaGuardCheck()
  if (guard.blocked && !force) {
    res.status(409).json({
      error: 'OTA blocked by safety guards',
      reasons: guard.reasons,
      otaGuards: guard,
      hint: 'Set force=true only if you accept update risks during active operations',
    })
    return
  }

  const result = startUpdate(branch.trim())
  if (!result.started) {
    res.status(409).json({ error: result.reason })
    return
  }
  res.json({ success: true, branch: branch.trim(), forced: Boolean(force) })
})

// GET /api/update/logs?from=<byte> — return new log content since byte offset
router.get('/logs', limiter, requireAuth, (req, res) => {
  const fromByte = parseInt(String(req.query['from'] ?? '0'), 10)
  const result = getUpdateLogs(isNaN(fromByte) ? 0 : Math.max(0, fromByte))
  res.json(result)
})

export default router
