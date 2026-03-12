import Editor from '@monaco-editor/react'
import { useState } from 'react'

export function YamlEditor({ yaml, onSave }) {
  const [value, setValue] = useState(yaml)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-gray-100">Raw YAML Config</h2>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save YAML'}
          </button>
        </div>
      </div>
      <Editor
        height="400px"
        language="yaml"
        theme="vs-dark"
        value={value}
        onChange={v => setValue(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        }}
      />
    </div>
  )
}
