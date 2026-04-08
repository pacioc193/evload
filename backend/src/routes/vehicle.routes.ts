import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getVehicleState, sendProxyCommand, updateProxyDataRequest } from '../services/proxy.service'
import { isFailsafeActive } from '../services/failsafe.service'
import { logger } from '../logger'
import { getConfig } from '../config'

const router = Router()

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })

/**
 * Allowlist of commands that can be forwarded to the TeslaBleHttpProxy.
 * Any command not in this list is rejected with 400.
 */
const ALLOWED_COMMANDS = new Set([
  'wake_up',
  'charge_start',
  'charge_stop',
  'set_charging_amps',
  'set_charge_limit',
  'auto_conditioning_start',
  'auto_conditioning_stop',
  'charge_port_door_open',
  'charge_port_door_close',
  'flash_lights',
  'honk_horn',
  'door_lock',
  'door_unlock',
  'set_sentry_mode',
  'defrost_max',
  'set_temps',
])

router.get('/state', limiter, requireAuth, (_req, res) => {
  res.json(getVehicleState())
})

router.post('/command/:cmd', limiter, requireAuth, async (req, res) => {
  if (isFailsafeActive()) {
    res.status(503).json({ error: 'Failsafe active - commands disabled' })
    return
  }
  const cmd = req.params['cmd'] as string

  // Validate command against allowlist to prevent SSRF / request-forgery
  if (!ALLOWED_COMMANDS.has(cmd)) {
    res.status(400).json({ error: `Unknown command: ${cmd}` })
    return
  }

  const vid = getConfig().proxy.vehicleId
  if (!vid) {
    res.status(400).json({ error: 'No vehicle ID configured' })
    return
  }

  // sendProxyCommand always uses ?wait=true, so the proxy handles auto-wake
  // + BLE command execution synchronously with a 90 s timeout.
  // Log sleep state for diagnostics only.
  const vState = getVehicleState()
  const isAsleep = vState.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP'
  if (isAsleep) {
    logger.info(`🌅[CMD_WHILE_ASLEEP] Vehicle sleeping — proxy will auto-wake via ?wait=true`, { cmd, vehicleId: vid })
  }

  try {
    const result = await sendProxyCommand(vid, cmd, req.body as Record<string, unknown>)
    res.json({ success: true, result })
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
