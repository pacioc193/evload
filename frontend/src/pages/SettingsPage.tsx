import { useEffect, useState, type ReactNode } from 'react'
import axios from 'axios'
import Editor from '@monaco-editor/react'
import {
  getConfig,
  saveConfig,
  getHaAuthorizeUrl,
  getHaEntities,
  getHaTokenStatus,
  getSettings,
  patchSettings,
  type AppSettings,
  type HaTokenStatus,
  downloadBackendLog,
  downloadFrontendLogFromBackend,
  uploadFrontendLogs,
} from '../api/index'
import { changePassword } from '../api/auth'
import { Settings, ExternalLink, Save, LogOut, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Lock, FileDown, FileText } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useWsStore } from '../store/wsStore'
import { flog, downloadFrontendLogs, serializeLogsForUpload, getLogEntries } from '../utils/frontendLogger'

type PanelKey = 'homeAssistant' | 'proxy' | 'engine' | 'security' | 'yaml' | 'logs'

const SETTINGS_PANEL_STATE_KEY = 'evload.settings.expandedPanels'

const defaultExpandedPanels: Record<PanelKey, boolean> = {
  homeAssistant: true,
  proxy: true,
  engine: true,
  security: false,
  yaml: false,
  logs: false,
}

function readExpandedPanels(): Record<PanelKey, boolean> {
  try {
    const raw = window.localStorage.getItem(SETTINGS_PANEL_STATE_KEY)
    if (!raw) return defaultExpandedPanels
    const parsed = JSON.parse(raw) as Partial<Record<PanelKey, boolean>>
    return {
      homeAssistant: typeof parsed.homeAssistant === 'boolean' ? parsed.homeAssistant : defaultExpandedPanels.homeAssistant,
      proxy: typeof parsed.proxy === 'boolean' ? parsed.proxy : defaultExpandedPanels.proxy,
      engine: typeof parsed.engine === 'boolean' ? parsed.engine : defaultExpandedPanels.engine,
      security: typeof parsed.security === 'boolean' ? parsed.security : defaultExpandedPanels.security,
      yaml: typeof parsed.yaml === 'boolean' ? parsed.yaml : defaultExpandedPanels.yaml,
      logs: typeof parsed.logs === 'boolean' ? parsed.logs : defaultExpandedPanels.logs,
    }
  } catch {
    return defaultExpandedPanels
  }
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-evload-border bg-evload-bg/60 p-3 space-y-3">
      <h4 className="text-xs uppercase tracking-wider text-evload-muted font-semibold">{title}</h4>
      {children}
    </div>
  )
}

function CollapsiblePanel({
  title,
  subtitle,
  expanded,
  onToggle,
  children,
  action,
}: {
  title: string
  subtitle: string
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="bg-evload-surface border border-evload-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-start gap-3 text-left"
        >
          <span className="mt-0.5 text-evload-muted">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
          <div className="min-w-0">
            <h2 className="font-semibold text-lg leading-6">{title}</h2>
            <p className="text-sm text-evload-muted leading-5 mt-1">{subtitle}</p>
          </div>
        </button>
        {action}
      </div>
      {expanded && <div className="px-5 pb-5 border-t border-evload-border">{children}</div>}
    </section>
  )
}

function Field({
  label, value, onChange, type = 'text', unit, placeholder, description, listId,
}: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; unit?: string; placeholder?: string; description?: string; listId?: string
}) {
  return (
    <div>
      <label className="block text-sm text-evload-muted mb-1">{label}{unit && <span className="ml-1 text-xs">({unit})</span>}</label>
      {description && <p className="text-[11px] text-evload-muted mb-1">{description}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder}
        className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
      />
    </div>
  )
}

function logLevelColor(level: string): string {
  if (level === 'error') return 'text-evload-error'
  if (level === 'warn') return 'text-yellow-400'
  return 'text-evload-muted'
}

