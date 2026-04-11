import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  patchSettings,
  getSettings,
  getTelegramPlaceholders,
  sendTelegramTestNotification,
  triggerTestEvent,
  type AppSettings,
  type NotificationEventSchema,
  type TelegramNotificationCondition,
  type TelegramPlaceholdersResponse,
  type TelegramNotificationRule,
} from '../api/index'
import { Bell, ChevronDown, ChevronUp, FolderOpen, HelpCircle, Plus, Save, Send, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'

const NOTIFICATIONS_OPEN_SECTIONS_STORAGE_KEY = 'evload.notifications.openSections'

function readOpenSections(): { eventWidget: boolean; rulesBuilder: boolean; testCenter: boolean } {
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_OPEN_SECTIONS_STORAGE_KEY)
    if (!raw) {
      return {
        eventWidget: true,
        rulesBuilder: false,
        testCenter: false,
      }
    }
    const parsed = JSON.parse(raw) as Partial<{ eventWidget: boolean; rulesBuilder: boolean; testCenter: boolean }>
    return {
      eventWidget: typeof parsed.eventWidget === 'boolean' ? parsed.eventWidget : true,
      rulesBuilder: typeof parsed.rulesBuilder === 'boolean' ? parsed.rulesBuilder : false,
      testCenter: typeof parsed.testCenter === 'boolean' ? parsed.testCenter : false,
    }
  } catch {
    return {
      eventWidget: true,
      rulesBuilder: false,
      testCenter: false,
    }
  }
}

