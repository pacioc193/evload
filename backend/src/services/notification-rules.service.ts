import { EventEmitter } from 'events'
import { getConfig } from '../config'
import { logger } from '../logger'
import { sendTelegramNotification } from './telegram.service'

export const notificationEvents = new EventEmitter()

export function emitNotificationEvent(event: string, payload: Record<string, unknown>): void {
  notificationEvents.emit('notify', event, payload)
}

notificationEvents.on('notify', (event: string, payload: Record<string, unknown>) => {
  dispatchTelegramNotificationEvent(event, payload).catch((err) =>
    logger.error('notification bus dispatch error', { err, event })
  )
})

export type NotificationOperator =
  | 'exists'
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'changed'
  | 'increased_by'
  | 'decreased_by'
  | 'mod_step'

export interface NotificationCondition {
  field: string
  operator: NotificationOperator
  value?: string | number | boolean
}

export interface NotificationRule {
  id: string
  name: string
  enabled: boolean
  event: string
  template: string
  condition?: NotificationCondition
}

export interface NotificationDispatchResult {
  delivered: number
  matchedRules: string[]
  messages: string[]
}

export interface PlaceholderInfo {
  name: string
  description: string
}

export type NotificationPayloadFieldType = 'string' | 'number' | 'boolean'

export interface NotificationEventSchema {
  required: string[]
  fields: Record<string, NotificationPayloadFieldType>
}

export interface NotificationPayloadValidationResult {
  valid: boolean
  missingRequired: string[]
  invalidTypes: string[]
  unknownFields: string[]
}

const COMMON_PLACEHOLDERS: Record<string, PlaceholderInfo> = {
  event: { name: 'event', description: 'Nome dell\'evento emesso' },
  timestamp: { name: 'timestamp', description: 'Data e ora dell\'evento' },
  reason: { name: 'reason', description: 'Motivazione tecnica dell\'azione' },
}

const EVENT_PLACEHOLDER_CATALOG: Record<string, string[]> = {
  engine_started: ['event', 'timestamp', 'sessionId', 'targetSoc', 'targetAmps', 'reason'],
  engine_stopped: ['event', 'timestamp', 'sessionId', 'reason'],
  ha_paused: ['event', 'timestamp', 'homePowerW', 'maxHomePowerW', 'retrySec', 'reason'],
  ha_throttled: ['event', 'timestamp', 'homePowerW', 'maxHomePowerW', 'throttledAmps', 'reason'],
  balancing_started: ['event', 'timestamp', 'targetSoc', 'reason'],
  balancing_complete: ['event', 'timestamp', 'targetSoc', 'reason'],
  failsafe_activated: ['event', 'timestamp', 'reason'],
  soc_increased: ['event', 'timestamp', 'soc', 'deltaSoc', 'reason'],
  start_charging: ['event', 'timestamp', 'reason'],
  stop_charging: ['event', 'timestamp', 'reason'],
  plan_start: ['event', 'timestamp', 'planId', 'targetSoc', 'reason'],
  plan_updated: ['event', 'timestamp', 'planId', 'reason'],
  plan_completed: ['event', 'timestamp', 'planId', 'reason'],
  plan_skipped: ['event', 'timestamp', 'planId', 'reason'],
  target_soc_reached: ['event', 'timestamp', 'soc', 'reason'],
  charging_paused: ['event', 'timestamp', 'reason'],
  charging_resumed: ['event', 'timestamp', 'reason'],
  home_power_limit_exceeded: ['event', 'timestamp', 'homePowerW', 'limitW', 'reason'],
  home_power_limit_restored: ['event', 'timestamp', 'homePowerW', 'limitW', 'reason'],
  vehicle_connected: ['event', 'timestamp', 'vehicleId', 'reason'],
  vehicle_disconnected: ['event', 'timestamp', 'vehicleId', 'reason'],
  vehicle_in_garage: ['event', 'timestamp', 'vehicleId', 'reason'],
  vehicle_not_in_garage: ['event', 'timestamp', 'vehicleId', 'reason'],
  proxy_error: ['event', 'timestamp', 'vehicleId', 'reason'],
  failsafe_cleared: ['event', 'timestamp', 'reason'],
}