export default function SettingsPage() {
  const [configContent, setConfigContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [configMessage, setConfigMessage] = useState('')
  const [haAuthMessage, setHaAuthMessage] = useState('')
  const [haEntities, setHaEntities] = useState<string[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [haTokenStatus, setHaTokenStatus] = useState<HaTokenStatus | null>(null)
  const [settingsMsg, setSettingsMsg] = useState('')
  const [settingsMsgPanel, setSettingsMsgPanel] = useState('')
  const [expandedPanels, setExpandedPanels] = useState<Record<PanelKey, boolean>>(() => readExpandedPanels())
  
  // Security / Password Change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  // Logs panel
  const [logMsg, setLogMsg] = useState('')
  const [logError, setLogError] = useState(false)
  const [logBusy, setLogBusy] = useState(false)
  
  const clearToken = useAuthStore((s) => s.clearToken)
  const navigate = useNavigate()
  const ha = useWsStore((s) => s.ha)
  const proxy = useWsStore((s) => s.proxy)
  const vehicle = useWsStore((s) => s.vehicle)
  const haConnected = ha?.connected ?? false
  const haServiceError = ha?.error ?? null

  const loadHaEntities = (source: 'auto' | 'oauth-callback' | 'ha-connected' | 'settings-saved' = 'auto') => {
    flog.info('HA', 'Loading Home Assistant entities', {
      source,
      haUrl: settings?.haUrl ?? null,
      hasToken: haTokenStatus?.hasToken ?? false,
    })
    getHaEntities('sensor')
      .then((res) => {
        setHaEntities(res.entities.map((entity) => entity.entityId))
        setHaAuthMessage(`Home Assistant entities loaded (${res.entities.length}).`)
        flog.info('HA', 'Home Assistant entities loaded', {
          source,
          count: res.entities.length,
        })
      })
      .catch((err) => {
        setHaEntities([])
        if (axios.isAxiosError(err)) {
          const status = err.response?.status
          const retryAfterRaw = err.response?.headers?.['retry-after']
          const retryAfter = typeof retryAfterRaw === 'string' ? Number(retryAfterRaw) : null
          const backendMessage = err.response?.data?.error

          if (status === 429 && Number.isFinite(retryAfter)) {
            setHaAuthMessage(`Home Assistant temporarily in cooldown. Retry in ${retryAfter}s.`)
            flog.warn('HA', 'HA entities cooldown active', { source, status, retryAfter })
            return
          }

          if (status === 401 || status === 403 || status === 429) {
            setHaAuthMessage(
              typeof backendMessage === 'string'
                ? backendMessage
                : 'Home Assistant authorization is invalid or locked. Reconnect / Re-authorize.'
            )
            flog.warn('HA', 'HA entities fetch blocked by auth/cooldown', { source, status, backendMessage })
            return
          }
        }
        setHaAuthMessage('Unable to load Home Assistant entities. Check HA URL and entity IDs.')
        flog.error('HA', 'HA entities fetch failed', { source, error: String(err) })
      })
  }

  const loadHaTokenStatus = () => {
    getHaTokenStatus()
      .then((status) => setHaTokenStatus(status))
      .catch(() => setHaTokenStatus(null))
  }

  useEffect(() => {
    getConfig().then((d) => setConfigContent(d.content)).catch(console.error)
    getSettings().then(setSettings).catch(console.error)
    loadHaTokenStatus()
  }, [])

  useEffect(() => {
    if (!haConnected) return
    loadHaEntities('ha-connected')
  }, [haConnected])

  useEffect(() => {
    if (!haTokenStatus?.hasToken) return
    if (!settings?.haUrl) return
    loadHaEntities('auto')
  }, [haTokenStatus?.hasToken, settings?.haUrl])

  useEffect(() => {
    const pollTokenStatus = () => loadHaTokenStatus()
    pollTokenStatus()
    const refreshInterval = setInterval(pollTokenStatus, 30_000)
    const countdownInterval = setInterval(() => {
      setHaTokenStatus((prev) => {
        if (!prev || !prev.hasToken || !prev.expiresAt) return prev
        const expiresAtMs = Date.parse(prev.expiresAt)
        if (!Number.isFinite(expiresAtMs)) return prev
        const nextSecondsRemaining = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
        return {
          ...prev,
          secondsRemaining: nextSecondsRemaining,
          isExpired: nextSecondsRemaining <= 0,
        }
      })
    }, 1000)
    return () => {
      clearInterval(refreshInterval)
      clearInterval(countdownInterval)
    }
  }, [])

  useEffect(() => {
    if (!ha) return
    if (ha.requiresManualReconnect || !ha.connected) {
      loadHaTokenStatus()
    }
  }, [ha?.connected, ha?.requiresManualReconnect, ha?.lastError])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const haStatus = params.get('ha')
    if (!haStatus) return

    if (haStatus === 'connected') {
      setHaAuthMessage('Home Assistant connected. Sensor list refreshed.')
      loadHaTokenStatus()
      loadHaEntities('oauth-callback')
    } else if (haStatus === 'error') {
      setHaAuthMessage('Home Assistant authorization failed.')
    }

    params.delete('ha')
    const query = params.toString()
    const cleanedUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', cleanedUrl)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_PANEL_STATE_KEY, JSON.stringify(expandedPanels))
  }, [expandedPanels])

  const handleSave = async () => {
    setSaving(true)
    setConfigMessage('')
    try {
      flog.info('SETTINGS', 'Saving YAML config')
      await saveConfig(configContent)
      setConfigMessage('Config saved successfully')
      const updated = await getSettings()
      setSettings(updated)
      flog.info('SETTINGS', 'YAML config saved successfully')
    } catch (err: unknown) {
      const msg = `Save failed: ${err instanceof Error ? err.message : 'unknown error'}`
      setConfigMessage(msg)
      flog.error('SETTINGS', 'YAML config save failed', { error: String(err) })
    } finally {
      setSaving(false)
      setTimeout(() => setConfigMessage(''), 4000)
    }
  }

  const handleHaConnect = async () => {
    setHaAuthMessage('')
    try {
      flog.info('HA', 'Initiating Home Assistant OAuth flow')
      const returnTo = `${window.location.origin}/settings`
      const { url } = await getHaAuthorizeUrl(returnTo)
      flog.info('HA', 'Redirecting to HA authorize URL')
      window.location.assign(url)
    } catch (err) {
      const backendMessage = axios.isAxiosError(err)
        ? err.response?.data?.error
        : null
      const msg = typeof backendMessage === 'string' ? backendMessage : 'Failed to get HA authorization URL'
      setHaAuthMessage(msg)
      flog.error('HA', 'Failed to initiate HA OAuth flow', { error: msg })
    }
  }

  const handleSettingsSave = async (panel: string) => {
    if (!settings) return
    setSettingsMsg('')
    setSettingsMsgPanel(panel)
    try {
      flog.info('SETTINGS', 'Saving structured settings', { haUrl: settings.haUrl, proxyUrl: settings.proxyUrl })
      await patchSettings(settings)
      const fresh = await getConfig()
      setConfigContent(fresh.content)
      setSettingsMsg('Settings saved')
      if (haTokenStatus?.hasToken) {
        loadHaEntities('settings-saved')
      }
      flog.info('SETTINGS', 'Structured settings saved successfully')
    } catch (err) {
      setSettingsMsg('Save failed')
      flog.error('SETTINGS', 'Structured settings save failed', { error: String(err) })
    } finally {
      setTimeout(() => { setSettingsMsg(''); setSettingsMsgPanel('') }, 4000)
    }
  }

  const numberFields = new Set<keyof AppSettings>([
    'haMaxHomePowerW', 'resumeDelaySec', 'batteryCapacityKwh', 'energyPriceEurPerKwh', 'defaultAmps', 'maxAmps', 'minAmps', 'rampIntervalSec', 'chargeStartRetryMs',
    'normalPollIntervalMs', 'scheduleLeadTimeSec',
  ])

  const upd = (key: keyof AppSettings) => (val: string) =>
    setSettings((prev) => prev ? { ...prev, [key]: numberFields.has(key) ? Number(val) : val } : prev)

  const togglePanel = (key: PanelKey) => {
    setExpandedPanels((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordMsg('')

    if (!currentPassword || !newPassword) {
      setPasswordMsg('Current and new passwords are required')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordMsg('New passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setPasswordMsg('New password must be at least 8 characters')
      return
    }

    setChangingPassword(true)
    try {
      flog.info('SECURITY', 'Password change requested')
      await changePassword(currentPassword, newPassword, confirmPassword)
      setPasswordMsg('✅ Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      flog.info('SECURITY', 'Password changed successfully')
      setTimeout(() => setPasswordMsg(''), 4000)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setPasswordMsg(err.response.data.error)
        flog.warn('SECURITY', 'Password change failed', { error: err.response.data.error })
      } else {
        setPasswordMsg('Failed to change password. Please try again.')
        flog.error('SECURITY', 'Password change error', { error: String(err) })
      }
    } finally {
      setChangingPassword(false)
    }
  }

  const haPower = ha?.powerW ?? 0
  const haCharger = ha?.chargerW ?? 0
  const haFailureCount = Math.min(ha?.failureCount ?? 0, ha?.maxFailuresBeforeManualReconnect ?? 3)
  const haMaxFailures = ha?.maxFailuresBeforeManualReconnect ?? 3
  const haRequiresManualReconnect = ha?.requiresManualReconnect ?? false
  const haAuthorized = haTokenStatus?.hasToken ?? false
  const haEntitiesLoaded = haEntities.length > 0
  const haLastError = ha?.lastError ?? null
  const hasEntityReadProblem = !!haServiceError && haServiceError.startsWith('HA entity read failed:')
  const haStatusMode: 'live' | 'entities' | 'authorized' | 'locked' | 'offline' = (() => {
    if (haConnected) return 'live'
    if (haEntitiesLoaded) return 'entities'
    if (haAuthorized && !haRequiresManualReconnect) return 'authorized'
    if (haRequiresManualReconnect) return 'locked'
    return 'offline'
  })()
  const haStatusOk = haStatusMode !== 'locked' && haStatusMode !== 'offline'
  const haBadgeText = haStatusMode === 'live'
    ? 'LIVE'
    : haStatusMode === 'entities'
      ? 'ENTITIES'
      : haStatusMode === 'authorized'
        ? 'AUTHORIZED'
        : haStatusMode === 'locked'
          ? 'AUTH LOCK'
          : 'OFFLINE'
  const haStatusTitle = haStatusMode === 'live'
    ? 'Home Assistant connected'
    : haStatusMode === 'entities'
      ? 'Home Assistant entities reachable'
      : haStatusMode === 'authorized'
        ? 'Home Assistant authorized (waiting live data)'
        : haStatusMode === 'locked'
          ? 'Home Assistant authorization locked'
          : 'Home Assistant offline'
  const haStatusHint = haStatusMode === 'entities'
    ? 'Token is valid and HA API is reachable, but at least one configured entity does not provide valid live data.'
    : haStatusMode === 'locked'
      ? 'Token is no longer valid (401/403). Re-authorize Home Assistant to restore the session.'
      : haStatusMode === 'authorized'
        ? 'Token is valid but no live sample has been received yet; verify HA URL and entity IDs.'
        : haStatusMode === 'offline'
          ? 'No valid token or HA connection is unavailable.'
          : 'Live polling is active and data is available.'
  const configuredHomePowerEntityId = settings?.haPowerEntityId?.trim() ?? ''
  const configuredChargerPowerEntityId = settings?.haChargerEntityId?.trim() ?? ''
  const homePowerEntityExists = configuredHomePowerEntityId.length > 0 && haEntities.includes(configuredHomePowerEntityId)
  const chargerPowerEntityExists = configuredChargerPowerEntityId.length > 0 && haEntities.includes(configuredChargerPowerEntityId)
  const canEvaluateEntityExistence = haEntitiesLoaded
  const proxyConnected = proxy?.connected ?? false
  const vehicleInGarage = vehicle?.connected ?? false
  const isVehicleSleeping = vehicle?.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP' || vehicle?.chargingState === 'Sleeping'
  const vehicleStatusLabel = vehicleInGarage ? 'In garage' : isVehicleSleeping ? 'Sleeping' : 'Not in garage / unreachable'
  const runtimeReason = vehicle?.reason ?? proxy?.error ?? vehicle?.error ?? 'No reason available yet'
  const proxyLastEndpoint = proxy?.lastEndpoint ?? null
  const proxyLastSuccessAt = proxy?.lastSuccessAt
    ? new Date(proxy.lastSuccessAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  const tokenRemainingText = haTokenStatus?.secondsRemaining == null
    ? 'Unknown'
    : `${Math.floor(haTokenStatus.secondsRemaining / 60)}m ${haTokenStatus.secondsRemaining % 60}s`

  const handleDownloadBackendLog = async (type: 'combined' | 'error') => {
    setLogBusy(true)
    setLogMsg('')
    setLogError(false)
    try {
      flog.info('LOGS', `Backend ${type} log download requested`)
      await downloadBackendLog(type)
      flog.info('LOGS', `Backend ${type} log downloaded`)
      setLogMsg(`Backend ${type} log downloaded`)
    } catch (err) {
      const msg = `Download failed: ${err instanceof Error ? err.message : 'unknown error'}`
      setLogMsg(msg)
      setLogError(true)
      flog.error('LOGS', `Backend ${type} log download failed`, { error: String(err) })
    } finally {
      setLogBusy(false)
      setTimeout(() => setLogMsg(''), 5000)
    }
  }

  const handleDownloadFrontendLog = () => {
    flog.info('LOGS', 'Frontend log download requested (local)')
    downloadFrontendLogs()
  }

  const handleUploadAndDownloadFrontendLog = async () => {
    setLogBusy(true)
    setLogMsg('')
    setLogError(false)
    try {
      flog.info('LOGS', 'Uploading frontend logs to backend for server-side persistence')
      const serialized = serializeLogsForUpload()
      await uploadFrontendLogs(serialized)
      flog.info('LOGS', 'Frontend logs uploaded successfully, downloading from backend')
      await downloadFrontendLogFromBackend()
      setLogMsg('Frontend log uploaded and downloaded')
    } catch (err) {
      const msg = `Operation failed: ${err instanceof Error ? err.message : 'unknown error'}`
      setLogMsg(msg)
      setLogError(true)
      flog.error('LOGS', 'Frontend log upload/download failed', { error: String(err) })
    } finally {
      setLogBusy(false)
      setTimeout(() => setLogMsg(''), 5000)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button onClick={() => { clearToken(); navigate('/login') }}
          className="flex items-center gap-2 px-4 py-2 bg-evload-border hover:bg-evload-bg text-evload-text rounded-lg font-medium transition-colors text-sm">
          <LogOut size={16} />Sign Out
        </button>
      </div>

      {settings && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg flex items-center gap-2"><Settings size={18} />Configuration Panels</h2>
          </div>

          <CollapsiblePanel
            title="Home Assistant"
            subtitle="Connection, entities, live validation, and OAuth access flow."
            expanded={expandedPanels.homeAssistant}
            onToggle={() => togglePanel('homeAssistant')}
            action={
              <div className="flex items-center gap-2 ml-auto">
                {settingsMsg && settingsMsgPanel === 'ha' && (
                  <span className={`text-xs ${settingsMsg.includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>{settingsMsg}</span>
                )}
                <button onClick={() => handleSettingsSave('ha')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-xs">
                  <Save size={12} />Save
                </button>
                <span className={`w-2 h-2 rounded-full ${haStatusOk ? 'bg-evload-success' : 'bg-evload-error'}`} />
                <span className="text-[10px] uppercase font-bold text-evload-muted">{haBadgeText}</span>
              </div>
            }
          >
            <div className="pt-5 space-y-4">
              <div className={`rounded-lg border px-4 py-3 text-sm ${haStatusOk
                ? 'border-evload-success/30 bg-evload-success/10 text-evload-text'
                : 'border-evload-error/30 bg-evload-error/10 text-evload-text'}`}>
                <div className="font-medium">
                  {haStatusTitle}
                </div>
                <div className="mt-1 text-xs text-evload-muted">{haStatusHint}</div>
                <div className="mt-1 text-xs text-evload-muted">
                  Attempts: {haFailureCount}/{haMaxFailures}
                </div>
                <div className="mt-1 text-xs text-evload-muted">
                  Last error: {haLastError ?? 'None'}
                </div>
                <div className="mt-1 text-xs text-evload-muted">
                  Token remaining: {haTokenStatus?.hasToken ? tokenRemainingText : 'No token'}
                </div>
                {haTokenStatus?.expiresAt && (
                  <div className="mt-1 text-xs text-evload-muted">
                    Token expires at: {new Date(haTokenStatus.expiresAt).toLocaleString()}
                  </div>
                )}
                {hasEntityReadProblem && (
                  <div className="mt-2 text-xs text-yellow-400 font-semibold">
                    Entity validation issue: make sure Home Power Entity ID and Charger Power Entity ID exist in Home Assistant and return numeric values.
                  </div>
                )}
                {haRequiresManualReconnect && haStatusMode === 'locked' && (
                  <div className="mt-2 text-xs text-evload-error font-semibold">
                    Retry stopped after {haMaxFailures} failures. Press Connect / Re-authorize to retry.
                  </div>
                )}
              </div>

              <Field
                label="HA URL"
                value={settings.haUrl}
                onChange={upd('haUrl')}
                placeholder="http://192.168.1.x:8123"
                description="Home Assistant base URL used for OAuth and entity polling."
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="relative">
                  <Field
                    label="Home Power Entity ID"
                    value={settings.haPowerEntityId}
                    onChange={upd('haPowerEntityId')}
                    placeholder="sensor.home_power"
                    description="Total home power consumption entity in watts."
                    listId="ha-sensor-entity-ids"
                  />
                  <div className={`mt-2 rounded-md border px-2 py-1 text-[11px] ${!canEvaluateEntityExistence
                    ? 'border-evload-border bg-evload-bg text-evload-muted'
                    : homePowerEntityExists
                      ? 'border-evload-success/40 bg-evload-success/10 text-evload-text'
                      : 'border-evload-error/40 bg-evload-error/10 text-evload-text'}`}>
                    {!canEvaluateEntityExistence
                      ? 'Entity check pending (load entities first).'
                      : homePowerEntityExists
                        ? `Entity found${haConnected ? ` • live ${(haPower / 1000).toFixed(2)}kW` : ''}`
                        : 'Entity not found in Home Assistant.'}
                  </div>
                </div>
                <div className="relative">
                  <Field
                    label="Charger Power Entity ID"
                    value={settings.haChargerEntityId}
                    onChange={upd('haChargerEntityId')}
                    placeholder="sensor.charger_power"
                    description="Charger power entity in watts for realtime verification in Settings."
                    listId="ha-sensor-entity-ids"
                  />
                  <div className={`mt-2 rounded-md border px-2 py-1 text-[11px] ${!canEvaluateEntityExistence
                    ? 'border-evload-border bg-evload-bg text-evload-muted'
                    : chargerPowerEntityExists
                      ? 'border-evload-success/40 bg-evload-success/10 text-evload-text'
                      : 'border-evload-error/40 bg-evload-error/10 text-evload-text'}`}>
                    {!canEvaluateEntityExistence
                      ? 'Entity check pending (load entities first).'
                      : chargerPowerEntityExists
                        ? `Entity found${haConnected ? ` • live ${(haCharger / 1000).toFixed(2)}kW` : ''}`
                        : 'Entity not found in Home Assistant.'}
                  </div>
                </div>
              </div>
              <datalist id="ha-sensor-entity-ids">
                {haEntities.map((entityId) => (
                  <option key={entityId} value={entityId} />
                ))}
              </datalist>
              <button onClick={handleHaConnect}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-evload-surface border border-evload-border hover:border-evload-accent text-evload-text rounded-lg font-medium transition-colors text-sm">
                <ExternalLink size={14} />Connect / Re-authorize
              </button>
              {haAuthMessage && (
                <p className={`text-sm ${haAuthMessage.toLowerCase().includes('failed') || haAuthMessage.toLowerCase().includes('not configured') || haAuthMessage.toLowerCase().includes('invalid') || haAuthMessage.toLowerCase().includes('cooldown') || haAuthMessage.toLowerCase().includes('reconnect') || haAuthMessage.toLowerCase().includes('locked') ? 'text-evload-error' : 'text-evload-success'}`}>
                  {haAuthMessage}
                </p>
              )}
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Proxy"
            subtitle="Vehicle routing, VIN identity, display naming, and proxy live health."
            expanded={expandedPanels.proxy}
            onToggle={() => togglePanel('proxy')}
            action={
              <div className="flex items-center gap-2 ml-auto">
                {settingsMsg && settingsMsgPanel === 'proxy' && (
                  <span className={`text-xs ${settingsMsg.includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>{settingsMsg}</span>
                )}
                <button onClick={() => handleSettingsSave('proxy')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-xs">
                  <Save size={12} />Save
                </button>
                <span className={`w-2 h-2 rounded-full ${proxyConnected ? 'bg-evload-success' : isVehicleSleeping ? 'bg-yellow-400' : 'bg-evload-error'}`} />
                <span className="text-[10px] uppercase font-bold text-evload-muted">{proxyConnected ? 'LIVE' : isVehicleSleeping ? 'SLEEP' : 'OFFLINE'}</span>
              </div>
            }
          >
            <div className="pt-5 space-y-4">
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                proxyConnected
                  ? 'border-evload-success/30 bg-evload-success/10 text-evload-text'
                  : isVehicleSleeping
                    ? 'border-yellow-500/30 bg-yellow-500/10 text-evload-text'
                    : 'border-evload-error/30 bg-evload-error/10 text-evload-text'
              }`}>
                <div className="font-medium">
                  {proxyConnected ? 'Proxy connection is healthy' : isVehicleSleeping ? 'Proxy reachable — vehicle sleeping' : 'Proxy connection is down'}
                </div>
                <div className="mt-1 text-xs text-evload-muted">Vehicle: {vehicleStatusLabel}</div>
                <div className="mt-1 text-xs text-evload-muted">Reason: {runtimeReason}</div>
                <div className="mt-1 text-xs text-evload-muted">
                  Last successful proxy call: {proxyLastEndpoint ?? 'unknown'}{proxyLastSuccessAt ? ` at ${proxyLastSuccessAt}` : ''}.
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Field
                label="Proxy URL"
                value={settings.proxyUrl}
                onChange={upd('proxyUrl')}
                placeholder="http://proxy.local"
                description="Base URL for Tesla proxy API integration."
              />
              <Field
                label="Vehicle ID (VIN)"
                value={settings.vehicleId}
                onChange={upd('vehicleId')}
                placeholder="LRW..."
                description="Vehicle Identification Number used by proxy and command routes."
              />
              <div className="lg:col-span-2">
                <Field
                  label="Vehicle Name"
                  value={settings.vehicleName}
                  onChange={upd('vehicleName')}
                  placeholder="My Model 3"
                  description="Friendly vehicle name shown in Dashboard and runtime status."
                />
              </div>
              <Field
                label="Normal Poll Interval"
                value={settings.normalPollIntervalMs}
                onChange={upd('normalPollIntervalMs')}
                type="number"
                unit="ms"
                description="Polling interval for full vehicle_data refresh while the car is awake."
              />
              <Field
                label="Schedule Lead Time"
                value={settings.scheduleLeadTimeSec}
                onChange={upd('scheduleLeadTimeSec')}
                type="number"
                unit="sec"
                description="How early the scheduler can request wake mode before a planned charging session."
              />
              <div className="flex items-center justify-between rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
                <div>
                  <div className="font-medium text-sm">Verify TLS Certificates</div>
                  <div className="text-xs text-evload-muted">Disable only for self-signed proxy certificates in trusted local environments.</div>
                </div>
                <button
                  onClick={() => setSettings((prev) => prev ? { ...prev, rejectUnauthorized: !prev.rejectUnauthorized } : prev)}
                  className="text-evload-accent hover:text-red-400 transition-colors"
                >
                  {settings.rejectUnauthorized ? <ToggleRight size={32} /> : <ToggleLeft size={32} className="text-evload-muted" />}
                </button>
              </div>
              </div>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Engine Options"
            subtitle="Demo mode, power budget, charging current rules, battery and cost settings."
            expanded={expandedPanels.engine}
            onToggle={() => togglePanel('engine')}
            action={
              <div className="flex items-center gap-2 ml-auto">
                {settingsMsg && settingsMsgPanel === 'engine' && (
                  <span className={`text-xs ${settingsMsg.includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>{settingsMsg}</span>
                )}
                <button onClick={() => handleSettingsSave('engine')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-xs">
                  <Save size={12} />Save
                </button>
              </div>
            }
          >
            <div className="pt-5 space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
                <div>
                  <div className="font-medium text-sm">Demo Mode</div>
                  <div className="text-xs text-evload-muted">Bypass all real HTTP calls with simulated data.</div>
                </div>
                <button
                  onClick={() => setSettings((prev) => prev ? { ...prev, demo: !prev.demo } : prev)}
                  className="text-evload-accent hover:text-red-400 transition-colors"
                >
                  {settings.demo ? <ToggleRight size={32} /> : <ToggleLeft size={32} className="text-evload-muted" />}
                </button>
              </div>

              <SectionCard title="Power Budget & Loop">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Field
                    label="Max Home Power"
                    value={settings.haMaxHomePowerW}
                    onChange={upd('haMaxHomePowerW')}
                    type="number"
                    unit="W"
                    description="Hard safety limit used by engine throttling."
                  />
                  <Field
                    label="Resume Delay"
                    value={settings.resumeDelaySec}
                    onChange={upd('resumeDelaySec')}
                    type="number"
                    unit="sec"
                    description="Delay before clearing HA throttle after home load drops below the limit."
                  />
                  <Field
                    label="Ramp Up Interval"
                    value={settings.rampIntervalSec}
                    onChange={upd('rampIntervalSec')}
                    type="number"
                    unit="sec"
                    description="How often the engine recomputes smart current setpoint (also minimum settle time between setpoint changes)."
                  />
                  <Field
                    label="Charge Start Retry"
                    value={settings.chargeStartRetryMs}
                    onChange={upd('chargeStartRetryMs')}
                    type="number"
                    unit="ms"
                    description="How long to wait before retrying charge_start when the vehicle is connected but not charging."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Battery & Cost">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Field
                    label="Battery Capacity"
                    value={settings.batteryCapacityKwh}
                    onChange={upd('batteryCapacityKwh')}
                    type="number"
                    unit="kWh"
                    description="Used for SoC/time estimation and fallback calculations."
                  />
                  <Field
                    label="Energy Price"
                    value={settings.energyPriceEurPerKwh}
                    onChange={upd('energyPriceEurPerKwh')}
                    type="number"
                    unit="EUR/kWh"
                    description="Applied to realtime dashboard and historical session costs."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Current Limits">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <Field label="Start A" value={settings.defaultAmps} onChange={upd('defaultAmps')} type="number" description="Initial current request when session starts." />
                  <Field label="Min A" value={settings.minAmps} onChange={upd('minAmps')} type="number" description="Lower bound for dynamic throttling." />
                  <Field label="Max A" value={settings.maxAmps} onChange={upd('maxAmps')} type="number" description="Upper bound for ramp and target setpoint." />
                </div>
              </SectionCard>

              <div className="flex items-center justify-between rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
                <div>
                  <div className="font-medium text-sm">Stop Charging On Start</div>
                  <div className="text-xs text-evload-muted">If enabled, a manual start from the engine panel sends stop instead of start.</div>
                </div>
                <button
                  onClick={() => setSettings((prev) => prev ? { ...prev, stopChargeOnManualStart: !prev.stopChargeOnManualStart } : prev)}
                  className="text-evload-accent hover:text-red-400 transition-colors"
                >
                  {settings.stopChargeOnManualStart ? <ToggleRight size={32} /> : <ToggleLeft size={32} className="text-evload-muted" />}
                </button>
              </div>
            </div>
          </CollapsiblePanel>

        </div>
      )}

      <CollapsiblePanel
        title="Security"
        subtitle="Manage your UI login password."
        expanded={expandedPanels.security}
        onToggle={() => togglePanel('security')}
        action={<Lock size={18} className="text-evload-muted" />}
      >
        <div className="pt-5 space-y-4">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-evload-text mb-2">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-evload-bg border border-evload-border rounded-lg px-4 py-2 text-evload-text focus:outline-none focus:border-evload-accent"
                placeholder="Enter current password"
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-evload-text mb-2">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-evload-bg border border-evload-border rounded-lg px-4 py-2 text-evload-text focus:outline-none focus:border-evload-accent"
                  placeholder="Minimum 8 characters"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-evload-text mb-2">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-evload-bg border border-evload-border rounded-lg px-4 py-2 text-evload-text focus:outline-none focus:border-evload-accent"
                  placeholder="Repeat new password"
                />
              </div>
            </div>
            {passwordMsg && (
              <p className={`text-sm ${passwordMsg.includes('✅') || passwordMsg.includes('successfully') ? 'text-evload-success' : 'text-evload-error'}`}>
                {passwordMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={changingPassword}
              className="flex items-center gap-2 px-6 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        title="YAML"
        subtitle="Advanced full configuration editor for the complete backend config file."
        expanded={expandedPanels.yaml}
        onToggle={() => togglePanel('yaml')}
        action={
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm">
            <Save size={16} />{saving ? 'Saving...' : 'Save YAML'}
          </button>
        }
      >
        <div className="pt-5 space-y-4">
          <div className="rounded-lg overflow-hidden border border-evload-border" style={{ height: '400px' }}>
            <Editor height="400px" defaultLanguage="yaml" value={configContent}
              onChange={(val) => setConfigContent(val ?? '')}
              theme="vs-dark"
              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false, tabSize: 2 }} />
          </div>
          {configMessage && (
            <p className={`text-sm ${configMessage.includes('failed') || configMessage.includes('Failed') ? 'text-evload-error' : 'text-evload-success'}`}>
              {configMessage}
            </p>
          )}
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Logs"
        subtitle="Download backend and frontend logs for diagnostics and troubleshooting."
        expanded={expandedPanels.logs}
        onToggle={() => togglePanel('logs')}
        action={<FileText size={18} className="text-evload-muted" />}
      >
        <div className="pt-5 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Backend logs */}
            <div className="rounded-lg border border-evload-border bg-evload-bg/60 p-4 space-y-3">
              <h4 className="text-xs uppercase tracking-wider text-evload-muted font-semibold">Backend Logs</h4>
              <p className="text-xs text-evload-muted">Server-side logs including engine operations, charging commands, HA events, and errors.</p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleDownloadBackendLog('combined')}
                  disabled={logBusy}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-evload-surface border border-evload-border hover:border-evload-accent text-evload-text rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
                >
                  <FileDown size={14} />Download combined.log
                </button>
                <button
                  onClick={() => handleDownloadBackendLog('error')}
                  disabled={logBusy}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-evload-surface border border-evload-border hover:border-evload-accent text-evload-text rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
                >
                  <FileDown size={14} />Download error.log
                </button>
              </div>
            </div>

            {/* Frontend logs */}
            <div className="rounded-lg border border-evload-border bg-evload-bg/60 p-4 space-y-3">
              <h4 className="text-xs uppercase tracking-wider text-evload-muted font-semibold">Frontend Logs</h4>
              <p className="text-xs text-evload-muted">Browser-side log buffer capturing user actions, settings changes, and client-side errors.</p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleDownloadFrontendLog}
                  disabled={logBusy}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-evload-surface border border-evload-border hover:border-evload-accent text-evload-text rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
                >
                  <FileDown size={14} />Download locally ({getLogEntries().length} entries)
                </button>
                <button
                  onClick={handleUploadAndDownloadFrontendLog}
                  disabled={logBusy}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-evload-surface border border-evload-border hover:border-evload-accent text-evload-text rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
                >
                  <FileDown size={14} />{logBusy ? 'Working...' : 'Upload & download from server'}
                </button>
              </div>
            </div>
          </div>

          {/* Recent frontend log entries preview */}
          {expandedPanels.logs && (() => {
            const entries = getLogEntries().slice(-20).reverse()
            if (entries.length === 0) return null
            return (
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wider text-evload-muted font-semibold">Recent Frontend Events (last 20)</h4>
                <div className="rounded-lg border border-evload-border bg-evload-bg overflow-hidden">
                  <div className="max-h-64 overflow-y-auto font-mono text-xs p-3 space-y-0.5">
                    {entries.map((e, i) => (
                      <div key={i} className={logLevelColor(e.level)}>
                        <span className="opacity-60">{new Date(e.ts).toLocaleTimeString()}</span>
                        {' '}
                        <span className="font-bold">[{e.tag}]</span>
                        {' '}
                        {e.msg}
                        {e.meta ? <span className="opacity-50"> {JSON.stringify(e.meta)}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })()}

          {logMsg && (
            <p className={`text-sm ${logError ? 'text-evload-error' : 'text-evload-success'}`}>
              {logMsg}
            </p>
          )}
        </div>
      </CollapsiblePanel>

    </div>
  )
}
