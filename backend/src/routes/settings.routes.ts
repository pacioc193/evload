import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { requireAuth } from '../middleware/auth.middleware'
import { getConfig, reloadConfig } from '../config'
import { logger } from '../logger'
import {
  extractMissingTemplatePlaceholders,
  getNotificationEventOptions,
  getNotificationPlaceholderCatalog,
  sendTelegramNotificationTest,
  validateNotificationPayload,
} from '../services/notification-rules.service'
import { getTelegramPrerequisiteStatus, initTelegram } from '../services/telegram.service'

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(process.cwd(), 'config.yaml')
const ENV_PATH = path.join(process.cwd(), '.env')
const EXAMPLE_PATH = path.join(__dirname, '../../config.example.yaml')

const router = Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

router.get('/', limiter, requireAuth, (_req, res) => {
  const cfg = getConfig()
  const currentToken = process.env.TELEGRAM_BOT_TOKEN
  res.json({
    demo: cfg.demo,
    haUrl: cfg.homeAssistant.url,
    haPowerEntityId: cfg.homeAssistant.powerEntityId,
    haGridEntityId: cfg.homeAssistant.gridEntityId,
    haMaxHomePowerW: cfg.homeAssistant.maxHomePowerW,
    proxyUrl: cfg.proxy.url,
    vehicleId: cfg.proxy.vehicleId,
    batteryCapacityKwh: cfg.charging.batteryCapacityKwh,
    defaultAmps: cfg.charging.defaultAmps,
    maxAmps: cfg.charging.maxAmps,
    minAmps: cfg.charging.minAmps,
    rampIntervalSec: cfg.charging.rampIntervalSec,
    telegramEnabled: cfg.telegram.enabled,
    telegramBotToken: currentToken ? '********' : '',
    telegramAllowedChatIds: cfg.telegram.allowedChatIds,
    telegramRules: cfg.telegram.notifications.rules,
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
    rampIntervalSec: number
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
  if (incoming.rampIntervalSec !== undefined) charging['rampIntervalSec'] = incoming.rampIntervalSec

  const activeCfg = getConfig()
  const nextDefaultAmps = Number(charging['defaultAmps'] ?? activeCfg.charging.defaultAmps)
  const nextMaxAmps = Number(charging['maxAmps'] ?? activeCfg.charging.maxAmps)
  const nextMinAmps = Number(charging['minAmps'] ?? activeCfg.charging.minAmps)
  if (!(nextMinAmps <= nextDefaultAmps && nextDefaultAmps <= nextMaxAmps)) {
    res.status(400).json({ error: 'Invalid charging amperage configuration: expected minAmps <= defaultAmps <= maxAmps' })
    return
  }

  parsed['charging'] = charging

  const telegram = (parsed['telegram'] as Record<string, unknown>) ?? {}
  if (incoming.telegramEnabled !== undefined) telegram['enabled'] = incoming.telegramEnabled

  if (incoming.telegramBotToken !== undefined && !incoming.telegramBotToken.includes('***')) {
    const newToken = incoming.telegramBotToken.trim()
    if (newToken) {
      try {
        let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : ''
        if (envContent.includes('TELEGRAM_BOT_TOKEN=')) {
          envContent = envContent.replace(/TELEGRAM_BOT_TOKEN=.*/, `TELEGRAM_BOT_TOKEN=${newToken}`)
        } else {
          envContent += `\nTELEGRAM_BOT_TOKEN=${newToken}\n`
        }
        fs.writeFileSync(ENV_PATH, envContent.trim() + '\n', 'utf8')
        process.env.TELEGRAM_BOT_TOKEN = newToken
        logger.info('Telegram Bot Token saved to .env')
      } catch (err) {
        logger.error('Failed to update .env for telegram token', { err })
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
    reloadConfig()
    initTelegram()
  } catch (err) {
    logger.warn('Config reload failed after settings update', { err })
  }

  res.json({ success: true })
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
    event,
    timestamp: new Date().toISOString(),
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

export default router