const Zap = ({ size, className }: { size?: number, className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size || 24}
    height={size || 24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

function PlaceholderModal({
  isOpen,
  onClose,
  allPlaceholders,
  descriptions,
  placeholdersByEvent,
  currentEvent,
}: {
  isOpen: boolean
  onClose: () => void
  allPlaceholders: string[]
  descriptions: Record<string, string>
  placeholdersByEvent: Record<string, string[]>
  currentEvent?: string
}) {
  if (!isOpen) return null

  const relevant = currentEvent ? placeholdersByEvent[currentEvent] || [] : allPlaceholders

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-evload-surface border border-evload-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-evload-border bg-evload-bg/50">
          <div className="flex items-center gap-2">
            <HelpCircle size={18} className="text-evload-accent" />
            <h2 className="font-bold">Available Placeholders</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-evload-border rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-4">
          {currentEvent && (
            <div className="text-xs bg-evload-accent/10 border border-evload-accent/20 text-evload-accent rounded-lg p-3">
              Showing placeholders for event: <strong>{currentEvent}</strong>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            {relevant.map((ph) => (
              <div key={ph} className="flex flex-col p-2 bg-evload-bg/50 border border-evload-border rounded-lg group hover:border-evload-accent transition-colors">
                <code className="text-evload-accent text-sm font-bold">{"{{"}{ph}{"}}"}</code>
                <span className="text-xs text-evload-muted mt-1">{descriptions[ph] || "No description available"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-3 bg-evload-bg/50 border-t border-evload-border text-center">
          <button onClick={onClose} className="px-6 py-2 bg-evload-border hover:bg-evload-bg rounded-lg text-sm font-medium transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const TELEGRAM_OPERATOR_OPTIONS: TelegramNotificationCondition['operator'][] = [
  'exists',
  'equals',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'changed',
  'increased_by',
  'decreased_by',
  'mod_step',
]

const TEST_PAYLOAD_PRESETS_STORAGE_KEY = 'evload.telegram.testPayloadPresets'

interface TestPayloadPreset {
  id: string
  name: string
  event: string
  template: string
  payload: string
}

const EVENT_EXAMPLE_TEMPLATES: Record<string, string> = {
  engine_started: '🔌 Ricarica avviata\n📅 {{timestamp_date}}\n🎯 Obiettivo: {{targetSoc}}%\n⚡ Corrente: {{targetAmps}}A\n🚗 Veicolo: {{vehicleId}}',
  engine_stopped: '🏁 Sessione terminata\n📅 {{timestamp_date}}\n🔖 Sessione: {{sessionId}}\n📋 Motivo: {{reason}}',
  charge_start_blocked: '⚠️ Avvio ricarica bloccato\n📅 {{timestamp_date}}\n❌ Motivo: {{reason}}\n🔌 Stato: {{chargingState}}\n🔋 SoC: {{soc}}%',
  ha_throttled: '⚡ Corrente ridotta (limite casa)\n📅 {{timestamp_date}}\n🏠 Casa: {{homePowerW}}W / Max: {{maxHomePowerW}}W\n🔌 Corrente limitata: {{throttledAmps}}A',
  failsafe_activated: '🚨 Failsafe attivato\n📅 {{timestamp_date}}\n❗ Motivo: {{reason}}',
  failsafe_cleared: '✅ Failsafe disattivato\n📅 {{timestamp_date}}\n✔️ Motivo: {{reason}}',
  soc_increased: '🔋 Aggiornamento carica\n📅 {{timestamp_date}}\n⚡ SoC: {{soc}}% (+{{deltaSoc}}%)',
  start_charging: '⚡ Ricarica avviata\n📅 {{timestamp_date}}\n📋 Motivo: {{reason}}',
  stop_charging: '🛑 Ricarica fermata\n📅 {{timestamp_date}}\n📋 Motivo: {{reason}}',
  plan_start: '🗓️ Piano di ricarica avviato\n📅 {{timestamp_date}}\n📌 Piano: {{planId}}\n🎯 Obiettivo: {{targetSoc}}%',
  plan_completed: '✅ Piano completato\n📅 {{timestamp_date}}\n📌 Piano: {{planId}}\n📋 Motivo: {{reason}}',
  plan_skipped: '⏭️ Piano saltato\n📅 {{timestamp_date}}\n📌 Piano: {{planId}}\n📋 Motivo: {{reason}}',
  plan_wake: '⏰ Sveglia pre-ricarica\n📅 {{timestamp_date}}\n📌 Piano: {{planId}}\n⏱️ Avvio tra: {{wakeBeforeMinutes}} min',
  target_soc_reached: '🏆 Obiettivo SoC raggiunto\n📅 {{timestamp_date}}\n🔋 SoC: {{soc}}% / Obiettivo: {{targetSoc}}%',
  ha_paused: '⏸️ Ricarica in pausa (limite casa)\n📅 {{timestamp_date}}\n🏠 Casa: {{homePowerW}}W / Max: {{maxHomePowerW}}W\n⏱️ Riprova tra: {{retrySec}}s',
  charging_paused: '⏸️ Ricarica in pausa\n📅 {{timestamp_date}}\n📋 Motivo: {{reason}}',
  charging_resumed: '▶️ Ricarica ripresa\n📅 {{timestamp_date}}\n📋 Motivo: {{reason}}',
  home_power_limit_exceeded: '🔴 Limite potenza casa superato\n📅 {{timestamp_date}}\n🏠 Casa: {{homePowerW}}W / Limite: {{limitW}}W',
  home_power_limit_restored: '🟢 Potenza casa rientrata nel limite\n📅 {{timestamp_date}}\n🏠 Casa: {{homePowerW}}W / Limite: {{limitW}}W',
  vehicle_connected: '🚗 Veicolo connesso\n📅 {{timestamp_date}}\n🚘 ID: {{vehicleId}}',
  vehicle_disconnected: '🔌 Veicolo disconnesso\n📅 {{timestamp_date}}\n🚘 ID: {{vehicleId}}',
  vehicle_in_garage: '🏠 Veicolo in garage\n📅 {{timestamp_date}}\n🚘 ID: {{vehicleId}}',
  vehicle_not_in_garage: '🚙 Veicolo non in garage\n📅 {{timestamp_date}}\n🚘 ID: {{vehicleId}}',
  proxy_error: '❌ Errore proxy veicolo\n📅 {{timestamp_date}}\n🚘 Veicolo: {{vehicleId}}\n❗ Motivo: {{reason}}',
}

function CollapsibleHeader({
  title,
  subtitle,
  open,
  onToggle,
}: {
  title: string
  subtitle?: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border border-evload-border bg-evload-bg/30"
    >
      <div>
        <div className="font-medium text-sm">{title}</div>
        {subtitle && <div className="text-xs text-evload-muted">{subtitle}</div>}
      </div>
      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  )
}

export default function NotificationsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [eventOptions, setEventOptions] = useState<string[]>([])
  const [allPlaceholders, setAllPlaceholders] = useState<string[]>([])
  const [placeholdersByEvent, setPlaceholdersByEvent] = useState<Record<string, string[]>>({})
  const [placeholderDescriptions, setPlaceholderDescriptions] = useState<Record<string, string>>({})
  const [payloadPresets, setPayloadPresets] = useState<Record<string, Record<string, unknown>>>({})
  const [eventSchemas, setEventSchemas] = useState<Record<string, NotificationEventSchema>>({})
  const [messageSourceLabel, setMessageSourceLabel] = useState('')
  const [newEvent, setNewEvent] = useState('')
  const [isPhModalOpen, setIsPhModalOpen] = useState(false)
  const [phModalContext, setPhModalContext] = useState<string | undefined>()

  const [testEvent, setTestEvent] = useState('')
  const [testTemplate, setTestTemplate] = useState('')
  const [testPayload, setTestPayload] = useState('')
  const [testResult, setTestResult] = useState('')
  const [testPresetName, setTestPresetName] = useState('')
  const [testPayloadPresets, setTestPayloadPresets] = useState<TestPayloadPreset[]>([])
  const [selectedTestPresetId, setSelectedTestPresetId] = useState('')
  const [pendingAddEvent, setPendingAddEvent] = useState('')

  const [openSections, setOpenSections] = useState(() => readOpenSections())

  const [openEvents, setOpenEvents] = useState<Record<string, boolean>>(
    {}
  )

  useEffect(() => {
    Promise.all([getSettings(), getTelegramPlaceholders().catch(() => null)])
      .then(([nextSettings, placeholders]) => {
        setSettings(nextSettings)

        const placeholderData = placeholders as TelegramPlaceholdersResponse | null
        if (!placeholderData) return

        const nextEvents = placeholderData.events
        setEventOptions(nextEvents)
        setMessageSourceLabel(placeholderData.messageSource || '')
        setAllPlaceholders(placeholderData.placeholders.all)
        setPlaceholdersByEvent(placeholderData.placeholders.byEvent)
        setPlaceholderDescriptions(placeholderData.placeholders.descriptions || {})
        const presets = placeholderData.placeholders.presets || {}
        setPayloadPresets(presets)
        setEventSchemas(placeholderData.placeholders.schemas || {})

        const defaultEv = nextEvents[0] || ''
        setNewEvent((prev) => prev || defaultEv)
        setTestEvent((prev) => {
          const finalEv = prev || defaultEv
          if (finalEv && presets[finalEv]) {
            setTestPayload(JSON.stringify(presets[finalEv], null, 2))
          }
          return finalEv
        })

        setOpenEvents((prev) => {
          const next: Record<string, boolean> = {}
          nextEvents.forEach((event) => {
            next[event] = prev[event] ?? false
          })
          return next
        })
      })
      .catch(console.error)

    try {
      const raw = window.localStorage.getItem(TEST_PAYLOAD_PRESETS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as TestPayloadPreset[]
      if (Array.isArray(parsed)) {
        setTestPayloadPresets(parsed)
      }
    } catch {
      // ignore invalid storage
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(TEST_PAYLOAD_PRESETS_STORAGE_KEY, JSON.stringify(testPayloadPresets))
  }, [testPayloadPresets])

  useEffect(() => {
    window.localStorage.setItem(NOTIFICATIONS_OPEN_SECTIONS_STORAGE_KEY, JSON.stringify(openSections))
  }, [openSections])

  const saveNotifications = async () => {
    if (!settings) return
    setSaving(true)
    setMessage('')
    try {
      await patchSettings({
        telegramEnabled: settings.telegramEnabled,
        telegramBotToken: settings.telegramBotToken,
        telegramAllowedChatIds: settings.telegramAllowedChatIds,
        telegramRules: settings.telegramRules,
      })
      const fresh = await getSettings()
      setSettings(fresh)
      setMessage('Notifications saved')
    } catch {
      setMessage('Failed to save notifications')
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(''), 3500)
    }
  }

  const makeDefaultRule = (): TelegramNotificationRule => ({
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'New rule',
    enabled: true,
    event: eventOptions[0] ?? 'manual_event',
    template: '',
  })

  const updateRule = (ruleId: string, updater: (rule: TelegramNotificationRule) => TelegramNotificationRule) => {
    setSettings((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        telegramRules: prev.telegramRules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)),
      }
    })
  }

  const deleteRule = (ruleId: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        telegramRules: prev.telegramRules.filter((rule) => rule.id !== ruleId),
      }
    })
  }

  const loadExampleRules = () => {
    if ((settings?.telegramRules.length || 0) > 0) {
      const confirmed = window.confirm('Load examples will replace current rules. Continue?')
      if (!confirmed) return
    }
    const examples: TelegramNotificationRule[] = [
      {
        id: `example-1`,
        name: 'Ricarica avviata',
        enabled: true,
        event: 'engine_started',
        template: '🔌 Ricarica avviata\n📅 {{timestamp_date}}\n🎯 Obiettivo: {{targetSoc}}%\n⚡ Corrente: {{targetAmps}}A\n🚗 Veicolo: {{vehicleId}}',
      },
      {
        id: `example-2`,
        name: 'Potenza casa superata',
        enabled: true,
        event: 'home_power_limit_exceeded',
        template: '🔴 Limite potenza casa superato\n📅 {{timestamp_date}}\n🏠 Casa: {{homePowerW}}W / Limite: {{limitW}}W',
      },
      {
        id: `example-3`,
        name: 'Avanzamento ricarica (ogni 10%)',
        enabled: true,
        event: 'soc_increased',
        template: '🔋 Aggiornamento carica\n📅 {{timestamp_date}}\n⚡ SoC: {{soc}}% (+{{deltaSoc}}%)',
        condition: {
          field: 'soc',
          operator: 'mod_step',
          value: 10,
        },
      },
      {
        id: `example-4`,
        name: 'SoC obiettivo raggiunto',
        enabled: true,
        event: 'target_soc_reached',
        template: '🏆 Obiettivo SoC raggiunto\n📅 {{timestamp_date}}\n🔋 SoC: {{soc}}% / Obiettivo: {{targetSoc}}%',
      },
      {
        id: `example-5`,
        name: 'Avvio ricarica bloccato',
        enabled: true,
        event: 'charge_start_blocked',
        template: '⚠️ Avvio ricarica bloccato\n📅 {{timestamp_date}}\n❌ Motivo: {{reason}}\n🔌 Stato: {{chargingState}}\n🔋 SoC: {{soc}}%',
      },
      {
        id: `example-6`,
        name: 'Piano avviato',
        enabled: true,
        event: 'plan_start',
        template: '🗓️ Piano di ricarica avviato\n📅 {{timestamp_date}}\n📌 Piano: {{planId}}\n🎯 Obiettivo: {{targetSoc}}%',
      },
      {
        id: `example-7`,
        name: 'Sveglia pre-piano',
        enabled: true,
        event: 'plan_wake',
        template: '⏰ Sveglia pre-ricarica\n📅 {{timestamp_date}}\n📌 Piano: {{planId}}\n⏱️ Avvio tra: {{wakeBeforeMinutes}} min',
      },
    ]
    setSettings((prev) => prev ? { ...prev, telegramRules: examples } : prev)
    setTestResult('Loaded 7 example rules (Advanced conditions included)')
  }

  const generateFromScratch = () => {
    if ((settings?.telegramRules.length || 0) > 0) {
      const confirmed = window.confirm('Generate from scratch will clear all current rules. Continue?')
      if (!confirmed) return
    }
    setSettings((prev) => prev ? { ...prev, telegramRules: [] } : prev)
    setTestResult('Cleared all rules (from scratch). Remember to save.')
  }

  const addEventMessageFromScratch = (eventName: string) => {
    if (!eventName) return
    upsertPrimaryRuleForEvent(eventName, (prev) => ({
      ...prev,
      event: eventName,
      name: prev.name || `Message ${eventName}`,
      template: prev.template || '',
      enabled: prev.enabled ?? true,
      condition: undefined,
    }))
    setOpenEvents((prev) => ({ ...prev, [eventName]: true }))
    setPendingAddEvent('')
  }

  const addEventMessageFromTemplate = (eventName: string) => {
    if (!eventName) return
    const template = EVENT_EXAMPLE_TEMPLATES[eventName] || `Event ${eventName}: {{event}} at {{timestamp}}`
    upsertPrimaryRuleForEvent(eventName, (prev) => ({
      ...prev,
      event: eventName,
      name: prev.name || `Message ${eventName}`,
      template,
      enabled: prev.enabled ?? true,
      condition: undefined,
    }))
    setOpenEvents((prev) => ({ ...prev, [eventName]: true }))
    setPendingAddEvent('')
  }

  const getPrimaryRuleForEvent = (event: string): TelegramNotificationRule | undefined => {
    if (!settings) return undefined
    return settings.telegramRules.find((rule) => rule.event === event)
  }

  const upsertPrimaryRuleForEvent = (
    event: string,
    updater: (rule: TelegramNotificationRule) => TelegramNotificationRule
  ) => {
    setSettings((prev) => {
      if (!prev) return prev
      const existingIdx = prev.telegramRules.findIndex((rule) => rule.event === event)
      const seedRule: TelegramNotificationRule = {
        id: `event-${event}`,
        name: `Message ${event}`,
        enabled: true,
        event,
        template: '',
      }

      if (existingIdx === -1) {
        return {
          ...prev,
          telegramRules: [...prev.telegramRules, updater(seedRule)],
        }
      }

      const next = [...prev.telegramRules]
      next[existingIdx] = updater(next[existingIdx])
      return {
        ...prev,
        telegramRules: next,
      }
    })
  }

  const getPlaceholdersForEvent = (eventName: string): string[] => {
    const fromBackend = placeholdersByEvent[eventName]
    if (Array.isArray(fromBackend) && fromBackend.length > 0) return fromBackend
    return []
  }

  const validateTestPayloadForEvent = (eventName: string, payload: Record<string, unknown>): string[] => {
    const schema = eventSchemas[eventName]
    if (!schema) return [`No schema available for event "${eventName}"`]

    const errors: string[] = []
    for (const requiredField of schema.required) {
      if (payload[requiredField] === undefined || payload[requiredField] === null) {
        errors.push(`Missing required field: ${requiredField}`)
      }
    }

    for (const [field, expectedType] of Object.entries(schema.fields)) {
      const value = payload[field]
      if (value === undefined || value === null) continue
      if (typeof value !== expectedType) {
        errors.push(`Invalid type for ${field}: expected ${expectedType}, got ${typeof value}`)
      }
    }

    const known = new Set(Object.keys(schema.fields))
    const unknown = Object.keys(payload).filter((field) => !known.has(field))
    if (unknown.length > 0) {
      errors.push(`Unknown fields for ${eventName}: ${unknown.join(', ')}`)
    }

    return errors
  }

  const handleSendTelegramTest = async () => {
    if (!testTemplate.trim()) {
      setTestResult('Test template is required')
      return
    }

    try {
      const payload = testPayload.trim() ? (JSON.parse(testPayload) as Record<string, unknown>) : {}
      const schemaErrors = validateTestPayloadForEvent(testEvent, payload)
      if (schemaErrors.length > 0) {
        setTestResult(`Schema validation failed:\n- ${schemaErrors.join('\n- ')}`)
        return
      }
      const result = await sendTelegramTestNotification({
        event: testEvent,
        template: testTemplate,
        payload,
      })
      const missingWarning = (result.missingPlaceholders || []).length > 0
        ? `\nMissing placeholders in payload: ${(result.missingPlaceholders || []).join(', ')}`
        : '\nMissing placeholders in payload: none'
      setTestResult(
        `Rendered: ${result.rendered}\nDelivered: ${result.delivered ? 'yes' : 'no'}${missingWarning}`
      )
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as {
          error?: string
          prerequisites?: { missing?: string[] }
          schema?: { missingRequired?: string[]; invalidTypes?: string[]; unknownFields?: string[] }
        }
        if (data?.error === 'telegram prerequisites not satisfied') {
          setTestResult(`Prerequisites missing: ${(data.prerequisites?.missing || []).join(', ')}`)
          return
        }
        if (data?.error === 'payload does not match selected event schema') {
          const details = [
            ...(data.schema?.missingRequired || []).map((f) => `Missing required field: ${f}`),
            ...(data.schema?.invalidTypes || []).map((f) => `Invalid type: ${f}`),
            ...(data.schema?.unknownFields || []).map((f) => `Unknown field: ${f}`),
          ]
          setTestResult(`Schema validation failed:\n- ${details.join('\n- ')}`)
          return
        }
        // Fallback: show the raw backend error message if present
        if (data?.error) {
          setTestResult(`Test failed: ${data.error}`)
          return
        }
      }
      setTestResult('Test failed: invalid payload JSON or backend error')
    }
  }

  const saveCurrentTestPreset = () => {
    const name = testPresetName.trim()
    if (!name) {
      setTestResult('Preset name is required')
      return
    }
    const preset: TestPayloadPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      event: testEvent,
      template: testTemplate,
      payload: testPayload,
    }
    setTestPayloadPresets((prev) => [preset, ...prev].slice(0, 25))
    setSelectedTestPresetId(preset.id)
    setTestPresetName('')
    setTestResult(`Preset "${name}" saved locally`)
  }

  const loadSelectedTestPreset = () => {
    if (!selectedTestPresetId) return
    const preset = testPayloadPresets.find((item) => item.id === selectedTestPresetId)
    if (!preset) return
    setTestEvent(preset.event)
    setTestTemplate(preset.template)
    setTestPayload(preset.payload)
    setTestResult(`Preset "${preset.name}" loaded`)
  }

  const handleTriggerRealEvent = async () => {
    try {
      const payload = testPayload.trim() ? (JSON.parse(testPayload) as Record<string, unknown>) : {}
      const schemaErrors = validateTestPayloadForEvent(testEvent, payload)
      if (schemaErrors.length > 0) {
        setTestResult(`Schema validation failed:\n- ${schemaErrors.join('\n- ')}`)
        return
      }
      const result = await triggerTestEvent(testEvent, payload)
      setTestResult(
        `Event "${testEvent}" dispatched to Bus.\n` +
        `Matched Rules: ${result.matchedRules.length}\n` +
        `Delivered: ${result.delivered}\n` +
        `Messages:\n${result.messages.map((m, i) => `${i + 1}: ${m}`).join('\n')}`
      )
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as {
          error?: string
          schema?: { missingRequired?: string[]; invalidTypes?: string[]; unknownFields?: string[] }
        }
        if (data?.error === 'payload does not match selected event schema') {
          const details = [
            ...(data.schema?.missingRequired || []).map((f) => `Missing required field: ${f}`),
            ...(data.schema?.invalidTypes || []).map((f) => `Invalid type: ${f}`),
            ...(data.schema?.unknownFields || []).map((f) => `Unknown field: ${f}`),
          ]
          setTestResult(`Schema validation failed:\n- ${details.join('\n- ')}`)
          return
        }
        if (data?.error) {
          setTestResult(`Trigger failed: ${data.error}`)
          return
        }
      }
      setTestResult('Trigger failed: invalid payload JSON or backend error')
    }
  }

  const deleteSelectedTestPreset = () => {
    if (!selectedTestPresetId) return
    setTestPayloadPresets((prev) => prev.filter((p) => p.id !== selectedTestPresetId))
    setSelectedTestPresetId('')
    setTestResult('Preset deleted')
  }

  if (!settings) {
    return <div className="text-evload-muted">Loading notifications...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bell size={22} />Notifications Panel</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => {
              setPhModalContext(undefined);
              setIsPhModalOpen(true);
            }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-evload-bg/50 border border-evload-border hover:bg-evload-border rounded-lg text-sm font-medium transition-colors"
          >
            <HelpCircle size={15} /> Placeholders
          </button>
          <button
            onClick={saveNotifications}
            disabled={saving}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Save size={15} />{saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <PlaceholderModal
        isOpen={isPhModalOpen}
        onClose={() => setIsPhModalOpen(false)}
        allPlaceholders={allPlaceholders}
        descriptions={placeholderDescriptions}
        placeholdersByEvent={placeholdersByEvent}
        currentEvent={phModalContext}
      />

      <div className="bg-evload-surface border border-evload-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between py-2 border border-evload-border rounded-lg px-3">
          <div>
            <div className="font-medium text-sm">Telegram Notifications</div>
            <div className="text-xs text-evload-muted">Global enable/disable for Telegram delivery</div>
          </div>
          <button
            onClick={() => setSettings((prev) => prev ? { ...prev, telegramEnabled: !prev.telegramEnabled } : prev)}
            className="text-evload-accent hover:text-red-400 transition-colors"
          >
            {settings.telegramEnabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} className="text-evload-muted" />}
          </button>
        </div>
        <div>
          <label className="text-sm text-evload-muted mb-1 flex items-center gap-2">
            Telegram Bot Token
            <span className="text-[10px] bg-evload-bg border border-evload-border px-1.5 py-0.5 rounded text-evload-muted italic">Write-Only</span>
          </label>
          <input
            type="password"
            value={settings.telegramBotToken || ''}
            placeholder={settings.telegramBotToken ? '********' : 'Enter Bot Token...'}
            onChange={(e) => setSettings((prev) => prev ? { ...prev, telegramBotToken: e.target.value } : prev)}
            className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent placeholder:text-evload-muted/50"
          />
        </div>
        <div>
          <label className="block text-sm text-evload-muted mb-1">Allowed Chat IDs (comma separated)</label>
          <input
            value={(settings.telegramAllowedChatIds ?? []).join(', ')}
            onChange={(e) => {
              const parsed = e.target.value.split(',').map((v) => v.trim()).filter(Boolean)
              setSettings((prev) => prev ? { ...prev, telegramAllowedChatIds: parsed } : prev)
            }}
            className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
          />
        </div>
        {message && (
          <p className={clsx('text-sm', message.toLowerCase().includes('failed') ? 'text-evload-error' : 'text-evload-success')}>{message}</p>
        )}
      </div>

      <div className="bg-evload-surface border border-evload-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <CollapsibleHeader
            title="Event Message Widget"
            subtitle="Configured event messages only"
            open={openSections.eventWidget}
            onToggle={() => setOpenSections((prev) => ({ ...prev, eventWidget: !prev.eventWidget }))}
          />
        </div>
        {openSections.eventWidget && (
          <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
              <button
                onClick={loadExampleRules}
                className="flex items-center justify-center gap-1.5 px-2 py-2 bg-evload-bg border border-evload-border hover:bg-evload-border rounded-lg text-xs transition-colors"
                title="Populate rules with predefined templates"
              >
                <FolderOpen size={14} /> Examples
              </button>
              <button
                onClick={generateFromScratch}
                className="flex items-center justify-center gap-1.5 px-2 py-2 bg-evload-bg border border-evload-border hover:bg-evload-border rounded-lg text-xs transition-colors"
                title="Clear all current rules"
              >
                <Trash2 size={14} /> Delete All
              </button>
              <button
                onClick={() => {
                  setSettings((prev) => prev ? { ...prev, telegramRules: [] } : prev)
                  setTestResult('Rule set cleared. Remember to save.')
                }}
                className="flex items-center justify-center gap-1.5 px-2 py-2 bg-evload-bg border border-evload-border hover:bg-evload-border rounded-lg text-xs transition-colors"
                title="Create an empty rule set"
              >
                <Plus size={14} /> New Rules
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={newEvent}
                onChange={(e) => setNewEvent(e.target.value)}
                className="flex-1 bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
              >
                {eventOptions.map((event) => <option key={event} value={event}>{event}</option>)}
              </select>
              <button
                onClick={() => {
                  if (!newEvent) return
                  setPendingAddEvent(newEvent)
                }}
                disabled={!newEvent}
                className="sm:whitespace-nowrap px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm disabled:opacity-50"
              >
                Add Event Message
              </button>
            </div>

            {pendingAddEvent && (
              <div className="border border-evload-border rounded-lg p-3 bg-evload-bg/40 space-y-2">
                <div className="text-sm">Add notification for <strong>{pendingAddEvent}</strong>: choose how to create it.</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => addEventMessageFromTemplate(pendingAddEvent)}
                    className="px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm"
                  >
                    Load Example Template
                  </button>
                  <button
                    onClick={() => addEventMessageFromScratch(pendingAddEvent)}
                    className="px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm"
                  >
                    Generate From Scratch
                  </button>
                  <button
                    onClick={() => setPendingAddEvent('')}
                    className="px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {settings.telegramRules.length === 0 && (
              <div className="text-sm text-evload-muted border border-evload-border rounded-lg px-3 py-2">
                No event messages configured. Create one explicitly from the selector above or load examples.
              </div>
            )}

            {settings.telegramRules.map((rule) => {
              const eventName = rule.event
              const eventOpen = openEvents[eventName]
              const eventPlaceholders = getPlaceholdersForEvent(eventName)
              return (
                <div key={rule.id} className="border border-evload-border rounded-lg p-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => upsertPrimaryRuleForEvent(eventName, (prev) => ({ ...prev, enabled: !prev.enabled }))}
                      className="shrink-0 text-evload-accent hover:text-red-400 transition-colors p-1"
                      title="Enable/disable event message"
                    >
                      {(rule?.enabled ?? true) ? <ToggleRight size={22} /> : <ToggleLeft size={22} className="text-evload-muted" />}
                    </button>
                    <button
                      onClick={() => setOpenEvents((prev) => ({ ...prev, [eventName]: !prev[eventName] }))}
                      className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
                    >
                      <div className="text-sm font-medium truncate">{eventName}</div>
                      {eventOpen ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
                    </button>
                  </div>

                  {eventOpen && (
                    <div className="mt-2 space-y-2">
                        <textarea
                          value={rule.template}
                          onChange={(e) =>
                            upsertPrimaryRuleForEvent(eventName, (prev) => {
                              const existing = getPrimaryRuleForEvent(eventName);
                              return {
                                ...prev,
                                id: existing?.id || prev.id,
                                event: eventName,
                                name: existing?.name || `Message ${eventName}`,
                                template: e.target.value,
                                enabled: existing?.enabled ?? true,
                                condition: undefined,
                              };
                            })
                          }
                          className="w-full h-16 bg-evload-bg border border-evload-border rounded px-3 py-2 text-sm focus:outline-none focus:border-evload-accent"
                          placeholder={`Template for ${eventName}...`}
                        />
                        <div className="flex items-center justify-between gap-4">
                          <button
                            onClick={() => {
                              setPhModalContext(eventName)
                              setIsPhModalOpen(true)
                            }}
                            className="flex items-center gap-1 text-xs text-evload-accent hover:underline"
                          >
                            <HelpCircle size={12} /> View {eventName} Placeholders ({eventPlaceholders.length})
                          </button>
                          <div className="flex items-center gap-2">
                             <button
                               onClick={() => {
                                 setTestEvent(eventName);
                                 setTestTemplate(rule.template);
                                 if (payloadPresets[eventName]) {
                                   setTestPayload(JSON.stringify(payloadPresets[eventName], null, 2));
                                 }
                                 setOpenSections(prev => ({ ...prev, testCenter: true }));
                                 const el = document.getElementById('test-center-anchor');
                                 if (el) el.scrollIntoView({ behavior: 'smooth' });
                               }}
                               className="flex items-center gap-1 px-2 py-1 bg-evload-border hover:bg-evload-bg rounded text-[11px] transition-colors"
                             >
                               <Send size={10} /> Test Rule
                             </button>
                             <button
                               onClick={() => deleteRule(rule.id)}
                               className="text-evload-muted hover:text-evload-error transition-colors"
                               title="Remove this event message"
                             >
                               <Trash2 size={16} />
                             </button>
                          </div>
                        </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="pt-2 border-t border-evload-border/30 text-[10px] text-evload-muted italic flex items-center gap-1 justify-center">
           <Bell size={10} /> Message source of truth: only user-defined rules above are used for runtime notifications.
           {messageSourceLabel && ` (${messageSourceLabel})`}
        </div>
      </div>

      <div id="test-center-anchor" className="h-0" />

      <div className="bg-evload-surface border border-evload-border rounded-xl p-4 space-y-3">
        <CollapsibleHeader
          title="Rules Builder"
          subtitle="Advanced conditions and multiple rules"
          open={openSections.rulesBuilder}
          onToggle={() => setOpenSections((prev) => ({ ...prev, rulesBuilder: !prev.rulesBuilder }))}
        />
        {openSections.rulesBuilder && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSettings((prev) => prev ? { ...prev, telegramRules: [...prev.telegramRules, makeDefaultRule()] } : prev)}
                className="flex items-center gap-2 px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm"
              >
                <Plus size={14} />Add Rule
              </button>
            </div>

            {settings.telegramRules.map((rule) => (
              <div key={rule.id} className="border border-evload-border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={rule.name}
                    onChange={(e) => updateRule(rule.id, (prev) => ({ ...prev, name: e.target.value }))}
                    className="flex-1 min-w-0 bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
                    placeholder="Rule name"
                  />
                  <button onClick={() => updateRule(rule.id, (prev) => ({ ...prev, enabled: !prev.enabled }))} className="shrink-0 text-evload-accent p-1">
                    {rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} className="text-evload-muted" />}
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="shrink-0 p-2 border border-evload-border rounded text-evload-muted hover:text-evload-error">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={rule.event}
                    onChange={(e) => updateRule(rule.id, (prev) => ({ ...prev, event: e.target.value }))}
                    className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
                  >
                    {eventOptions.map((event) => <option key={event} value={event}>{event}</option>)}
                  </select>
                  <select
                    value={rule.condition?.field ?? ''}
                    onChange={(e) => updateRule(rule.id, (prev) => ({
                      ...prev,
                      condition: {
                        field: e.target.value,
                        operator: prev.condition?.operator ?? 'exists',
                        value: prev.condition?.value,
                      },
                    }))}
                    className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
                  >
                    <option value="">Select Field (Optional)</option>
                    {(placeholdersByEvent[rule.event] || []).map((ph) => (
                      <option key={ph} value={ph}>{ph}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={rule.condition?.operator ?? 'exists'}
                    onChange={(e) => updateRule(rule.id, (prev) => ({
                      ...prev,
                      condition: {
                        field: prev.condition?.field ?? 'event',
                        operator: e.target.value as TelegramNotificationCondition['operator'],
                        value: prev.condition?.value,
                      },
                    }))}
                    className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
                  >
                    {TELEGRAM_OPERATOR_OPTIONS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <input
                    value={rule.condition?.value === undefined ? '' : String(rule.condition.value)}
                    onChange={(e) => updateRule(rule.id, (prev) => ({
                      ...prev,
                      condition: {
                        field: prev.condition?.field ?? 'event',
                        operator: prev.condition?.operator ?? 'exists',
                        value: e.target.value,
                      },
                    }))}
                    className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
                    placeholder="Condition value"
                  />
                </div>

                <textarea
                  value={rule.template}
                  onChange={(e) => updateRule(rule.id, (prev) => ({ ...prev, template: e.target.value }))}
                  className="w-full h-20 bg-evload-bg border border-evload-border rounded px-3 py-2 text-sm focus:outline-none focus:border-evload-accent"
                  placeholder="Message template..."
                />

                <div className="flex items-center justify-end">
                  <button
                    onClick={() => {
                      setTestEvent(rule.event);
                      setTestTemplate(rule.template);
                      if (payloadPresets[rule.event]) {
                        setTestPayload(JSON.stringify(payloadPresets[rule.event], null, 2));
                      }
                      setOpenSections(prev => ({ ...prev, testCenter: true }));
                      const el = document.getElementById('test-center-anchor');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex items-center gap-2 px-3 py-1 bg-evload-border hover:bg-evload-bg rounded text-xs transition-colors"
                  >
                    <Send size={12} /> Test This Rule
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="test-center-anchor" className="h-0" />
      <div className="bg-evload-surface border border-evload-border rounded-xl p-4 space-y-3">
        <CollapsibleHeader
          title="Test Center"
          subtitle="Render and send test messages"
          open={openSections.testCenter}
          onToggle={() => setOpenSections((prev) => ({ ...prev, testCenter: !prev.testCenter }))}
        />
        {openSections.testCenter && (
          <div className="space-y-2">
            <div className="text-xs text-evload-muted border border-evload-border rounded px-3 py-2">
              Select an event, edit only fields allowed by its backend schema, then run Telegram Trace or Trigger Event.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={testEvent}
                onChange={(e) => {
                  const ev = e.target.value;
                  setTestEvent(ev);
                  if (payloadPresets[ev]) {
                    setTestPayload(JSON.stringify(payloadPresets[ev], null, 2));
                  }
                }}
                className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
              >
                {eventOptions.map((event) => <option key={event} value={event}>{event}</option>)}
              </select>
              <input
                value={testTemplate}
                onChange={(e) => setTestTemplate(e.target.value)}
                className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
              />
            </div>
            <textarea
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              className="w-full h-24 bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm font-mono"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <input
                value={testPresetName}
                onChange={(e) => setTestPresetName(e.target.value)}
                placeholder="Preset name"
                className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
              />
              <button onClick={saveCurrentTestPreset} className="px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm">Save Payload Preset</button>
              <select
                value={selectedTestPresetId}
                onChange={(e) => setSelectedTestPresetId(e.target.value)}
                className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
              >
                <option value="">Select preset</option>
                {testPayloadPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <button onClick={loadSelectedTestPreset} disabled={!selectedTestPresetId} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm disabled:opacity-50 transition-colors">
                <FolderOpen size={14} />Load Preset
              </button>
              <button onClick={deleteSelectedTestPreset} disabled={!selectedTestPresetId} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-evload-border hover:bg-evload-bg rounded text-sm disabled:opacity-50 transition-colors">
                <Trash2 size={14} />Delete Preset
              </button>
              <button onClick={handleSendTelegramTest} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                <Send size={14} />Telegram Trace
              </button>
              <button onClick={handleTriggerRealEvent} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors">
                <Zap size={14} />Trigger Event
              </button>
            </div>

            {testResult && <pre className="text-xs whitespace-pre-wrap bg-evload-bg border border-evload-border rounded p-3">{testResult}</pre>}
          </div>
        )}
      </div>
    </div>
  )
}
