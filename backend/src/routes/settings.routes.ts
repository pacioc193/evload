import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { execFile } from 'child_process'
import { promisify } from 'util'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { getConfig, reloadConfig } from '../config'
import { logger, setLoggerLevel } from '../logger'
import { setPassword, verifyPassword } from '../auth'
import {
  buildTimestampPayload,
  extractMissingTemplatePlaceholders,
  getNotificationEventOptions,
  getNotificationPlaceholderCatalog,
  sendTelegramNotificationTest,
  validateNotificationPayload,
} from '../services/notification-rules.service'
import { getTelegramPrerequisiteStatus, hasBotToken, initTelegram, setBotToken } from '../services/telegram.service'

const execFileAsync = promisify(execFile)

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(process.cwd(), 'config.yaml')
const EXAMPLE_PATH = path.join(__dirname, '../../config.example.yaml')
const LOG_DIR = path.join(process.cwd(), 'logs')

const router = Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

router.get('/', limiter, requireAuth, (_req, res) => {
  const cfg = getConfig()
  res.json({
    demo: cfg.demo,
    logLevel: cfg.logLevel,
    timezone: cfg.timezone,
    haUrl: cfg.homeAssistant.url,
    haPowerEntityId: cfg.homeAssistant.powerEntityId,
    haChargerEntityId: cfg.homeAssistant.chargerEntityId,
    haMaxHomePowerW: cfg.homeAssistant.maxHomePowerW,
    resumeDelaySec: cfg.homeAssistant.resumeDelaySec,
    proxyUrl: cfg.proxy.url,
    vehicleId: cfg.proxy.vehicleId,
    vehicleName: cfg.proxy.vehicleName,
    chargingPollIntervalMs: cfg.proxy.chargingPollIntervalMs,
    windowPollIntervalMs: cfg.proxy.windowPollIntervalMs,
    bodyPollIntervalMs: cfg.proxy.bodyPollIntervalMs,
    vehicleDataWindowMs: cfg.proxy.vehicleDataWindowMs,
    rejectUnauthorized: cfg.proxy.rejectUnauthorized,
    batteryCapacityKwh: cfg.charging.batteryCapacityKwh,
    energyPriceEurPerKwh: cfg.charging.energyPriceEurPerKwh,
    defaultAmps: cfg.charging.defaultAmps,
    startAmps: cfg.charging.startAmps,
    planWakeBeforeMinutes: cfg.charging.planWakeBeforeMinutes,
    nominalVoltageV: cfg.charging.nominalVoltageV,
    finishBySafetyMarginPct: cfg.charging.finishBySafetyMarginPct,
    maxAmps: cfg.charging.maxAmps,
    minAmps: cfg.charging.minAmps,
    stopChargeOnManualStart: cfg.charging.stopChargeOnManualStart,
    rampIntervalSec: cfg.charging.rampIntervalSec,
    chargeStartRetryMs: cfg.charging.chargeStartRetryMs,
    chargeStartGraceSec: cfg.charging.chargeStartGraceSec,
    telegramEnabled: cfg.telegram.enabled,
    telegramBotToken: hasBotToken() ? '********' : '',
    telegramAllowedChatIds: cfg.telegram.allowedChatIds,
    telegramRules: cfg.telegram.notifications.rules,
  })
})

