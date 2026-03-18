import { useEffect, useState, type ReactNode } from 'react'
import axios from 'axios'
import Editor from '@monaco-editor/react'
import { getConfig, saveConfig, getHaAuthorizeUrl, getHaEntities, getSettings, patchSettings, type AppSettings } from '../api/index'
import { Settings, ExternalLink, Save, LogOut, ToggleLeft, ToggleRight, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useWsStore } from '../store/wsStore'

type PanelKey = 'homeAssistant' | 'proxy' | 'engine' | 'yaml'

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

export default function SettingsPage() {
  const [configContent, setConfigContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [configMessage, setConfigMessage] = useState('')
  const [haAuthMessage, setHaAuthMessage] = useState('')
  const [haEntities, setHaEntities] = useState<string[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsMsg, setSettingsMsg] = useState('')
  const [expandedPanels, setExpandedPanels] = useState<Record<PanelKey, boolean>>({
    homeAssistant: true,
    proxy: true,
    engine: true,
    yaml: false,
  })
  const clearToken = useAuthStore((s) => s.clearToken)
  const navigate = useNavigate()
  const ha = useWsStore((s) => s.ha)
  const proxy = useWsStore((s) => s.proxy)
  const vehicle = useWsStore((s) => s.vehicle)

  useEffect(() => {
    getConfig().then((d) => setConfigContent(d.content)).catch(console.error)
    getSettings().then(setSettings).catch(console.error)
    getHaEntities('sensor')
      .then((res) => setHaEntities(res.entities.map((entity) => entity.entityId)))
      .catch(() => setHaEntities([]))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setConfigMessage('')
    try {
      await saveConfig(configContent)
      setConfigMessage('Config saved successfully')
      const updated = await getSettings()
      setSettings(updated)
    } catch (err: unknown) {
      setConfigMessage(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setSaving(false)
      setTimeout(() => setConfigMessage(''), 4000)
    }
  }

  const handleHaConnect = async () => {
    setHaAuthMessage('')
    try {
      const { url } = await getHaAuthorizeUrl()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      const backendMessage = axios.isAxiosError(err)
        ? err.response?.data?.error
        : null
      setHaAuthMessage(typeof backendMessage === 'string' ? backendMessage : 'Failed to get HA authorization URL')
    }
  }

  const handleSettingsSave = async () => {
    if (!settings) return
    setSettingsMsg('')
    try {
      await patchSettings(settings)
      const fresh = await getConfig()
      setConfigContent(fresh.content)
      setSettingsMsg('Settings saved')
    } catch {
      setSettingsMsg('Save failed')
    } finally {
      setTimeout(() => setSettingsMsg(''), 4000)
    }
  }

  const numberFields = new Set<keyof AppSettings>([
    'haMaxHomePowerW', 'resumeDelaySec', 'batteryCapacityKwh', 'energyPriceEurPerKwh', 'defaultAmps', 'maxAmps', 'minAmps', 'rampIntervalSec',
    'normalPollIntervalMs', 'reactivePollIntervalMs', 'scheduleLeadTimeSec',
  ])

  const upd = (key: keyof AppSettings) => (val: string) =>
    setSettings((prev) => prev ? { ...prev, [key]: numberFields.has(key) ? Number(val) : val } : prev)

  const togglePanel = (key: PanelKey) => {
    setExpandedPanels((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const haConnected = ha?.connected ?? false
  const haPower = ha?.powerW ?? 0
  const haCharger = ha?.chargerW ?? 0
  const proxyConnected = proxy?.connected ?? false
  const proxyError = proxy?.error ?? vehicle?.error ?? ''
  const proxyLastEndpoint = proxy?.lastEndpoint ?? null
  const proxyLastSuccessAt = proxy?.lastSuccessAt
    ? new Date(proxy.lastSuccessAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

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
            <button onClick={handleSettingsSave}
              className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-sm">
              <Save size={14} />Save Settings
            </button>
          </div>

          <CollapsiblePanel
            title="Home Assistant"
            subtitle="Connection, entities, live validation, and OAuth access flow."
            expanded={expandedPanels.homeAssistant}
            onToggle={() => togglePanel('homeAssistant')}
            action={
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={handleSettingsSave}
                  className="flex items-center gap-2 px-3 py-1.5 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-xs">
                  <Save size={12} />Save
                </button>
                <span className={`w-2 h-2 rounded-full ${haConnected ? 'bg-evload-success' : 'bg-evload-error'}`} />
                <span className="text-[10px] uppercase font-bold text-evload-muted">{haConnected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            }
          >
            <div className="pt-5 space-y-4">
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
                  {haConnected && <span className="absolute right-3 top-9 text-[10px] text-evload-success font-mono">{(haPower / 1000).toFixed(2)}kW</span>}
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
                  {haConnected && settings.haChargerEntityId && <span className="absolute right-3 top-9 text-[10px] text-evload-success font-mono">{(haCharger / 1000).toFixed(2)}kW</span>}
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
                <p className={`text-sm ${haAuthMessage.toLowerCase().includes('failed') || haAuthMessage.toLowerCase().includes('not configured') ? 'text-evload-error' : 'text-evload-success'}`}>
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
                <button onClick={handleSettingsSave}
                  className="flex items-center gap-2 px-3 py-1.5 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-xs">
                  <Save size={12} />Save
                </button>
                <span className={`w-2 h-2 rounded-full ${proxyConnected ? 'bg-evload-success' : 'bg-evload-error'}`} />
                <span className="text-[10px] uppercase font-bold text-evload-muted">{proxyConnected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            }
          >
            <div className="pt-5 space-y-4">
              <div className={`rounded-lg border px-4 py-3 text-sm ${proxyConnected ? 'border-evload-success/30 bg-evload-success/10 text-evload-text' : 'border-evload-error/30 bg-evload-error/10 text-evload-text'}`}>
                <div className="font-medium">{proxyConnected ? 'Proxy responding correctly' : 'Proxy not responding'}</div>
                <div className="mt-1 text-xs text-evload-muted">
                  {proxyConnected
                    ? `Last successful proxy call: ${proxyLastEndpoint ?? 'unknown'}${proxyLastSuccessAt ? ` at ${proxyLastSuccessAt}` : ''}.`
                    : (proxyError || 'No valid response is currently arriving from the proxy.')}
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
                label="Reactive / Heartbeat Interval"
                value={settings.reactivePollIntervalMs}
                onChange={upd('reactivePollIntervalMs')}
                type="number"
                unit="ms"
                description="How often body_controller_state is used as a low-impact heartbeat and reactive sleep check."
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
              <button onClick={handleSettingsSave}
                className="flex items-center gap-2 px-3 py-1.5 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-xs">
                <Save size={12} />Save
              </button>
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
                    description="How often the engine recomputes smart current setpoint."
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
            </div>
          </CollapsiblePanel>

          {settingsMsg && (
            <p className={`text-sm ${settingsMsg.includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>{settingsMsg}</p>
          )}
        </div>
      )}

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

    </div>
  )
}
