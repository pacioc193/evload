import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { api } from './api.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import { StatusBar } from './components/StatusBar.jsx'
import { VehicleCard } from './components/VehicleCard.jsx'
import { ChargingSchedules } from './components/ChargingSchedules.jsx'
import { ClimateSchedules } from './components/ClimateSchedules.jsx'
import { Settings } from './components/Settings.jsx'
import { YamlEditor } from './components/YamlEditor.jsx'

const TABS = ['Dashboard', 'Charging', 'Climate', 'Settings', 'YAML']

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [config, setConfig] = useState(null)
  const [yaml, setYaml] = useState('')
  const { vehicleState, chargingStatus, connected } = useWebSocket()
  const saveTimer = useRef(null)

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    try {
      const [cfg, rawYaml] = await Promise.all([api.getConfig(), api.getYaml()])
      setConfig(cfg)
      setYaml(rawYaml)
    } catch (e) {
      toast.error('Failed to load config')
    }
  }

  function handleConfigUpdate(updates) {
    const merged = deepMerge(config, updates)
    setConfig(merged)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await api.updateConfig(updates)
        setConfig(updated)
        const rawYaml = await api.getYaml()
        setYaml(rawYaml)
        toast.success('Config saved')
      } catch (e) {
        toast.error('Failed to save config')
      }
    }, 800)
  }

  async function handleYamlSave(newYaml) {
    const updated = await api.setYaml(newYaml)
    setConfig(updated)
    setYaml(newYaml)
    toast.success('YAML saved')
  }

  async function handleStartCharging() {
    try { await api.startCharging(); toast.success('Charging started') }
    catch (e) { toast.error(e.message) }
  }
  async function handleStopCharging() {
    try { await api.stopCharging(); toast.success('Charging stopped') }
    catch (e) { toast.error(e.message) }
  }
  async function handleStartClimate() {
    try { await api.startClimate(); toast.success('Climate started') }
    catch (e) { toast.error(e.message) }
  }
  async function handleStopClimate() {
    try { await api.stopClimate(); toast.success('Climate stopped') }
    catch (e) { toast.error(e.message) }
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400 animate-pulse">Loading EVLoad…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <StatusBar connected={connected} vehicleState={vehicleState} config={config} />
      <nav className="bg-gray-900 border-b border-gray-800 px-6">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
              {tab}
            </button>
          ))}
        </div>
      </nav>
      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {activeTab === 'Dashboard' && (
          <div className="space-y-6">
            <VehicleCard
              vehicleState={vehicleState}
              onStartCharging={handleStartCharging}
              onStopCharging={handleStopCharging}
              onStartClimate={handleStartClimate}
              onStopClimate={handleStopClimate}
            />
            {chargingStatus && (
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <h2 className="text-lg font-semibold mb-3 text-gray-100">Charging Engine</h2>
                <pre className="text-sm text-gray-300 font-mono bg-gray-800 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(chargingStatus, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
        {activeTab === 'Charging' && (
          <ChargingSchedules
            charging={config.charging}
            onUpdate={charging => handleConfigUpdate({ charging })}
          />
        )}
        {activeTab === 'Climate' && (
          <ClimateSchedules
            climate={config.climate}
            onUpdate={climate => handleConfigUpdate({ climate })}
          />
        )}
        {activeTab === 'Settings' && (
          <Settings config={config} onUpdate={handleConfigUpdate} />
        )}
        {activeTab === 'YAML' && (
          <YamlEditor yaml={yaml} onSave={handleYamlSave} />
        )}
      </main>
    </div>
  )
}

function deepMerge(target, source) {
  if (!target) return source
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
