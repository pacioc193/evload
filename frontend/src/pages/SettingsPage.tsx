import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { getConfig, saveConfig, getHaAuthorizeUrl } from '../api/index'
import { Settings, ExternalLink, Save, LogOut } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'
import { useWsStore } from '../store/wsStore'

export default function SettingsPage() {
  const [configContent, setConfigContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const clearToken = useAuthStore((s) => s.clearToken)
  const navigate = useNavigate()
  const ha = useWsStore((s) => s.ha)

  useEffect(() => {
    getConfig().then((d) => setConfigContent(d.content)).catch(console.error)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await saveConfig(configContent)
      setMessage('Config saved successfully')
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2"><ExternalLink size={18} />Home Assistant</h2>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${ha?.connected ? 'bg-evload-success' : 'bg-evload-error'}`} />
          <span className="text-sm">{ha?.connected ? 'Connected' : 'Not connected'}</span>
        </div>
        <button onClick={handleHaConnect}
          className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
          <ExternalLink size={16} />Connect Home Assistant
        </button>
      </div>

      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center gap-2"><Settings size={18} />Configuration (YAML)</h2>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            <Save size={16} />{saving ? 'Saving...' : 'Save'}
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
