import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { getConfig, saveConfig, getHaAuthorizeUrl, getSettings, patchSettings, type AppSettings } from '../api/index'
import { Settings, ExternalLink, Save, LogOut, Zap, Activity, ToggleLeft, ToggleRight, Battery } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useWsStore } from '../store/wsStore'

function Field({
  label, value, onChange, type = 'text', unit,
}: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; unit?: string
}) {
  return (
    <div>
      <label className="block text-sm text-evload-muted mb-1">{label}{unit && <span className="ml-1 text-xs">({unit})</span>}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
    'haMaxHomePowerW', 'batteryCapacityKwh', 'defaultAmps', 'maxAmps', 'minAmps',
  ])

  const upd = (key: keyof AppSettings) => (val: string) =>
    setSettings((prev) => prev ? { ...prev, [key]: numberFields.has(key) ? Number(val) : val } : prev)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Quick Settings */}
      {settings && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg flex items-center gap-2"><Settings size={18} />Quick Settings</h2>
            <button onClick={handleSettingsSave}
              className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-sm">
              <Save size={14} />Save
            </button>
          </div>

          {/* Demo Mode Toggle */}
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
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-1"><ExternalLink size={14} />Home Assistant</h3>
              <Field label="HA URL" value={settings.haUrl} onChange={upd('haUrl')} />
              <Field label="Power Entity ID" value={settings.haPowerEntityId} onChange={upd('haPowerEntityId')} />
              <Field label="Grid Entity ID (optional)" value={settings.haGridEntityId} onChange={upd('haGridEntityId')} />
              <Field label="Max Home Power" value={settings.haMaxHomePowerW} onChange={upd('haMaxHomePowerW')} type="number" unit="W" />
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-1"><Zap size={14} />Proxy &amp; Vehicle</h3>
              <Field label="Proxy URL" value={settings.proxyUrl} onChange={upd('proxyUrl')} />
              <Field label="Vehicle ID" value={settings.vehicleId} onChange={upd('vehicleId')} />
              <h3 className="text-sm font-medium text-evload-muted flex items-center gap-1 pt-2"><Battery size={14} />Charging</h3>
              <Field label="Battery Capacity" value={settings.batteryCapacityKwh} onChange={upd('batteryCapacityKwh')} type="number" unit="kWh" />
              <div className="grid grid-cols-3 gap-2">
                <Field label="Default A" value={settings.defaultAmps} onChange={upd('defaultAmps')} type="number" />
                <Field label="Max A" value={settings.maxAmps} onChange={upd('maxAmps')} type="number" />
                <Field label="Min A" value={settings.minAmps} onChange={upd('minAmps')} type="number" />
              </div>
            </div>
          </div>
          {settingsMsg && (
            <p className={`text-sm ${settingsMsg.includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>{settingsMsg}</p>
          )}
        </div>
      )}

      {/* HA Connect */}
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2"><ExternalLink size={18} />Home Assistant OAuth</h2>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${ha?.connected ? 'bg-evload-success' : 'bg-evload-error'}`} />
          <span className="text-sm">{ha?.connected ? `Connected · ${ha.powerW?.toFixed(0) ?? '—'}W` : 'Not connected'}</span>
        </div>
        <button onClick={handleHaConnect}
          className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
          <ExternalLink size={16} />Connect / Re-authorize
        </button>
      </div>

      {/* YAML Editor */}
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center gap-2"><Activity size={18} />Full Configuration (YAML)</h2>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
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

      {/* Sign Out */}
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6">
        <h2 className="font-semibold text-lg mb-4">Session</h2>
        <button onClick={() => { clearToken(); navigate('/login') }}
          className="flex items-center gap-2 px-4 py-2 bg-evload-border hover:bg-evload-surface text-evload-text rounded-lg font-medium transition-colors">
          <LogOut size={16} />Sign Out
        </button>
      </div>
    </div>
  )
}
