import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import axios from 'axios'
import {
  getConfig,
  saveConfig,
  getHaAuthorizeUrl,
  getHaEntities,
  getHaTokenStatus,
  getVersionInfo,
  type VersionInfoResponse,
  getSettings,
  patchSettings,
  type AppSettings,
  type HaTokenStatus,
  downloadBackendLog,
  downloadFrontendLogFromBackend,
  uploadFrontendLogs,
  getBackupStatus,
  startBackupOAuth,
  disconnectBackupOAuth,
  triggerBackup,
  listBackupFiles,
  listDriveFolders,
  restoreBackup,
  type BackupStatus,
  type DriveBackupFile,
  type DriveFolderInfo,
  getUpdateStatus,
  triggerFetch,
  startOtaUpdate,
  getOtaLogs,
  type UpdateStatusResponse,
  type CommitInfo,
} from '../api/index'
import { changePassword } from '../api/auth'
import { Settings, ExternalLink, Save, LogOut, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Lock, FileDown, FileText, GitBranch, UploadCloud, RefreshCw, Trash2, FolderOpen, GitCommit, ArrowDown, RotateCcw, Terminal, CheckCircle, XCircle, Loader2, CloudDownload } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useWsStore } from '../store/wsStore'
import { flog, downloadFrontendLogs, serializeLogsForUpload, getLogEntries } from '../utils/frontendLogger'
import { clsx } from 'clsx'

type PanelKey = 'homeAssistant' | 'proxy' | 'engine' | 'versioning' | 'security' | 'yaml' | 'logs' | 'backup'

const SETTINGS_PANEL_STATE_KEY = 'evload.settings.expandedPanels'

const defaultExpandedPanels: Record<PanelKey, boolean> = {
  homeAssistant: true,
  proxy: true,
  engine: true,
  versioning: true,
  security: true,
  yaml: true,
  logs: true,
  backup: true,
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
      versioning: typeof parsed.versioning === 'boolean' ? parsed.versioning : defaultExpandedPanels.versioning,
      security: typeof parsed.security === 'boolean' ? parsed.security : defaultExpandedPanels.security,
      yaml: typeof parsed.yaml === 'boolean' ? parsed.yaml : defaultExpandedPanels.yaml,
      logs: typeof parsed.logs === 'boolean' ? parsed.logs : defaultExpandedPanels.logs,
      backup: typeof parsed.backup === 'boolean' ? parsed.backup : defaultExpandedPanels.backup,
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

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-evload-muted/50 text-evload-muted text-[9px] font-bold leading-none hover:border-evload-accent hover:text-evload-accent transition-colors flex-shrink-0"
      >?</button>
      {open && (
        <div className="absolute z-50 left-0 bottom-full mb-2 w-72 max-w-[90vw] rounded-lg border border-evload-border bg-evload-surface shadow-xl px-3 py-2.5 text-xs text-evload-text leading-relaxed">
          {text}
        </div>
      )}
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', unit, placeholder, description, listId,
}: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; unit?: string; placeholder?: string; description?: string; listId?: string
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-sm text-evload-muted mb-1">
        <span>{label}</span>
        {unit && <span className="text-xs">({unit})</span>}
        {description && <Tooltip text={description} />}
      </label>
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