const EVENT_PAYLOAD_PRESETS: Record<string, Record<string, unknown>> = {
  engine_started: { sessionId: 123, targetSoc: 80, targetAmps: 16, vehicleId: 'DEMO1', reason: 'manual' },
  engine_stopped: { sessionId: 123, reason: 'finished' },
  ha_paused: { homePowerW: 5500, maxHomePowerW: 4000, retrySec: 60, reason: 'limit_exceeded' },
  ha_throttled: { homePowerW: 4200, maxHomePowerW: 4000, throttledAmps: 10, reason: 'balancing' },
  balancing_started: { targetSoc: 100, reason: 'top_off' },
  balancing_complete: { targetSoc: 100, reason: 'finished' },
  failsafe_activated: { reason: 'connection_lost' },
  soc_increased: { soc: 55, deltaSoc: 1, reason: 'charging' },
  start_charging: { reason: 'scheduler' },
  stop_charging: { reason: 'user' },
  plan_start: { planId: 'plan-001', targetSoc: 90, reason: 'scheduled_time' },
  plan_updated: { planId: 'plan-001', reason: 'user_edit' },
  plan_completed: { planId: 'plan-001', reason: 'target_reached' },
  plan_skipped: { planId: 'plan-001', reason: 'low_priority' },
  target_soc_reached: { soc: 80, reason: 'limit_reached' },
  charging_paused: { reason: 'ha_power' },
  charging_resumed: { reason: 'power_restored' },
  home_power_limit_exceeded: { homePowerW: 6000, limitW: 3000, reason: 'oven_on' },
  home_power_limit_restored: { homePowerW: 2000, limitW: 3000, reason: 'oven_off' },
  vehicle_connected: { vehicleId: 'VIN123456', reason: 'plugged_in' },
  vehicle_disconnected: { vehicleId: 'VIN123456', reason: 'unplugged' },
  vehicle_in_garage: { vehicleId: 'VIN123456', reason: 'detected' },
  vehicle_not_in_garage: { vehicleId: 'VIN123456', reason: 'detected_away' },
  proxy_error: { vehicleId: 'VIN123456', reason: 'connection_timeout' },
  failsafe_cleared: { reason: 'reconnected' },
}

const EVENT_PAYLOAD_SCHEMAS: Record<string, NotificationEventSchema> = {
  engine_started: {
    required: ['sessionId', 'targetSoc'],
    fields: { sessionId: 'number', targetSoc: 'number', targetAmps: 'number', reason: 'string' },
  },
  engine_stopped: {
    required: ['sessionId'],
    fields: { sessionId: 'number', reason: 'string' },
  },
  ha_paused: {
    required: ['homePowerW', 'maxHomePowerW', 'retrySec'],
    fields: { homePowerW: 'number', maxHomePowerW: 'number', retrySec: 'number', reason: 'string' },
  },
  ha_throttled: {
    required: ['homePowerW', 'maxHomePowerW', 'throttledAmps'],
    fields: { homePowerW: 'number', maxHomePowerW: 'number', throttledAmps: 'number', reason: 'string' },
  },
  balancing_started: {
    required: ['targetSoc'],
    fields: { targetSoc: 'number', reason: 'string' },
  },
  balancing_complete: {
    required: ['targetSoc'],
    fields: { targetSoc: 'number', reason: 'string' },
  },
  failsafe_activated: {
    required: ['reason'],
    fields: { reason: 'string' },
  },
  soc_increased: {
    required: ['soc', 'deltaSoc'],
    fields: { soc: 'number', deltaSoc: 'number', reason: 'string' },
  },
  start_charging: {
    required: ['reason'],
    fields: { reason: 'string' },
  },
  stop_charging: {
    required: ['reason'],
    fields: { reason: 'string' },
  },
  plan_start: {
    required: ['planId', 'targetSoc'],
    fields: { planId: 'string', targetSoc: 'number', reason: 'string' },
  },
  plan_updated: {
    required: ['planId'],
    fields: { planId: 'string', reason: 'string' },
  },
  plan_completed: {
    required: ['planId'],
    fields: { planId: 'string', reason: 'string' },
  },
  plan_skipped: {
    required: ['planId', 'reason'],
    fields: { planId: 'string', reason: 'string' },
  },
  target_soc_reached: {
    required: ['soc'],
    fields: { soc: 'number', reason: 'string' },
  },
  charging_paused: {
    required: ['reason'],
    fields: { reason: 'string' },
  },
  charging_resumed: {
    required: ['reason'],
    fields: { reason: 'string' },
  },
  home_power_limit_exceeded: {
    required: ['homePowerW', 'limitW'],
    fields: { homePowerW: 'number', limitW: 'number', reason: 'string' },
  },
  home_power_limit_restored: {
    required: ['homePowerW', 'limitW'],
    fields: { homePowerW: 'number', limitW: 'number', reason: 'string' },
  },
  vehicle_connected: {
    required: ['vehicleId'],
    fields: { vehicleId: 'string', reason: 'string' },
  },
  vehicle_disconnected: {
    required: ['vehicleId'],
    fields: { vehicleId: 'string', reason: 'string' },
  },
  vehicle_in_garage: {
    required: ['vehicleId'],
    fields: { vehicleId: 'string', reason: 'string' },
  },
  vehicle_not_in_garage: {
    required: ['vehicleId'],
    fields: { vehicleId: 'string', reason: 'string' },
  },
  proxy_error: {
    required: ['vehicleId', 'reason'],
    fields: { vehicleId: 'string', reason: 'string' },
  },
  failsafe_cleared: {
    required: ['reason'],
    fields: { reason: 'string' },
  },
}