router.patch('/', limiter, requireAuth, async (req, res) => {
  const incoming = req.body as Partial<{
    demo: boolean
    logLevel: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'
    timezone: string
    haUrl: string
    haPowerEntityId: string
    haChargerEntityId: string
    haMaxHomePowerW: number
    resumeDelaySec: number
    proxyUrl: string
    vehicleId: string
    vehicleName: string
    chargingPollIntervalMs: number
    windowPollIntervalMs: number
    bodyPollIntervalMs: number
    vehicleDataWindowMs: number
    rejectUnauthorized: boolean
    batteryCapacityKwh: number
    energyPriceEurPerKwh: number
    defaultAmps: number
    startAmps: number
    planWakeBeforeMinutes: number
    nominalVoltageV: number
    finishBySafetyMarginPct: number
    maxAmps: number
    minAmps: number
    stopChargeOnManualStart: boolean
    rampIntervalSec: number
    chargeStartRetryMs: number
    chargeStartGraceSec: number
    telegramEnabled: boolean
    telegramBotToken: string
    telegramAllowedChatIds: string[]
    telegramRules: Array<{
      id: string
      name: string
      enabled: boolean
      event: string
      template: string
      condition?: {
        field: string
        operator: 'exists' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'changed' | 'increased_by' | 'decreased_by' | 'mod_step'
        value?: string | number | boolean
      }
    }>
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
  if (incoming.logLevel !== undefined) parsed['logLevel'] = incoming.logLevel
  if (incoming.timezone !== undefined) {
    const tz = String(incoming.timezone).trim()
    parsed['timezone'] = tz
  }

  const activeCfg = getConfig()

  const ha = (parsed['homeAssistant'] as Record<string, unknown>) ?? {}
  if (incoming.haUrl !== undefined) ha['url'] = incoming.haUrl
  if (incoming.haPowerEntityId !== undefined) ha['powerEntityId'] = incoming.haPowerEntityId
  if (incoming.haChargerEntityId !== undefined) ha['chargerEntityId'] = incoming.haChargerEntityId
  if (incoming.haMaxHomePowerW !== undefined) ha['maxHomePowerW'] = incoming.haMaxHomePowerW
  if (incoming.resumeDelaySec !== undefined) ha['resumeDelaySec'] = incoming.resumeDelaySec

  const nextHaUrl = String(ha['url'] ?? activeCfg.homeAssistant.url ?? '').trim()
  const nextHaPowerEntityId = String(ha['powerEntityId'] ?? activeCfg.homeAssistant.powerEntityId ?? '').trim()
  const nextHaChargerEntityId = String(ha['chargerEntityId'] ?? activeCfg.homeAssistant.chargerEntityId ?? '').trim()

  if (!nextHaUrl || !nextHaPowerEntityId || !nextHaChargerEntityId) {
    res.status(400).json({
      error: 'Invalid Home Assistant configuration: haUrl, haPowerEntityId and haChargerEntityId are required',
    })
    return
  }

  ha['url'] = nextHaUrl
  ha['powerEntityId'] = nextHaPowerEntityId
  ha['chargerEntityId'] = nextHaChargerEntityId
  parsed['homeAssistant'] = ha

  const proxy = (parsed['proxy'] as Record<string, unknown>) ?? {}
  if (incoming.proxyUrl !== undefined) proxy['url'] = incoming.proxyUrl
  if (incoming.vehicleId !== undefined) proxy['vehicleId'] = incoming.vehicleId
  if (incoming.vehicleName !== undefined) proxy['vehicleName'] = incoming.vehicleName
  if (incoming.chargingPollIntervalMs !== undefined) proxy['chargingPollIntervalMs'] = incoming.chargingPollIntervalMs
  if (incoming.windowPollIntervalMs !== undefined) proxy['windowPollIntervalMs'] = incoming.windowPollIntervalMs
  if (incoming.bodyPollIntervalMs !== undefined) proxy['bodyPollIntervalMs'] = incoming.bodyPollIntervalMs
  if (incoming.vehicleDataWindowMs !== undefined) proxy['vehicleDataWindowMs'] = incoming.vehicleDataWindowMs
  if (incoming.rejectUnauthorized !== undefined) proxy['rejectUnauthorized'] = incoming.rejectUnauthorized
  parsed['proxy'] = proxy

  const charging = (parsed['charging'] as Record<string, unknown>) ?? {}
  if (incoming.batteryCapacityKwh !== undefined) charging['batteryCapacityKwh'] = incoming.batteryCapacityKwh
  if (incoming.energyPriceEurPerKwh !== undefined) charging['energyPriceEurPerKwh'] = incoming.energyPriceEurPerKwh
  if (incoming.defaultAmps !== undefined) charging['defaultAmps'] = incoming.defaultAmps
  if (incoming.startAmps !== undefined) charging['startAmps'] = incoming.startAmps
  if (incoming.planWakeBeforeMinutes !== undefined) charging['planWakeBeforeMinutes'] = incoming.planWakeBeforeMinutes
  if (incoming.nominalVoltageV !== undefined) charging['nominalVoltageV'] = incoming.nominalVoltageV
  if (incoming.finishBySafetyMarginPct !== undefined) charging['finishBySafetyMarginPct'] = incoming.finishBySafetyMarginPct
  if (incoming.maxAmps !== undefined) charging['maxAmps'] = incoming.maxAmps
  if (incoming.minAmps !== undefined) charging['minAmps'] = incoming.minAmps
  if (incoming.stopChargeOnManualStart !== undefined) charging['stopChargeOnManualStart'] = incoming.stopChargeOnManualStart
  if (incoming.rampIntervalSec !== undefined) charging['rampIntervalSec'] = incoming.rampIntervalSec
  if (incoming.chargeStartRetryMs !== undefined) charging['chargeStartRetryMs'] = incoming.chargeStartRetryMs
  if (incoming.chargeStartGraceSec !== undefined) charging['chargeStartGraceSec'] = incoming.chargeStartGraceSec

  const nextDefaultAmps = Number(charging['defaultAmps'] ?? activeCfg.charging.defaultAmps)
  const nextMaxAmps = Number(charging['maxAmps'] ?? activeCfg.charging.maxAmps)
  const nextMinAmps = Number(charging['minAmps'] ?? activeCfg.charging.minAmps)
  const nextEnergyPrice = Number(charging['energyPriceEurPerKwh'] ?? activeCfg.charging.energyPriceEurPerKwh)
  if (!(nextMinAmps <= nextDefaultAmps && nextDefaultAmps <= nextMaxAmps)) {
    res.status(400).json({ error: 'Invalid charging amperage configuration: expected minAmps <= defaultAmps <= maxAmps' })
    return
  }
  if (!Number.isFinite(nextEnergyPrice) || nextEnergyPrice < 0) {
    res.status(400).json({ error: 'Invalid energy price configuration: energyPriceEurPerKwh must be >= 0' })
    return
  }

  parsed['charging'] = charging

  const telegram = (parsed['telegram'] as Record<string, unknown>) ?? {}
  if (incoming.telegramEnabled !== undefined) telegram['enabled'] = incoming.telegramEnabled

  if (incoming.telegramBotToken !== undefined && !incoming.telegramBotToken.includes('***')) {
    const newToken = incoming.telegramBotToken.trim()
    if (newToken) {
      try {
        await setBotToken(newToken)
        logger.info('Telegram Bot Token saved to database')
      } catch (err) {
        logger.error('Failed to save Telegram bot token to database', { err })
      }
    }
  }

  delete telegram['botToken']

  if (incoming.telegramAllowedChatIds !== undefined) telegram['allowedChatIds'] = incoming.telegramAllowedChatIds

  const notifications = (telegram['notifications'] as Record<string, unknown>) ?? {}
  if (incoming.telegramRules !== undefined) {
    const invalidRule = incoming.telegramRules.find((rule) => {
      const event = String(rule.event || '').trim()
      const template = String(rule.template || '').trim()
      return !event || !template
    })
    if (invalidRule) {
      res.status(400).json({ error: 'Each telegram rule requires non-empty event and template' })
      return
    }

    notifications['rules'] = incoming.telegramRules.map((rule, index) => {
      const event = String(rule.event || '').trim()
      const template = String(rule.template || '').trim()

      const id = String(rule.id || `rule-${Date.now()}-${index}`)
      const baseRule: Record<string, unknown> = {
        id,
        name: rule.name || `Rule ${index + 1}`,
        enabled: Boolean(rule.enabled),
        event,
        template,
      }

      const field = rule.condition?.field?.trim() || ''
      if (field.length > 0) {
        baseRule['condition'] = {
          field,
          operator: rule.condition?.operator ?? 'exists',
          value: rule.condition?.value,
        }
      }

      return baseRule
    })
  }
  telegram['notifications'] = notifications
  parsed['telegram'] = telegram

  try {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(parsed), 'utf8')
    logger.info('Settings updated via API')
  } catch (err) {
    logger.error('Failed to write settings', { err })
    res.status(500).json({ error: 'Failed to write settings' })
    return
  }

  try {
    const nextCfg = reloadConfig()
    setLoggerLevel(nextCfg.logLevel)
    // Apply timezone to the running process immediately (no restart needed on Linux).
    if (nextCfg.timezone && nextCfg.timezone !== 'UTC') {
      process.env.TZ = nextCfg.timezone
      logger.info('Timezone updated', { timezone: nextCfg.timezone })
    } else if (nextCfg.timezone === 'UTC') {
      process.env.TZ = 'UTC'
    }
    initTelegram()
  } catch (err) {
    logger.warn('Config reload failed after settings update', { err })
  }

  res.json({ success: true })
})

