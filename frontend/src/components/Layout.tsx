import React from 'react'
import { NavLink } from 'react-router-dom'
import { Zap, Car, Thermometer, BarChart2, Settings, Wifi, WifiOff, Calendar, Bell, Moon, Sun, SlidersHorizontal, X, Warehouse, Menu } from 'lucide-react'
import { useWsStore } from '../store/wsStore'
import { clsx } from 'clsx'
import { sendVehicleCommand, updateVehicleDataRequest, getVersionInfo } from '../api/index'

interface LayoutProps {
  children: React.ReactNode
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export default function Layout({ children, theme, onToggleTheme }: LayoutProps) {
  const wsConnected = useWsStore((s) => s.connected)
  const demoMode = useWsStore((s) => s.demo)
  const failsafe = useWsStore((s) => s.failsafe)
  const vehicle = useWsStore((s) => s.vehicle)
  const engine = useWsStore((s) => s.engine)
  const simulator = useWsStore((s) => s.simulator)
  const isDemo = demoMode
  const [selectedEndpoint, setSelectedEndpoint] = React.useState('vehicle.vehicle_data')
  const [statusMessage, setStatusMessage] = React.useState('')
  const [simulatorOpen, setSimulatorOpen] = React.useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth >= 1024
  })
  const [busy, setBusy] = React.useState(false)
  const [socInput, setSocInput] = React.useState('45')
  const [actualAmpsInput, setActualAmpsInput] = React.useState('0')
  const [pilotAmpsInput, setPilotAmpsInput] = React.useState('16')
  const [phasesInput, setPhasesInput] = React.useState('1')
  const [chargingStateInput, setChargingStateInput] = React.useState('Connected')
  const [chargeLimitSocInput, setChargeLimitSocInput] = React.useState('80')
  const [voltageInput, setVoltageInput] = React.useState('230')
  const [insideTempInput, setInsideTempInput] = React.useState('18')
  const [outsideTempInput, setOutsideTempInput] = React.useState('12')
  const [climateOn, setClimateOn] = React.useState(false)
  const [pluggedIn, setPluggedIn] = React.useState(true)
  const [currentVersion, setCurrentVersion] = React.useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('evload.sidebarCollapsed') === 'true'
  })
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const hydratedDraftKeyRef = React.useRef<string | null>(null)

  const navItems = React.useMemo(
    () => [
      { to: '/dashboard', icon: Car, label: 'Dashboard' },
      { to: '/garage', icon: Warehouse, label: 'Garage' },
      { to: '/schedule', icon: Calendar, label: 'Schedule' },
      { to: '/climate', icon: Thermometer, label: 'Climate' },
      { to: '/statistics', icon: BarChart2, label: 'Statistics' },
      { to: '/notifications', icon: Bell, label: 'Notifications' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
    []
  )

  React.useEffect(() => {
    window.localStorage.setItem('evload.sidebarCollapsed', sidebarCollapsed ? 'true' : 'false')
  }, [sidebarCollapsed])

  React.useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleMenuToggle = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileMenuOpen((prev) => !prev)
      return
    }
    setSidebarCollapsed((prev) => !prev)
  }

  const renderNavLinks = (onNavigate?: () => void) =>
    navItems.map(({ to, icon: Icon, label }) => (
      <NavLink
        key={to}
        to={to}
        onClick={onNavigate}
        className={({ isActive }) =>
          clsx(
            'flex items-center gap-3 px-4 py-3 mx-2 rounded-xl transition-all',
            isActive
              ? 'bg-gradient-to-r from-evload-accent to-red-700 text-white shadow-md'
              : 'text-evload-muted hover:text-evload-text hover:bg-evload-border/80'
          )
        }
      >
        <Icon size={20} />
        <span className="text-sm font-medium">{label}</span>
      </NavLink>
    ))

  React.useEffect(() => {
    getVersionInfo()
      .then((info) => setCurrentVersion(info.current))
      .catch(() => setCurrentVersion(null))
  }, [])

  const hydrateManualStateFromVehicle = React.useCallback(() => {
    if (!vehicle) return
    setSocInput(String(vehicle.stateOfCharge ?? 45))
    setActualAmpsInput(String(vehicle.chargerActualCurrent ?? 0))
    setPilotAmpsInput(String(vehicle.chargerPilotCurrent ?? 16))
    setPhasesInput(String(vehicle.chargerPhases ?? 1))
    setChargingStateInput(String(vehicle.chargingState ?? 'Connected'))
    setChargeLimitSocInput(String(vehicle.chargeLimitSoc ?? 80))
    setVoltageInput(String(vehicle.chargerVoltage ?? 230))
    setInsideTempInput(String(vehicle.insideTempC ?? 18))
    setOutsideTempInput(String(vehicle.outsideTempC ?? 12))
    setClimateOn(Boolean(vehicle.climateOn))
    setPluggedIn(Boolean(vehicle.pluggedIn))
  }, [vehicle])

  const sortedResponses = React.useMemo(() => {
    const entries = simulator?.lastResponses ?? []
    return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [simulator])

  const endpointOptions = React.useMemo(() => {
    const defaults = [
      'vehicle.vehicle_data',
      'vehicle.charge_state',
      'vehicle.climate_state',
      'command.charge_start',
      'command.charge_stop',
      'command.set_charging_amps',
      'command.set_temps',
      'command.wake_up',
      'command.sleep',
    ]
    const fromResponses = sortedResponses.map((entry) => entry.endpointKey)
    const merged = new Set([...defaults, ...fromResponses])
    return Array.from(merged)
  }, [sortedResponses])

  const selectedRecord = React.useMemo(
    () => sortedResponses.find((entry) => entry.endpointKey === selectedEndpoint),
    [sortedResponses, selectedEndpoint]
  )

  React.useEffect(() => {
    if (!endpointOptions.includes(selectedEndpoint) && endpointOptions.length > 0) {
      setSelectedEndpoint(endpointOptions[0] ?? 'vehicle.vehicle_data')
    }
  }, [endpointOptions, selectedEndpoint])

  React.useEffect(() => {
    if (!vehicle) return
    const identityKey = `${vehicle.vin ?? ''}::${vehicle.displayName ?? ''}`
    if (hydratedDraftKeyRef.current === identityKey) return
    hydratedDraftKeyRef.current = identityKey
    hydrateManualStateFromVehicle()
  }, [vehicle, hydrateManualStateFromVehicle])

  const applyManualState = async () => {
    setBusy(true)
    setStatusMessage('')
    try {
      await updateVehicleDataRequest('charge_state', {
        battery_level: Number(socInput),
        charging_state: chargingStateInput,
        charge_limit_soc: Number(chargeLimitSocInput),
        charger_voltage: Number(voltageInput),
        charger_actual_current: Number(actualAmpsInput),
        charger_pilot_current: Number(pilotAmpsInput),
        charger_phases: Number(phasesInput),
        plugged_in: pluggedIn,
      })
      await updateVehicleDataRequest('climate_state', {
        inside_temp: Number(insideTempInput),
        outside_temp: Number(outsideTempInput),
        is_climate_on: climateOn,
      })
      setSelectedEndpoint('vehicle.charge_state')
      setStatusMessage('Manual state applied to simulator responses')
    } catch {
      setStatusMessage('Failed to apply manual state')
    } finally {
      setBusy(false)
    }
  }

  const runCommand = async (cmd: string, body?: Record<string, unknown>) => {
    setStatusMessage('')
    setBusy(true)
    try {
      await sendVehicleCommand(cmd, body)
      setStatusMessage(`Command ${cmd} applied`)
    } catch {
      setStatusMessage(`Command ${cmd} failed`)
    } finally {
      setBusy(false)
    }
  }

  const selectedJson = React.useMemo(() => {
    if (!selectedRecord) return '{\n  "note": "No payload yet"\n}'
    try {
      return JSON.stringify(selectedRecord.payload, null, 2)
    } catch {
      return '{\n  "note": "Payload not serializable"\n}'
    }
  }, [selectedRecord])

  const engineExpectationHint = React.useMemo(() => {
    if (!engine) return 'Engine status unavailable'
    const chargingStateNormalized = chargingStateInput.toLowerCase()
    const isChargingFromState = chargingStateNormalized.includes('charging')
    const engineWantsCharging = engine.mode !== 'off' && engine.phase !== 'complete' && engine.phase !== 'paused'
    if (engineWantsCharging && !isChargingFromState) {
      return 'Engine expected charging but charging_state is not Charging'
    }
    if (!engineWantsCharging && isChargingFromState) {
      return 'Vehicle reports Charging while engine is not requesting charge'
    }
    return 'Engine and charging_state are aligned'
  }, [engine, chargingStateInput])

  const simulatorPanel = (
    <>
      <div>
        <h2 className="text-sm font-semibold">Simulator Endpoints</h2>
        <p className="text-xs text-evload-muted">Latest JSON served to backend per endpoint.</p>
      </div>

      <div className="space-y-2 max-h-48 overflow-auto pr-1">
        {sortedResponses.length === 0 && (
          <div className="text-xs text-evload-muted bg-evload-bg border border-evload-border rounded p-2">
            No endpoint payload yet.
          </div>
        )}
        {sortedResponses.map((entry) => (
          <button
            key={`${entry.endpointKey}-${entry.timestamp}`}
            onClick={() => setSelectedEndpoint(entry.endpointKey)}
            className={clsx(
              'w-full text-left px-2 py-2 rounded border text-xs',
              selectedEndpoint === entry.endpointKey
                ? 'border-evload-accent bg-evload-bg'
                : 'border-evload-border hover:border-evload-accent/60'
            )}
          >
            <div className="font-medium truncate">{entry.endpointKey}</div>
            <div className="text-evload-muted">{new Date(entry.timestamp).toLocaleTimeString()} • {entry.source}</div>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-xs text-evload-muted">Selected endpoint</label>
        <select
          value={selectedEndpoint}
          onChange={(e) => setSelectedEndpoint(e.target.value)}
          className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2 text-sm"
        >
          {endpointOptions.map((key) => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-evload-muted">Last response JSON</label>
        <textarea
          readOnly
          value={selectedJson}
          className="w-full h-40 bg-evload-bg border border-evload-border rounded p-2 text-xs font-mono"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-evload-muted">Vehicle Controls (demo)</label>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="space-y-1">
            <span className="text-evload-muted">State of Charge (%)</span>
            <input value={socInput} onChange={(e) => setSocInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="text-evload-muted">Charging State</span>
            <input value={chargingStateInput} onChange={(e) => setChargingStateInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>

          <label className="space-y-1">
            <span className="text-evload-muted">Charge Limit SoC (%)</span>
            <input value={chargeLimitSocInput} onChange={(e) => setChargeLimitSocInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>

          <label className="space-y-1">
            <span className="text-evload-muted">Actual Current (A)</span>
            <input value={actualAmpsInput} onChange={(e) => setActualAmpsInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="text-evload-muted">Pilot Current (A)</span>
            <input value={pilotAmpsInput} onChange={(e) => setPilotAmpsInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>

          <label className="space-y-1">
            <span className="text-evload-muted">Charger Voltage (V)</span>
            <input value={voltageInput} onChange={(e) => setVoltageInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="text-evload-muted">Charger Phases</span>
            <input value={phasesInput} onChange={(e) => setPhasesInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>

          <label className="space-y-1">
            <span className="text-evload-muted">Inside Temperature (C)</span>
            <input value={insideTempInput} onChange={(e) => setInsideTempInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="text-evload-muted">Outside Temperature (C)</span>
            <input value={outsideTempInput} onChange={(e) => setOutsideTempInput(e.target.value)} className="w-full bg-evload-bg border border-evload-border rounded px-2 py-2" />
          </label>
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => setPluggedIn((v) => !v)} disabled={busy} className="flex-1 px-2 py-2 bg-evload-border rounded">
            Plugged: {pluggedIn ? 'Yes' : 'No'}
          </button>
          <button onClick={() => setClimateOn((v) => !v)} disabled={busy} className="flex-1 px-2 py-2 bg-evload-border rounded">
            Climate: {climateOn ? 'On' : 'Off'}
          </button>
        </div>
        <div className="text-xs text-evload-muted bg-evload-bg border border-evload-border rounded px-2 py-2">
          {engineExpectationHint}
        </div>
        <button onClick={hydrateManualStateFromVehicle} disabled={busy || !vehicle} className="w-full px-3 py-2 bg-evload-border rounded text-sm disabled:opacity-50">
          Sync Inputs From Live State
        </button>
        <button onClick={applyManualState} disabled={busy} className="w-full px-3 py-2 bg-evload-accent hover:bg-red-700 text-white rounded text-sm disabled:opacity-50">
          Apply Manual State
        </button>
        <div className="flex gap-2 text-xs">
          <button onClick={() => runCommand('charge_start')} disabled={busy} className="flex-1 px-2 py-2 bg-evload-accent text-white rounded">Start</button>
          <button onClick={() => runCommand('charge_stop')} disabled={busy} className="flex-1 px-2 py-2 bg-evload-border rounded">Stop</button>
          <button onClick={() => runCommand('sleep')} disabled={busy} className="flex-1 px-2 py-2 bg-evload-border rounded">Sleep</button>
          <button onClick={() => runCommand('wake_up')} disabled={busy} className="flex-1 px-2 py-2 bg-evload-border rounded">Wake</button>
        </div>
        {statusMessage && <div className="text-xs text-evload-muted">{statusMessage}</div>}
      </div>
    </>
  )

  return (
    <div
      className="min-h-screen text-evload-text flex flex-col"
      style={{
        background:
          'radial-gradient(1200px circle at 20% -20%, rgba(239,68,68,0.16), transparent 40%), radial-gradient(900px circle at 100% 0%, rgba(14,165,233,0.12), transparent 35%), var(--ev-bg)',
      }}
    >
      {failsafe?.active && (
        <div className="bg-evload-error text-white px-4 py-2 text-sm text-center font-medium">
          ⚠️ FAILSAFE ACTIVE: {failsafe.reason} — Use Tesla app manually
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-evload-border/60 bg-evload-bg/95 px-4 py-4 backdrop-blur sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleMenuToggle}
            className="p-2 mr-2 rounded-lg bg-evload-bg border border-evload-border hover:bg-evload-border transition-colors text-evload-text"
            title="Toggle menu"
          >
            <Menu size={18} />
          </button>
          <Zap className="text-evload-accent" size={24} />
          <span className="text-xl font-bold">evload</span>
          <span className="ml-1 rounded border border-evload-border bg-evload-bg px-1.5 py-0.5 text-[10px] font-semibold text-evload-muted">
            {currentVersion ? `v${currentVersion}` : 'v—'}
          </span>
          {isDemo && (
            <span className="ml-2 px-2 py-0.5 text-xs font-bold bg-evload-warning/20 text-evload-warning border border-evload-warning rounded">
              DEMO
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {wsConnected ? (
            <><Wifi size={16} className="text-evload-success" /><span className="text-evload-success">Live</span></>
          ) : (
            <><WifiOff size={16} className="text-evload-error" /><span className="text-evload-error">Offline</span></>
          )}
          {isDemo && (
            <button
              onClick={() => setSimulatorOpen(true)}
              className="p-2 ml-2 rounded-lg bg-evload-bg border border-evload-border hover:bg-evload-border transition-colors text-evload-text"
              title="Open simulator"
            >
              <SlidersHorizontal size={18} />
            </button>
          )}
          <button
            onClick={onToggleTheme}
            className="p-2 ml-4 rounded-lg bg-evload-bg border border-evload-border hover:bg-evload-border transition-colors text-evload-text"
            title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <nav
          className={clsx(
            'hidden lg:flex border-r border-evload-border/70 bg-evload-surface/80 backdrop-blur flex-col py-4 gap-1 transition-all duration-200 overflow-hidden',
            sidebarCollapsed ? 'w-0 border-r-0 p-0' : 'w-56'
          )}
        >
          {!sidebarCollapsed && renderNavLinks()}
        </nav>
        <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
        {isDemo && simulatorOpen && (
          <aside className="hidden lg:block w-[380px] border-l border-evload-border/70 bg-evload-surface/80 backdrop-blur p-4 space-y-4 overflow-auto shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Simulator Panel</h2>
              <button
                onClick={() => setSimulatorOpen(false)}
                className="p-2 rounded-lg bg-evload-bg border border-evload-border hover:bg-evload-border"
                title="Close simulator"
              >
                <X size={16} />
              </button>
            </div>
            {simulatorPanel}
          </aside>
        )}
      </div>

      {isDemo && simulatorOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setSimulatorOpen(false)}>
          <div className="absolute inset-x-0 top-0 h-[90vh] bg-evload-surface/95 border-b border-evload-border rounded-b-2xl p-4 overflow-auto backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Simulator Panel</h2>
              <button
                onClick={() => setSimulatorOpen(false)}
                className="p-2 rounded-lg bg-evload-bg border border-evload-border hover:bg-evload-border"
                title="Close simulator"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">{simulatorPanel}</div>
          </div>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <aside
            className="absolute left-0 top-0 h-full w-72 bg-evload-surface/95 border-r border-evload-border py-4 backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pb-3 text-xs uppercase tracking-wider text-evload-muted">Navigation</div>
            {renderNavLinks(() => setMobileMenuOpen(false))}
          </aside>
        </div>
      )}
    </div>
  )
}