const PLACEHOLDER_DESCRIPTIONS: Record<string, string> = {
  event: 'Nome dell\'evento',
  timestamp: 'Data e ora ISO',
  sessionId: 'ID sessione di ricarica',
  targetSoc: 'SoC bersaglio (%)',
  targetAmps: 'Corrente richiesta (A)',
  reason: 'Motivo dell\'evento',
  homePowerW: 'Potenza totale casa (W)',
  maxHomePowerW: 'Limite potenza casa (W)',
  limitW: 'Limite potenza (W)',
  retrySec: 'Secondi di attesa prima del riavvio',
  throttledAmps: 'Corrente limitata (A)',
  soc: 'Livello carica attuale (%)',
  deltaSoc: 'Incremento SoC (%)',
  planId: 'ID del piano programmato',
  vehicleId: 'Identificativo del veicolo',
  vehicleInGarage: 'Veicolo in garage?',
}

const lastEventPayloads: Record<string, Record<string, unknown>> = {}

export function getNotificationEventOptions(): string[] {
  return Object.keys(EVENT_PLACEHOLDER_CATALOG)
}

export function getNotificationPlaceholderCatalog(): {
  all: string[]
  byEvent: Record<string, string[]>
  descriptions: Record<string, string>
  presets: Record<string, Record<string, unknown>>
  schemas: Record<string, NotificationEventSchema>
} {
  const all = Array.from(new Set(Object.values(EVENT_PLACEHOLDER_CATALOG).flat())).sort((a, b) => a.localeCompare(b))
  return {
    all,
    byEvent: EVENT_PLACEHOLDER_CATALOG,
    descriptions: PLACEHOLDER_DESCRIPTIONS,
    presets: EVENT_PAYLOAD_PRESETS,
    schemas: EVENT_PAYLOAD_SCHEMAS,
  }
}

export function getNotificationEventSchemas(): Record<string, NotificationEventSchema> {
  return EVENT_PAYLOAD_SCHEMAS
}

export function validateNotificationPayload(
  event: string,
  payload: Record<string, unknown>
): NotificationPayloadValidationResult {
  const schema = EVENT_PAYLOAD_SCHEMAS[event]
  if (!schema) {
    return {
      valid: false,
      missingRequired: [],
      invalidTypes: [],
      unknownFields: [],
    }
  }

  const missingRequired = schema.required.filter((field) => payload[field] === undefined || payload[field] === null)

  const invalidTypes = Object.entries(schema.fields)
    .filter(([field, expected]) => {
      const value = payload[field]
      if (value === undefined || value === null) return false
      return typeof value !== expected
    })
    .map(([field, expected]) => `${field}:${expected}`)

  const allowedFields = new Set(Object.keys(schema.fields))
  const unknownFields = Object.keys(payload).filter((field) => !allowedFields.has(field))

  return {
    valid: missingRequired.length === 0 && invalidTypes.length === 0 && unknownFields.length === 0,
    missingRequired,
    invalidTypes,
    unknownFields,
  }
}

