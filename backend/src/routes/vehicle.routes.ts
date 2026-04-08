import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getVehicleState, sendProxyCommand, requestWakeMode, updateProxyDataRequest } from '../services/proxy.service'
import { isFailsafeActive } from '../services/failsafe.service'
import { logger } from '../logger'
import { getConfig } from '../config'

const router = Router()

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })

/** ms to wait after sending wake_up before attempting the real command */
const WAKE_SETTLE_MS = 5_000
/** extended timeout for commands sent when vehicle was asleep */
const WAKE_CMD_TIMEOUT_MS = 60_000

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

  const vState = getVehicleState()
  const isAsleep = vState.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP'

  // If the vehicle is sleeping and this is not a wake_up call itself, first send
  // an explicit wake_up command so the proxy doesn't have to auto-wake inside the
  // actual command call (which risks a 30 s timeout expiry + false proxy-offline).
  let wakeRequired = false
  if (isAsleep && cmd !== 'wake_up') {
    wakeRequired = true
    logger.info(`🌅[WAKE_BEFORE_CMD] Vehicle is sleeping — sending wake_up before '${cmd}'`, { vehicleId: vid })
    try {
      await requestWakeMode(true)
      // Give the vehicle a moment to fully wake before the real command
      await new Promise<void>((resolve) => setTimeout(resolve, WAKE_SETTLE_MS))
    } catch (wakeErr) {
      logger.warn(`🌅[WAKE_BEFORE_CMD] wake_up failed, proceeding with command anyway`, { cmd, wakeErr })
    }
  }

  try {
    const timeoutMs = wakeRequired ? WAKE_CMD_TIMEOUT_MS : undefined
    const result = await sendProxyCommand(vid, cmd, req.body as Record<string, unknown>, timeoutMs)
    res.json({ success: true, result, wakeRequired })
  } catch (err) {
    logger.error(`Vehicle command ${cmd} failed`, { err })
    res.status(500).json({ error: 'Command failed' })
  }
})

router.put('/data-request/:section', limiter, requireAuth, async (req, res) => {
  const section = req.params['section'] as string
  if (section !== 'charge_state' && section !== 'climate_state') {
    res.status(400).json({ error: 'Invalid section. Allowed: charge_state, climate_state' })
    return
  }
  const vid = getConfig().proxy.vehicleId
  if (!vid) {
    res.status(400).json({ error: 'No vehicle ID configured' })
    return
  }
  try {
    const result = await updateProxyDataRequest(vid, section, req.body as Record<string, unknown>)
    res.json({ success: true, result })
  } catch (err) {
    logger.error(`Vehicle data request update failed for ${section}`, { err })
    res.status(500).json({ error: 'Data request update failed' })
  }
})

export default router
