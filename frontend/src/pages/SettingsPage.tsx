import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { getConfig, saveConfig, getHaAuthorizeUrl, getSettings, patchSettings, type AppSettings } from '../api/index'
import { Settings, ExternalLink, Save, LogOut, Zap, Activity, ToggleLeft, ToggleRight, Battery, MessageSquare } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useWsStore } from '../store/wsStore'

function Field({
  label, value, onChange, type = 'text', unit, placeholder,
}: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; unit?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm text-evload-muted mb-1">{label}{unit && <span className="ml-1 text-xs">({unit})</span>}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
      />
    </div>
  )
}

export default function SettingsPage() {
  const [configContent, setConfigContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsMsg, setSettingsMsg] = useState('')
  const clearToken = useAuthStore((s) => s.clearToken)
  const navigate = useNavigate()
  const ha = useWsStore((s) => s.ha)

  useEffect(() => {
    getConfig().then((d) => setConfigContent(d.content)).catch(console.error)
    getSettings().then(setSettings).catch(console.error)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await saveConfig(configContent)
      setMessage('Config saved successfully')
      const updated = await getSettings()
      setSettings(updated)
    } catch (err: unknown) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const handleHaConnect = async () => {
    try {
      const { url } = await getHaAuthorizeUrl()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setMessage('Failed to get HA authorization URL')
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
    'haMaxHomePowerW', 'batteryCapacityKwh', 'defaultAmps', 'maxAmps', 'minAmps', 'rampIntervalSec',
  ])

  const upd = (key: keyof AppSettings) => (val: string) =>
    setSettings((prev) => prev ? { ...prev, [key]: numberFields.has(key) ? Number(val) : val } : prev)

  const haConnected = ha?.connected ?? false
  const haPower = ha?.powerW ?? 0
  const haGrid = ha?.gridW ?? 0

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
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg flex items-center gap-2"><Settings size={18} />Quick Settings</h2>
            <button onClick={handleSettingsSave}
              className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-sm">
              <Save size={14} />Save
            </button>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-evload-border">
            <div>
              <div className="font-medium text-sm">Demo Mode</div>
              <div className="text-xs text-evload-muted">Bypass all real HTTP calls with simulated data</div>
            </div>
            <button
              onClick={() => setSettings((prev) => prev ? { ...prev, demo: !prev.demo } : prev)}
              className="text-evload-accent hover:text-red-400 transition-colors"
            >
              {settings.demo ? <ToggleRight size={32} /> : <ToggleLeft size={32} className="text-evload-muted" />}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-2 pt-2 border-t border-evload-border sm:border-t-0 sm:pt-0">
                <ExternalLink size={14} />Home Assistant
                <div className="flex items-center gap-2 ml-auto">
                   <span className={`w-2 h-2 rounded-full ${haConnected ? 'bg-evload-success' : 'bg-evload-error'}`} />
                   <span className="text-[10px] uppercase font-bold">{haConnected ? 'LIVE' : 'OFFLINE'}</span>
                </div>
              </h3>
              <Field label="HA URL" value={settings.haUrl} onChange={upd('haUrl')} placeholder="http://192.168.1.x:8123" />
              <div className="grid grid-cols-1 gap-4">
                <div className="relative">
                  <Field label="Power Entity ID" value={settings.haPowerEntityId} onChange={upd('haPowerEntityId')} placeholder="sensor.home_power" />
                  {haConnected && <span className="absolute right-2 top-8 text-[10px] text-evload-success font-mono">{(haPower/1000).toFixed(2)}kW</span>}
                </div>
                <div className="relative">
                  <Field label="Grid Power Entity ID" value={settings.haGridEntityId} onChange={upd('haGridEntityId')} placeholder="sensor.grid_power" />
                  {haConnected && settings.haGridEntityId && <span className="absolute right-2 top-8 text-[10px] text-evload-success font-mono">{(haGrid/1000).toFixed(2)}kW</span>}
                </div>
              </div>
              <Field label="Max Home Power" value={settings.haMaxHomePowerW} onChange={upd('haMaxHomePowerW')} type="number" unit="W" />
              
              <button onClick={handleHaConnect}
                className="flex items-center justify-center gap-2 w-full mt-2 px-4 py-2 bg-evload-surface border border-evload-border hover:border-evload-accent text-evload-text rounded-lg font-medium transition-colors text-sm">
                <ExternalLink size={14} />Connect / Re-authorize
              </button>
            </div>
            
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-1 pt-2 border-t border-evload-border sm:border-t-0 sm:pt-0"><Zap size={14} />Proxy &amp; Vehicle</h3>
              <Field label="Proxy URL" value={settings.proxyUrl} onChange={upd('proxyUrl')} placeholder="http://proxy.local" />
              <Field label="Vehicle ID (VIN)" value={settings.vehicleId} onChange={upd('vehicleId')} placeholder="LRW..." />
              
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-1 pt-4 border-t border-evload-border"><Battery size={14} />Charging Engine</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Battery Capacity" value={settings.batteryCapacityKwh} onChange={upd('batteryCapacityKwh')} type="number" unit="kWh" />
                <Field label="Ramp Up Interval (Loop Refresh Rate)" value={settings.rampIntervalSec} onChange={upd('rampIntervalSec')} type="number" unit="sec" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Start A" value={settings.defaultAmps} onChange={upd('defaultAmps')} type="number" />
                <Field label="Min A" value={settings.minAmps} onChange={upd('minAmps')} type="number" />
                <Field label="Max A" value={settings.maxAmps} onChange={upd('maxAmps')} type="number" />
              </div>
            </div>
            <div className="space-y-4 sm:col-span-2 pt-2 border-t border-evload-border">
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-1"><MessageSquare size={14} />Telegram Bot (Write-Only)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field 
                  label="Bot Token" 
                  value={settings.telegramBotToken ?? ''} 
                  onChange={upd('telegramBotToken')} 
                  type="password"
                  placeholder="Insert new token or leave ********" 
                />
                <div className="flex flex-col gap-1">
                   <label className="text-xs text-evload-muted px-1">Tip</label>
                   <div className="text-xs bg-evload-bg/50 border border-evload-border rounded p-2 text-evload-muted">
                     Token is never shown in clear text for security. To update, simply type the new value.
                   </div>
                </div>
              </div>
            </div>
          </div>
          {settingsMsg && (
            <p className={`text-sm ${settingsMsg.includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>{settingsMsg}</p>
          )}
        </div>
      )}

      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center gap-2"><Activity size={18} />Full Configuration (YAML)</h2>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm">
            <Save size={16} />{saving ? 'Saving...' : 'Save YAML'}
          </button>
        </div>
        <div className="rounded-lg overflow-hidden border border-evload-border" style={{ height: '400px' }}>
          <Editor height="400px" defaultLanguage="yaml" value={configContent}
            onChange={(val) => setConfigContent(val ?? '')}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false, tabSize: 2 }} />
        </div>
        {message && (
          <p className={`text-sm ${message.includes('failed') || message.includes('Failed') ? 'text-evload-error' : 'text-evload-success'}`}>
            {message}
          </p>
        )}
      </div>

    </div>
  )
}
