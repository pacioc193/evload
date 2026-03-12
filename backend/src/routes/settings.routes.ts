import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getConfig, reloadConfig } from '../config'
import { logger } from '../logger'

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(process.cwd(), 'config.yaml')
const EXAMPLE_PATH = path.join(__dirname, '../../config.example.yaml')

const router = Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

router.get('/', limiter, requireAuth, (_req, res) => {
  const cfg = getConfig()
  res.json({
    demo: cfg.demo,
    haUrl: cfg.homeAssistant.url,
    haPowerEntityId: cfg.homeAssistant.powerEntityId,
    haGridEntityId: cfg.homeAssistant.gridEntityId ?? '',
    haMaxHomePowerW: cfg.homeAssistant.maxHomePowerW,
    proxyUrl: cfg.proxy.url,
    vehicleId: cfg.proxy.vehicleId,
    batteryCapacityKwh: cfg.charging.batteryCapacityKwh,
    defaultAmps: cfg.charging.defaultAmps,
    maxAmps: cfg.charging.maxAmps,
    minAmps: cfg.charging.minAmps,
  })
})

router.patch('/', limiter, requireAuth, (req, res) => {
  const incoming = req.body as Partial<{
    demo: boolean
    haUrl: string
    haPowerEntityId: string
    haGridEntityId: string
    haMaxHomePowerW: number
    proxyUrl: string
    vehicleId: string
    batteryCapacityKwh: number
    defaultAmps: number
    maxAmps: number
    minAmps: number
  }>

  let rawYaml: string
  try {
    const src = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_PATH
    rawYaml = fs.readFileSync(src, 'utf8')
  } catch (err) {
    logger.error('Failed to read config for settings patch', { err })
    res.status(500).json({ error: 'Failed to read config' })
    return
  }

  let parsed: Record<string, unknown>
  try {
    parsed = (yaml.load(rawYaml) as Record<string, unknown>) ?? {}
  } catch {
    parsed = {}
  }

  if (incoming.demo !== undefined) parsed['demo'] = incoming.demo

  const ha = (parsed['homeAssistant'] as Record<string, unknown>) ?? {}
  if (incoming.haUrl !== undefined) ha['url'] = incoming.haUrl
  if (incoming.haPowerEntityId !== undefined) ha['powerEntityId'] = incoming.haPowerEntityId
  if (incoming.haGridEntityId !== undefined) ha['gridEntityId'] = incoming.haGridEntityId || undefined
  if (incoming.haMaxHomePowerW !== undefined) ha['maxHomePowerW'] = incoming.haMaxHomePowerW
  parsed['homeAssistant'] = ha

  const proxy = (parsed['proxy'] as Record<string, unknown>) ?? {}
  if (incoming.proxyUrl !== undefined) proxy['url'] = incoming.proxyUrl
  if (incoming.vehicleId !== undefined) proxy['vehicleId'] = incoming.vehicleId
  parsed['proxy'] = proxy

  const charging = (parsed['charging'] as Record<string, unknown>) ?? {}
  if (incoming.batteryCapacityKwh !== undefined) charging['batteryCapacityKwh'] = incoming.batteryCapacityKwh
  if (incoming.defaultAmps !== undefined) charging['defaultAmps'] = incoming.defaultAmps
  if (incoming.maxAmps !== undefined) charging['maxAmps'] = incoming.maxAmps
  if (incoming.minAmps !== undefined) charging['minAmps'] = incoming.minAmps
  parsed['charging'] = charging

  try {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(parsed), 'utf8')
    logger.info('Settings updated via API')
  } catch (err) {
    logger.error('Failed to write settings', { err })
    res.status(500).json({ error: 'Failed to write settings' })
    return
  }

  try {
    reloadConfig()
  } catch (err) {
    logger.warn('Config reload failed after settings update', { err })
  }

  res.json({ success: true })
})

export default router