// ─── System Time ──────────────────────────────────────────────────────────────

router.post('/system-time', limiter, requireAuth, async (req, res) => {
  const cfg = getConfig()
  if (cfg.demo) {
    res.status(403).json({ error: 'System time cannot be changed in demo mode' })
    return
  }

  const { iso } = req.body as { iso?: string }
  if (!iso || typeof iso !== 'string') {
    res.status(400).json({ error: 'iso field (ISO 8601 datetime string) is required' })
    return
  }

  // Validate that it is a parseable ISO date
  const parsed = new Date(iso)
  if (isNaN(parsed.getTime())) {
    res.status(400).json({ error: 'iso value is not a valid date string' })
    return
  }

  // Format for `date -s`: "YYYY-MM-DD HH:MM:SS"
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())}`

  try {
    // Try timedatectl first (systemd), fall back to `date -s`
    try {
      await execFileAsync('timedatectl', ['set-time', dateStr])
    } catch {
      await execFileAsync('date', ['-s', dateStr])
    }
    logger.info('System time updated', { iso, dateStr })
    res.json({ success: true, appliedUtc: dateStr })
  } catch (err) {
    logger.error('Failed to set system time', { err, iso })
    res.status(500).json({ error: 'Failed to set system time. Ensure the process has the required privileges (CAP_SYS_TIME or sudo).' })
  }
})

router.post('/password', limiter, requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body as {
      currentPassword?: string
      newPassword?: string
      confirmPassword?: string
    }

    // Validate input
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'currentPassword and newPassword are required' })
      return
    }

    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'newPassword and confirmPassword do not match' })
      return
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword)
    if (!isValid) {
      logger.warn('Failed password change attempt: invalid current password')
      res.status(401).json({ error: 'Current password is incorrect' })
      return
    }

    // Set new password
    await setPassword(newPassword)
    logger.info('User changed password via settings')
    res.json({ success: true, message: 'Password changed successfully' })
  } catch (err) {
    logger.error('Password change failed', { err })
    res.status(500).json({ error: 'Failed to change password' })
  }
})

router.post('/telegram/test', limiter, requireAuth, async (req, res) => {
  const body = req.body as {
    event?: string
    template?: string
    payload?: Record<string, unknown>
  }

  const event = body.event?.trim() || ''
  const template = body.template?.trim() || ''
  const payload = body.payload ?? {}

  if (!event || !template) {
    res.status(400).json({ error: 'event and template are required' })
    return
  }

  if (!getNotificationEventOptions().includes(event)) {
    res.status(400).json({ error: 'unknown event', event })
    return
  }

  const validation = validateNotificationPayload(event, payload)
  if (!validation.valid) {
    res.status(400).json({
      error: 'payload does not match selected event schema',
      schema: validation,
    })
    return
  }

  const prereq = getTelegramPrerequisiteStatus()
  if (!prereq.ok) {
    res.status(400).json({
      error: 'telegram prerequisites not satisfied',
      prerequisites: prereq,
    })
    return
  }

  const missingPlaceholders = extractMissingTemplatePlaceholders(template, {
    ...buildTimestampPayload(new Date()),
    event,
    ...payload,
  })

  try {
    const result = await sendTelegramNotificationTest(event, payload, template)
    res.json({
      success: true,
      rendered: result.rendered,
      delivered: result.delivered,
      missingPlaceholders,
    })
  } catch (err) {
    logger.error('Telegram test notification failed', { err })
    res.status(500).json({ error: 'Failed to send Telegram test notification' })
  }
})

router.get('/telegram/placeholders', limiter, requireAuth, (_req, res) => {
  const catalog = getNotificationPlaceholderCatalog()
  res.json({
    messageSource: 'user_rules_only',
    events: getNotificationEventOptions(),
    placeholders: {
      all: catalog.all,
      byEvent: catalog.byEvent,
      descriptions: catalog.descriptions || {},
      presets: catalog.presets || {},
      schemas: catalog.schemas || {},
    },
  })
})

// ─── Log Download ─────────────────────────────────────────────────────────────

const logDownloadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 })

function parseSinceDuration(since: string | undefined): number | null {
  if (!since) return null
  if (since === '1h') return 60 * 60 * 1000
  if (since === '6h') return 6 * 60 * 60 * 1000
  if (since === '24h') return 24 * 60 * 60 * 1000
  if (since === '7d') return 7 * 24 * 60 * 60 * 1000
  return null
}

function formatLogLinePretty(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as {
      timestamp?: string
      level?: string
      message?: string
      [key: string]: unknown
    }
    const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : 'unknown-time'
    const level = typeof parsed.level === 'string' ? parsed.level.toUpperCase() : 'INFO'
    const message = typeof parsed.message === 'string' ? parsed.message : '(no message)'
    const extras = { ...parsed }
    delete extras.timestamp
    delete extras.level
    delete extras.message
    const extraPart = Object.keys(extras).length > 0 ? ` ${JSON.stringify(extras)}` : ''
    return `[${timestamp}] ${level} ${message}${extraPart}`
  } catch {
    return trimmed
  }
}

router.get('/logs/backend', logDownloadLimiter, requireAuth, (req, res) => {
  const format = (req.query.format as string) === 'pretty' ? 'pretty' : 'json'
  const filename = 'log'
  const logPath = path.join(LOG_DIR, filename)
  const since = req.query.since as string | undefined
  const duration = parseSinceDuration(since)

  if (!fs.existsSync(logPath)) {
    res.status(404).json({ error: `Log file '${filename}' not found` })
    return
  }

  const stat = fs.statSync(logPath)
  logger.info('📥 [LOGS] Backend log download requested', {
    filename,
    sizeBytes: stat.size,
    since: since ?? 'all',
    remoteIp: req.ip,
  })

  res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')

  const maybeFormat = (content: string): string => {
    if (format !== 'pretty') return content
    return content
      .split('\n')
      .map(formatLogLinePretty)
      .filter(Boolean)
      .join('\n')
  }

  if (duration !== null) {
    // Time-filtered download: read file, parse JSON lines, filter by timestamp
    try {
      const cutoffIso = new Date(Date.now() - duration).toISOString()
      const content = fs.readFileSync(logPath, 'utf8')
      const filteredRaw = content
        .split('\n')
        .filter(line => {
          if (!line.trim()) return false
          try {
            const parsed = JSON.parse(line) as { timestamp?: string }
            return typeof parsed.timestamp === 'string' && parsed.timestamp >= cutoffIso
          } catch {
            return true
          }
        })
        .join('\n')
      const filtered = maybeFormat(filteredRaw)
      res.setHeader('Content-Length', Buffer.byteLength(filtered, 'utf8'))
      res.send(filtered)
    } catch (err) {
      logger.error('Failed to filter backend log file', { err, filename })
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read log file' })
      }
    }
    return
  }

  if (format === 'pretty') {
    try {
      const content = fs.readFileSync(logPath, 'utf8')
      const pretty = maybeFormat(content)
      res.setHeader('Content-Length', Buffer.byteLength(pretty, 'utf8'))
      res.send(pretty)
    } catch (err) {
      logger.error('Failed to pretty-format backend log file', { err, filename })
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read log file' })
      }
    }
    return
  }

  res.setHeader('Content-Length', stat.size)
  const stream = fs.createReadStream(logPath)
  stream.on('error', (err) => {
    logger.error('Failed to stream backend log file', { err, filename })
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read log file' })
    }
  })
  stream.pipe(res)
})

router.post('/logs/frontend', logDownloadLimiter, requireAuth, (req, res) => {
  const { logs } = req.body as { logs?: string }
  if (!logs || typeof logs !== 'string') {
    res.status(400).json({ error: 'logs string is required' })
    return
  }

  const frontendLogPath = path.join(LOG_DIR, 'frontend.log')
  const MAX_FRONTEND_LOG_SIZE = 10 * 1024 * 1024 // 10 MB

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })

    // Rotate if the file exceeds the size limit
    if (fs.existsSync(frontendLogPath)) {
      const stat = fs.statSync(frontendLogPath)
      if (stat.size >= MAX_FRONTEND_LOG_SIZE) {
        const rotatedPath = path.join(LOG_DIR, `frontend.log.${Date.now()}.bak`)
        fs.renameSync(frontendLogPath, rotatedPath)
        logger.info('📋 [LOGS] frontend.log rotated due to size limit', {
          sizeBytes: stat.size,
          rotatedTo: rotatedPath,
        })
      }
    }

    const timestamp = new Date().toISOString()
    const header = `\n\n===== Frontend log upload at ${timestamp} =====\n`
    fs.appendFileSync(frontendLogPath, header + logs + '\n', 'utf8')
    logger.info('📋 [LOGS] Frontend logs ingested and appended', {
      timestamp,
      remoteIp: req.ip,
      sizeBytes: logs.length,
    })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to save frontend logs', { err })
    res.status(500).json({ error: 'Failed to save frontend logs' })
  }
})

router.get('/logs/frontend', logDownloadLimiter, requireAuth, (req, res) => {
  const frontendLogPath = path.join(LOG_DIR, 'frontend.log')

  if (!fs.existsSync(frontendLogPath)) {
    res.status(404).json({ error: 'Frontend log file not found' })
    return
  }

  const stat = fs.statSync(frontendLogPath)
  logger.info('📥 [LOGS] Frontend log download requested', {
    sizeBytes: stat.size,
    remoteIp: req.ip,
  })

  res.setHeader('Content-Disposition', 'attachment; filename="frontend.log"')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Length', stat.size)

  const stream = fs.createReadStream(frontendLogPath)
  stream.on('error', (err) => {
    logger.error('Failed to stream frontend log file', { err })
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read frontend log file' })
    }
  })
  stream.pipe(res)
})

export default router