export function extractMissingTemplatePlaceholders(
  template: string,
  payload: Record<string, unknown>
): string[] {
  const found = new Set<string>()
  template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_full, key: string) => {
    const value = getFieldValue(payload, key)
    if (value === undefined || value === null) {
      found.add(key)
    }
    return ''
  })
  return Array.from(found)
}

function normalizeComparable(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return null
}

export function getFieldValue(payload: Record<string, unknown>, field: string): unknown {
  const path = field.split('.').filter(Boolean)
  let current: unknown = payload
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function evaluateCondition(
  condition: NotificationCondition | undefined,
  payload: Record<string, unknown>,
  lastPayload?: Record<string, unknown>
): boolean {
  if (!condition) return true

  const current = getFieldValue(payload, condition.field)
  const previous = lastPayload ? getFieldValue(lastPayload, condition.field) : undefined

  switch (condition.operator) {
    case 'exists':
      return current !== undefined && current !== null
    case 'equals':
      return normalizeComparable(current) === condition.value
    case 'not_equals':
      return normalizeComparable(current) !== condition.value
    case 'contains': {
      if (typeof current !== 'string') return false
      const expected = String(condition.value ?? '')
      return current.toLowerCase().includes(expected.toLowerCase())
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = Number(current)
      const right = Number(condition.value)
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      if (condition.operator === 'gt') return left > right
      if (condition.operator === 'gte') return left >= right
      if (condition.operator === 'lt') return left < right
      return left <= right
    }
    case 'changed':
      return (
        current !== undefined &&
        previous !== undefined &&
        normalizeComparable(current) !== normalizeComparable(previous)
      )
    case 'increased_by': {
      const curVal = Number(current)
      const preVal = Number(previous)
      const delta = Number(condition.value)
      if (!Number.isFinite(curVal) || !Number.isFinite(preVal) || !Number.isFinite(delta)) return false
      return curVal >= preVal + delta
    }
    case 'decreased_by': {
      const curVal = Number(current)
      const preVal = Number(previous)
      const delta = Number(condition.value)
      if (!Number.isFinite(curVal) || !Number.isFinite(preVal) || !Number.isFinite(delta)) return false
      return curVal <= preVal - delta
    }
    case 'mod_step': {
      const curVal = Number(current)
      const preVal = Number(previous)
      const step = Number(condition.value)
      if (!Number.isFinite(curVal) || !Number.isFinite(preVal) || !Number.isFinite(step) || step === 0) return false
      return Math.floor(curVal / step) > Math.floor(preVal / step)
    }
    default:
      return false
  }
}

export function renderNotificationTemplate(
  template: string,
  payload: Record<string, unknown>
): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_full, key: string) => {
    const value = getFieldValue(payload, key)
    if (value === undefined || value === null) return ''
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        return ''
      }
    }
    return String(value)
  })
}

function getRules(): NotificationRule[] {
  const rules = getConfig().telegram.notifications.rules
  return rules.filter((rule) => rule.enabled)
}

export async function dispatchTelegramNotificationEvent(
  event: string,
  payload: Record<string, unknown>
): Promise<NotificationDispatchResult> {
  const basePayload: Record<string, unknown> = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  }

  const lastPayload = lastEventPayloads[event]
  const rules = getRules().filter(
    (rule) => rule.event === event && evaluateCondition(rule.condition, basePayload, lastPayload)
  )
  const messages = rules.map((rule) => renderNotificationTemplate(rule.template, basePayload))
  lastEventPayloads[event] = { ...basePayload }

  let delivered = 0
  for (const message of messages) {
    if (!message.trim()) continue
    try {
      const sent = await sendTelegramNotification(message)
      if (sent) delivered += 1
    } catch (err) {
      logger.error('Failed to deliver telegram notification from rule engine', { err, event })
    }
  }

  return {
    delivered,
    matchedRules: rules.map((rule) => rule.id),
    messages,
  }
}

export async function sendTelegramNotificationTest(
  event: string,
  payload: Record<string, unknown>,
  template: string
): Promise<{ rendered: string; delivered: boolean }> {
  const basePayload = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  }
  const rendered = renderNotificationTemplate(template, basePayload)
  const delivered = await sendTelegramNotification(rendered)
  return { rendered, delivered }
}