function CommitCard({
  label,
  commit,
  branch,
  highlight,
  behindCount,
}: {
  label: string
  commit: CommitInfo | null
  branch: string
  highlight: 'local' | 'behind' | 'uptodate'
  behindCount?: number
}) {
  const borderColor =
    highlight === 'behind'
      ? 'border-yellow-500/50'
      : highlight === 'uptodate'
        ? 'border-green-500/40'
        : 'border-evload-border'

  return (
    <div className={`rounded-lg border ${borderColor} bg-evload-surface px-4 py-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-evload-muted font-semibold uppercase tracking-wide">
          <GitBranch size={12} />
          {label}
        </div>
        {highlight === 'behind' && behindCount != null && behindCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-full px-2 py-0.5">
            <ArrowDown size={10} />
            {behindCount} commit {behindCount === 1 ? 'disponibile' : 'disponibili'}
          </span>
        )}
        {highlight === 'uptodate' && (
          <span className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-0.5">
            ✓ aggiornato
          </span>
        )}
      </div>
      {commit ? (
        <>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs bg-evload-bg border border-evload-border rounded px-1.5 py-0.5 text-evload-text">
              {commit.shortHash}
            </span>
            <span className="text-xs text-evload-muted">{branch}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <GitCommit size={12} className="text-evload-muted mt-0.5 shrink-0" />
            <span className="text-sm text-evload-text leading-snug">{commit.message}</span>
          </div>
          <div className="text-xs text-evload-muted">
            {commit.author} · {new Date(commit.date).toLocaleString()}
          </div>
        </>
      ) : (
        <div className="text-sm text-evload-muted italic">Nessuna informazione disponibile</div>
      )}
    </div>
  )
}


  const [configContent, setConfigContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [configMessage, setConfigMessage] = useState('')
  const [haAuthMessage, setHaAuthMessage] = useState('')
  const [haEntities, setHaEntities] = useState<string[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [haTokenStatus, setHaTokenStatus] = useState<HaTokenStatus | null>(null)
  const [versionInfo, setVersionInfo] = useState<VersionInfoResponse | null>(null)
  const [settingsMsg, setSettingsMsg] = useState('')
  const [settingsMsgPanel, setSettingsMsgPanel] = useState('')
  const [expandedPanels, setExpandedPanels] = useState<Record<PanelKey, boolean>>(() => readExpandedPanels())

  // OTA Update
  const [otaStatus, setOtaStatus] = useState<UpdateStatusResponse | null>(null)
  const [otaBranch, setOtaBranch] = useState<string>('')
  const [otaLogs, setOtaLogs] = useState<string>('')
  const [otaLogOffset, setOtaLogOffset] = useState<number>(0)
  const [otaFetching, setOtaFetching] = useState(false)
  const logBoxRef = useRef<HTMLPreElement>(null)
  
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

  // Backup panel
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backupFiles, setBackupFiles] = useState<DriveBackupFile[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const [backupError, setBackupError] = useState(false)
  // Folder picker
  const [driveFolders, setDriveFolders] = useState<DriveFolderInfo[]>([])
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [folderInput, setFolderInput] = useState('')
  const [foldersLoading, setFoldersLoading] = useState(false)
  
  const clearToken = useAuthStore((s) => s.clearToken)
  const navigate = useNavigate()
  const ha = useWsStore((s) => s.ha)
  const proxy = useWsStore((s) => s.proxy)
  const vehicle = useWsStore((s) => s.vehicle)
  const engine = useWsStore((s) => s.engine)
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
    getVersionInfo().then(setVersionInfo).catch(() => setVersionInfo(null))
    getBackupStatus().then((s) => {
      setBackupStatus(s)
      setFolderInput(s.driveFolderPath)
    }).catch(() => setBackupStatus(null))
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

  // ── OTA Update: load initial status and start polling ──────────────────────
  const refreshOtaStatus = useCallback(async () => {
    try {
      const s = await getUpdateStatus()
      setOtaStatus(s)
      if (!otaBranch) setOtaBranch(s.currentBranch)
    } catch { /* ignore */ }
  }, [otaBranch])

  // Poll status every 5 s (light — no network, just local git refs + file stat)
  useEffect(() => {
    refreshOtaStatus()
    const id = setInterval(refreshOtaStatus, 5_000)
    return () => clearInterval(id)
  }, [refreshOtaStatus])

  // When an update is running, poll log tail every second
  useEffect(() => {
    if (otaStatus?.state !== 'running') return
    const id = setInterval(async () => {
      try {
        const { content, totalBytes } = await getOtaLogs(otaLogOffset)
        if (content) {
          setOtaLogs((prev) => prev + content)
          setOtaLogOffset(totalBytes)
        }
      } catch { /* ignore */ }
    }, 1_000)
    return () => clearInterval(id)
  }, [otaStatus?.state, otaLogOffset])

  // Auto-scroll log box to bottom when new lines arrive
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [otaLogs])


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
    'haMaxHomePowerW', 'resumeDelaySec', 'batteryCapacityKwh', 'energyPriceEurPerKwh', 'defaultAmps', 'startAmps', 'maxAmps', 'minAmps', 'rampIntervalSec', 'chargeStartRetryMs',
    'chargingPollIntervalMs', 'windowPollIntervalMs', 'bodyPollIntervalMs', 'vehicleDataWindowMs', 'scheduleLeadTimeSec',
  ])

  const upd = (key: keyof AppSettings) => (val: string) =>
    setSettings((prev) => prev ? { ...prev, [key]: numberFields.has(key) ? Number(val) : val } : prev)

  /** Helper for poll/window fields stored as ms but shown/edited as seconds. */
  const secField = (key: 'chargingPollIntervalMs' | 'windowPollIntervalMs' | 'bodyPollIntervalMs' | 'vehicleDataWindowMs') => ({
    value: settings ? Math.round((settings[key] as number) / 1000) : 0,
    onChange: (val: string) => upd(key)(String(Math.round(Number(val) * 1000))),
  })

  const togglePanel = (key: PanelKey) => {
    setExpandedPanels((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleOtaFetch = async () => {
    setOtaFetching(true)
    try {
      const res = await triggerFetch()
      setOtaStatus((prev) => prev ? { ...prev, localCommit: res.localCommit, remoteCommit: res.remoteCommit, behindCount: res.behindCount } : prev)
    } catch { /* ignore */ } finally {
      setOtaFetching(false)
    }
  }

  const handleOtaStart = async () => {
    if (!otaBranch) return
    setOtaLogs('')
    setOtaLogOffset(0)
    try {
      await startOtaUpdate(otaBranch)
      await refreshOtaStatus()
    } catch (err) {
      flog.error('OTA', 'Failed to start update', { error: String(err) })
    }
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
  const dataWindowExpiresAt = proxy?.vehicleDataWindowExpiresAt ?? null
  const dataWindowRemainSec = dataWindowExpiresAt != null
    ? Math.max(0, Math.round((dataWindowExpiresAt - Date.now()) / 1000))
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
                <div className="mt-1 text-xs text-evload-muted">
                  Sleep state:{' '}
                  {vehicle?.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP'
                    ? <span className="text-yellow-400 font-medium">Sleeping 😴</span>
                    : vehicle?.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_AWAKE'
                      ? <span className="text-evload-success font-medium">Awake ☀️</span>
                      : <span className="text-evload-muted">Unknown</span>}
                </div>
                <div className="mt-1 text-xs text-evload-muted">Reason: {runtimeReason}</div>
                <div className="mt-1 text-xs text-evload-muted">
                  Last successful proxy call: {proxyLastEndpoint ?? 'unknown'}{proxyLastSuccessAt ? ` at ${proxyLastSuccessAt}` : ''}.
                </div>
                <div className="mt-1 text-xs text-evload-muted">
                  Data window: {dataWindowRemainSec != null && dataWindowRemainSec > 0
                    ? <span className="text-evload-success font-medium">active — {Math.floor(dataWindowRemainSec / 60)}m {dataWindowRemainSec % 60}s remaining</span>
                    : (vehicle?.charging || engine?.running)
                      ? <span className="text-evload-success font-medium">inactive — vehicle_data polled (charging active)</span>
                      : <span className="text-evload-muted">inactive — body_controller_state only</span>}
                </div>
              </div>

              <SectionCard title="HTTP / TLS">
                <Field
                  label="Proxy URL"
                  value={settings.proxyUrl}
                  onChange={upd('proxyUrl')}
                  placeholder="http://proxy.local"
                  description="Base URL for the Tesla proxy API. All vehicle requests are routed through this address."
                />
                <div className="flex items-center justify-between rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">Verify TLS</span>
                    <Tooltip text="When enabled, validates the proxy TLS certificate. Disable only for self-signed certificates in trusted local environments." />
                  </div>
                  <button
                    onClick={() => setSettings((prev) => prev ? { ...prev, rejectUnauthorized: !prev.rejectUnauthorized } : prev)}
                    className="text-evload-accent hover:text-red-400 transition-colors"
                  >
                    {settings.rejectUnauthorized ? <ToggleRight size={32} /> : <ToggleLeft size={32} className="text-evload-muted" />}
                  </button>
                </div>
              </SectionCard>

              <SectionCard title="VIN / Vehicle">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Field
                    label="VIN"
                    value={settings.vehicleId}
                    onChange={upd('vehicleId')}
                    placeholder="LRW..."
                    description="Vehicle Identification Number used by the proxy and vehicle command routes."
                  />
                  <Field
                    label="Vehicle Name"
                    value={settings.vehicleName}
                    onChange={upd('vehicleName')}
                    placeholder="My Model 3"
                    description="Friendly name shown in the Dashboard and runtime status messages."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Body Controller">
                <Field
                  label="Body Poll Interval"
                  {...secField('bodyPollIntervalMs')}
                  type="number"
                  unit="sec"
                  description="How often body_controller_state is polled. This timer always runs, regardless of window or charging state, and never wakes the vehicle. Default: 60 s."
                />
              </SectionCard>

              <SectionCard title="Vehicle Data Window">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Field
                    label="Window Duration"
                    {...secField('vehicleDataWindowMs')}
                    type="number"
                    unit="sec"
                    description="How many seconds after a wake or connect event vehicle_data is requested. Once the window expires (and charging is not active), vehicle_data polling stops. Default: 300 s."
                  />
                  <Field
                    label="Window Poll Interval"
                    {...secField('windowPollIntervalMs')}
                    type="number"
                    unit="sec"
                    description="How often vehicle_data is fetched while the data window is active and the vehicle is not charging. Independent of the body poll timer. Default: 10 s."
                  />
                </div>
              </SectionCard>

              <SectionCard title="Charging Poll">
                <Field
                  label="Charging Poll Interval"
                  {...secField('chargingPollIntervalMs')}
                  type="number"
                  unit="sec"
                  description="How often vehicle_data is fetched while the vehicle is actively charging or the engine is running. Independent of the body poll timer. Default: 5 s."
                />
              </SectionCard>

              <SectionCard title="Scheduler">
                <Field
                  label="Schedule Lead Time"
                  value={settings.scheduleLeadTimeSec}
                  onChange={upd('scheduleLeadTimeSec')}
                  type="number"
                  unit="sec"
                  description="How many seconds before the scheduled charge time the scheduler wakes the vehicle (default: 1800 s = 30 min)."
                />
              </SectionCard>
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
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm">Demo Mode</span>
                  <Tooltip text="Bypasses all real HTTP calls with simulated data. Useful for testing the UI without an active proxy." />
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Field label="Default Target A" value={settings.defaultAmps} onChange={upd('defaultAmps')} type="number" description="Default target charging current for new sessions." />
                  <Field label="First Cmd A" value={settings.startAmps} onChange={upd('startAmps')} type="number" description="Current applied on the very first charge command before ramp-up. Must be within Min–Max range." />
                  <Field label="Min A" value={settings.minAmps} onChange={upd('minAmps')} type="number" description="Lower bound for dynamic throttling." />
                  <Field label="Max A" value={settings.maxAmps} onChange={upd('maxAmps')} type="number" description="Upper bound for ramp and target setpoint." />
                </div>
              </SectionCard>

              <div className="flex items-center justify-between rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm">Stop Charging On Start</span>
                  <Tooltip text="If enabled, EVload stops charging started by the car's internal scheduler before a scheduled EVload session takes control." />
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
        title="Versioning"
        subtitle="Current app version, update availability, and release history."
        expanded={expandedPanels.versioning}
        onToggle={() => togglePanel('versioning')}
        action={<GitBranch size={18} className="text-evload-muted" />}
      >
        <div className="pt-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
              <div className="text-xs text-evload-muted uppercase tracking-wide">Current</div>
              <div className="mt-1 text-xl font-semibold text-evload-text">{versionInfo?.current ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
              <div className="text-xs text-evload-muted uppercase tracking-wide">Latest</div>
              <div className="mt-1 text-xl font-semibold text-evload-text">{versionInfo?.latest ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-evload-border bg-evload-bg/60 px-4 py-3">
              <div className="text-xs text-evload-muted uppercase tracking-wide">Update Status</div>
              <div className={`mt-1 text-xl font-semibold ${versionInfo?.needsUpdate ? 'text-yellow-400' : 'text-evload-success'}`}>
                {versionInfo == null ? 'Unknown' : versionInfo.needsUpdate ? 'Update available' : 'Up to date'}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-evload-border bg-evload-bg/60 p-4">
            <div className="text-xs uppercase tracking-wider text-evload-muted font-semibold mb-3">Version History</div>
            {(versionInfo?.history?.length ?? 0) === 0 ? (
              <div className="text-sm text-evload-muted">No tracked releases yet.</div>
            ) : (
              <div className="space-y-2">
                {versionInfo?.history.map((entry) => (
                  <div key={`${entry.version}-${entry.releasedAt}`} className="rounded-md border border-evload-border bg-evload-surface px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-evload-text">{entry.version}</span>
                      <span className="text-xs text-evload-muted">{new Date(entry.releasedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-xs text-evload-muted mt-1">{entry.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── OTA Update ────────────────────────────────────────────────── */}
          <div className="rounded-lg border border-evload-border bg-evload-bg/60 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-evload-muted font-semibold">
                <CloudDownload size={14} />
                OTA Update
              </div>
              <span className="text-[10px] text-evload-muted bg-evload-surface border border-evload-border rounded-full px-2 py-0.5 flex items-center gap-1">
                <RotateCcw size={10} />
                auto-check ogni 60 s
              </span>
            </div>

            {/* Commit cards */}
            {otaStatus && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <CommitCard
                  label="Locale (HEAD)"
                  commit={otaStatus.localCommit}
                  branch={otaStatus.currentBranch}
                  highlight="local"
                />
                <CommitCard
                  label={`Remoto (origin/${otaBranch || otaStatus.currentBranch})`}
                  commit={otaStatus.remoteCommit}
                  branch={otaBranch || otaStatus.currentBranch}
                  highlight={otaStatus.behindCount > 0 ? 'behind' : 'uptodate'}
                  behindCount={otaStatus.behindCount}
                />
              </div>
            )}

            {/* Branch selector + action row */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-evload-muted mb-1">Branch target</label>
                <select
                  value={otaBranch}
                  onChange={(e) => setOtaBranch(e.target.value)}
                  disabled={otaStatus?.state === 'running'}
                  className="w-full rounded-lg border border-evload-border bg-evload-bg px-3 py-2 text-sm text-evload-text disabled:opacity-50"
                >
                  {(otaStatus?.branches ?? []).map((b) => (
                    <option key={b} value={b}>{b}{b === otaStatus?.currentBranch ? ' (current)' : ''}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleOtaFetch}
                disabled={otaFetching || otaStatus?.state === 'running'}
                title="Aggiorna info remote (git fetch)"
                className="flex items-center gap-1.5 rounded-lg border border-evload-border bg-evload-surface px-3 py-2 text-sm text-evload-text hover:bg-evload-border/50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={14} className={otaFetching ? 'animate-spin' : ''} />
                Fetch ora
              </button>
              <button
                onClick={handleOtaStart}
                disabled={!otaBranch || otaStatus?.state === 'running'}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  otaStatus?.state === 'running'
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 cursor-not-allowed'
                    : 'bg-evload-accent/90 hover:bg-evload-accent text-white disabled:opacity-50'
                )}
              >
                {otaStatus?.state === 'running'
                  ? <><Loader2 size={14} className="animate-spin" /> In corso…</>
                  : <><UploadCloud size={14} /> Avvia Aggiornamento</>
                }
              </button>
            </div>

            {/* Engine-running warning */}
            {engine?.running && (
              <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
                <span>⚠️</span>
                <span>Una sessione di ricarica è attiva. L'aggiornamento la interromperà al riavvio del servizio.</span>
              </div>
            )}

            {/* Status badge */}
            {otaStatus?.state && otaStatus.state !== 'idle' && (
              <div className={clsx(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                otaStatus.state === 'running' && 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
                otaStatus.state === 'success' && 'border-green-500/40 bg-green-500/10 text-green-300',
                otaStatus.state === 'error' && 'border-red-500/40 bg-red-500/10 text-red-300',
              )}>
                {otaStatus.state === 'running' && <Loader2 size={14} className="animate-spin" />}
                {otaStatus.state === 'success' && <CheckCircle size={14} />}
                {otaStatus.state === 'error' && <XCircle size={14} />}
                <span>
                  {otaStatus.state === 'running' && `Aggiornamento in corso su "${otaStatus.branch}"…`}
                  {otaStatus.state === 'success' && `Completato (branch: ${otaStatus.branch}) — ${otaStatus.endedAt ? new Date(otaStatus.endedAt).toLocaleTimeString() : ''}`}
                  {otaStatus.state === 'error' && `Fallito (exit: ${otaStatus.exitCode}) — ${otaStatus.endedAt ? new Date(otaStatus.endedAt).toLocaleTimeString() : ''}`}
                </span>
              </div>
            )}

            {/* Live log viewer */}
            {otaLogs && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-evload-muted">
                  <Terminal size={12} />
                  Log di build
                </div>
                <pre
                  ref={logBoxRef}
                  className="max-h-72 overflow-y-auto rounded-lg border border-evload-border bg-black/60 p-3 text-[11px] leading-relaxed text-green-300 font-mono whitespace-pre-wrap"
                >
                  {otaLogs}
                </pre>
              </div>
            )}
          </div>
        </div>
      </CollapsiblePanel>

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
            <textarea
              className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[13px] p-3 resize-none outline-none border-none leading-5"
              value={configContent}
              onChange={(e) => setConfigContent(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
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

      {/* ── Google Drive Backup ─────────────────────────────────────────── */}
      <CollapsiblePanel
        title="Backup Google Drive"
        subtitle="Backup automatico di config.yaml e database su Google Drive"
        expanded={expandedPanels.backup}
        onToggle={() => setExpandedPanels((p) => ({ ...p, backup: !p.backup }))}
      >
        <div className="space-y-4 pt-4">
          {/* Connection status */}
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${backupStatus?.connected ? 'bg-evload-success' : 'bg-evload-muted'}`} />
            <span className="text-sm">
              {backupStatus?.connected ? '✅ Google Drive collegato' : '⚪ Google Drive non collegato'}
            </span>
          </div>

          {backupStatus?.lastBackupAt && (
            <p className="text-xs text-evload-muted">
              Ultimo backup: {new Date(backupStatus.lastBackupAt).toLocaleString()}
            </p>
          )}
          {backupStatus?.nextBackupAt && backupStatus.connected && backupStatus.enabled && (
            <p className="text-xs text-evload-muted">
              Prossimo backup: {new Date(backupStatus.nextBackupAt).toLocaleString()}
            </p>
          )}

          {/* ── Drive folder picker ─────────────────────────────────────── */}
          {backupStatus?.connected && (
            <div className="space-y-2">
              <label className="block text-sm text-evload-muted">
                Cartella di destinazione su Drive
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  placeholder="evload-backups"
                  className="flex-1 bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-evload-accent"
                />
                <button
                  title="Sfoglia cartelle su Drive"
                  disabled={foldersLoading}
                  onClick={async () => {
                    setFoldersLoading(true)
                    setFolderPickerOpen(false)
                    try {
                      const res = await listDriveFolders()
                      setDriveFolders(res.folders)
                      setFolderPickerOpen(true)
                    } catch {
                      setBackupMsg('Impossibile caricare le cartelle Drive')
                      setBackupError(true)
                      setTimeout(() => setBackupMsg(''), 4000)
                    } finally {
                      setFoldersLoading(false)
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-2 bg-evload-surface border border-evload-border rounded-lg text-sm hover:bg-evload-border disabled:opacity-50"
                >
                  <FolderOpen size={16} className={foldersLoading ? 'animate-pulse' : ''} />
                  Sfoglia
                </button>
              </div>

              {/* Folder dropdown list */}
              {folderPickerOpen && (
                <div className="rounded-lg border border-evload-border bg-evload-bg overflow-hidden">
                  {driveFolders.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-evload-muted">
                      Nessuna cartella trovata nella radice del Drive. Digita il nome che vuoi creare.
                    </p>
                  ) : (
                    <ul className="max-h-44 overflow-auto divide-y divide-evload-border">
                      {driveFolders.map((f) => (
                        <li key={f.id}>
                          <button
                            onClick={() => {
                              setFolderInput(f.path)
                              setFolderPickerOpen(false)
                            }}
                            className={clsx(
                              'w-full text-left px-3 py-2 text-sm hover:bg-evload-border transition-colors flex items-center gap-2',
                              folderInput === f.path && 'bg-evload-border font-semibold'
                            )}
                          >
                            <FolderOpen size={14} className="text-evload-muted shrink-0" />
                            {f.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="px-3 py-2 border-t border-evload-border">
                    <button
                      onClick={() => setFolderPickerOpen(false)}
                      className="text-xs text-evload-muted hover:text-evload-text"
                    >
                      Chiudi
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs text-evload-muted">
                Percorso relativo nella radice Drive. Supporta sotto-cartelle: <code>Documenti/evload-backups</code>.
                Le cartelle mancanti vengono create automaticamente.
                Per cambiare la cartella modifica il campo <code>backup.driveFolderPath</code> in <code>config.yaml</code>
                (sezione Impostazioni → YAML) oppure clicca "Sfoglia" per selezionare e poi salva via YAML.
              </p>
            </div>
          )}

          {/* Connect / Disconnect */}
          <div className="flex gap-3 flex-wrap">
            {!backupStatus?.connected ? (
              <button
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true)
                  try {
                    const { url } = await startBackupOAuth()
                    window.location.assign(url)
                  } catch (e) {
                    setBackupMsg('Errore connessione Google Drive')
                    setBackupError(true)
                    flog.error('BACKUP', 'OAuth start failed', { e })
                    setTimeout(() => setBackupMsg(''), 4000)
                  } finally {
                    setBackupBusy(false)
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <UploadCloud size={16} />
                Connetti Google Drive
              </button>
            ) : (
              <button
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true)
                  try {
                    await disconnectBackupOAuth()
                    const s = await getBackupStatus()
                    setBackupStatus(s)
                    setBackupMsg('Google Drive disconnesso')
                    setBackupError(false)
                  } catch {
                    setBackupMsg('Errore disconnessione')
                    setBackupError(true)
                  } finally {
                    setBackupBusy(false)
                    setTimeout(() => setBackupMsg(''), 4000)
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-evload-border hover:bg-evload-muted/20 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Trash2 size={16} />
                Disconnetti
              </button>
            )}

            {backupStatus?.connected && (
              <button
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true)
                  setBackupMsg('')
                  try {
                    await triggerBackup()
                    const s = await getBackupStatus()
                    setBackupStatus(s)
                    setBackupMsg('✅ Backup completato')
                    setBackupError(false)
                    const files = await listBackupFiles()
                    setBackupFiles(files.files)
                  } catch (e) {
                    setBackupMsg('❌ Backup fallito: ' + String(e))
                    setBackupError(true)
                  } finally {
                    setBackupBusy(false)
                    setTimeout(() => setBackupMsg(''), 6000)
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-evload-surface border border-evload-border hover:bg-evload-border rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <RefreshCw size={16} className={backupBusy ? 'animate-spin' : ''} />
                Esegui Backup Ora
              </button>
            )}
          </div>

          {backupMsg && (
            <p className={`text-sm ${backupError ? 'text-evload-error' : 'text-evload-success'}`}>{backupMsg}</p>
          )}

          {/* Backup list */}
          {backupStatus?.connected && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">File su Drive</h4>
                <button
                  onClick={async () => {
                    try {
                      const files = await listBackupFiles()
                      setBackupFiles(files.files)
                    } catch {
                      setBackupMsg('Errore caricamento lista')
                      setBackupError(true)
                      setTimeout(() => setBackupMsg(''), 4000)
                    }
                  }}
                  className="text-xs text-evload-muted hover:text-evload-text"
                >
                  Aggiorna lista
                </button>
              </div>
              {backupFiles.length === 0 ? (
                <p className="text-xs text-evload-muted">Nessun backup trovato. Clicca "Aggiorna lista" o esegui il primo backup.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-auto">
                  {backupFiles.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-evload-border bg-evload-bg text-xs">
                      <div>
                        <div className="font-medium truncate max-w-[220px]">{f.name}</div>
                        {f.createdTime && (
                          <div className="text-evload-muted">{new Date(f.createdTime).toLocaleString()}</div>
                        )}
                      </div>
                      <button
                        disabled={backupBusy}
                        onClick={async () => {
                          if (!window.confirm(`Ripristinare ${f.name}? L'operazione sovrascriverà config e database.`)) return
                          setBackupBusy(true)
                          setBackupMsg('')
                          try {
                            await restoreBackup(f.id)
                            setBackupMsg('✅ Ripristino completato. Riavvia il servizio per applicare le modifiche.')
                            setBackupError(false)
                          } catch (e) {
                            setBackupMsg('❌ Ripristino fallito: ' + String(e))
                            setBackupError(true)
                          } finally {
                            setBackupBusy(false)
                            setTimeout(() => setBackupMsg(''), 8000)
                          }
                        }}
                        className="shrink-0 px-2 py-1 rounded bg-evload-border hover:bg-evload-accent hover:text-white transition-colors disabled:opacity-40"
                      >
                        Ripristina
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-evload-muted pt-2 border-t border-evload-border">
            Frequenza, orario e cartella si configurano anche tramite il file <code>config.yaml</code> (sezione <code>backup</code>).
            Per abilitare il backup crea un progetto Google Cloud con l'API Drive abilitata e configura{' '}
            <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> nel file <code>.env</code>.
            Vedi <strong>docs/SETUP_GUIDE.md</strong> per la guida completa.
          </p>
        </div>
      </CollapsiblePanel>

    </div>
  )
}
