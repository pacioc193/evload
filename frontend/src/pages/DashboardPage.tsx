import React, { useState, useEffect } from 'react'
import { useWsStore } from '../store/wsStore'
import { startCharging, stopCharging, getScheduledCharges, setPlanMode } from '../api/index'
import { WifiOff, Car, Thermometer, Gauge, Plug, Clock3, Home, Zap as ZapIcon } from 'lucide-react'
import { clsx } from 'clsx'

type ChargeMode = 'off' | 'plan' | 'on'

function EvccSocBar({
  actualSoc,
  targetSoc,
  charging,
  onTargetChange,
}: {
  actualSoc: number
  targetSoc: number
  charging: boolean
  onTargetChange: (value: number) => void
}) {
  const safeActual = Math.max(0, Math.min(100, actualSoc))
  const safeTarget = Math.max(0, Math.min(100, targetSoc))

  const handleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    onTargetChange(Math.round(Math.max(0, Math.min(1, ratio)) * 100))
  }

  const plannedStart = Math.min(safeActual, safeTarget)
  const plannedEnd = Math.max(safeActual, safeTarget)
  const plannedWidth = plannedEnd - plannedStart

  return (
    <div
      className="relative h-8 rounded-lg bg-evload-bg border border-evload-border overflow-visible cursor-pointer"
      onClick={handleClick}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeTarget}
      aria-label="Target SoC"
    >
      <div
        className={clsx('absolute top-0 left-0 h-full bg-evload-success transition-all', charging && 'animate-pulse')}
        style={{ width: `${safeActual}%` }}
      />

      {plannedWidth > 0 && (
        <div
          className="absolute top-0 h-full border-l border-r border-evload-success/60 bg-[repeating-linear-gradient(135deg,rgba(34,197,94,0.1)_0_8px,rgba(34,197,94,0.2)_8px_16px)]"
          style={{ left: `${plannedStart}%`, width: `${plannedWidth}%` }}
        />
      )}

      <div
        className="absolute -top-3 h-14 w-3 rounded-full bg-evload-success shadow-lg border border-evload-bg"
        style={{ left: `calc(${safeTarget}% - 6px)` }}
        title={`Target ${safeTarget}%`}
      />
    </div>
  )
}

function ModePill({
  active,
  label,
  onClick,
  disabled,
}: {
  active: boolean
  label: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'px-3 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-60',
        active ? 'bg-evload-border text-evload-text shadow-sm' : 'text-evload-muted hover:bg-evload-border/50 hover:text-evload-text'
      )}
    >
      {label}
    </button>
  )
}

export default function DashboardPage() {
  const vehicle = useWsStore((s) => s.vehicle)
  const engine = useWsStore((s) => s.engine)
  const ha = useWsStore((s) => s.ha)
  const failsafe = useWsStore((s) => s.failsafe)
  const wsConnected = useWsStore((s) => s.connected)
  const demo = useWsStore((s) => s.demo)
  const [targetSoc, setTargetSoc] = useState(80)
  const [chargeMode, setChargeMode] = useState<ChargeMode>(
    () => (useWsStore.getState().engine?.mode as ChargeMode | undefined) ?? 'off'
  )
  const [loading, setLoading] = useState(false)
  const [nextStartTime, setNextStartTime] = useState<string | null>(null)

  useEffect(() => {
    if (engine?.mode) setChargeMode(engine.mode as ChargeMode)
  }, [engine?.mode])

  useEffect(() => {
    if (!wsConnected) return
    const poll = () => {
      getScheduledCharges().then(charges => {
        const enabled = charges.filter(c => c.enabled)
        if (enabled.length === 0) {
          setNextStartTime(null)
          return
        }
        const now = new Date().getTime()
        const future = enabled
          .map(c => ({
            time: c.scheduleType === 'start_at' && c.scheduledAt ? new Date(c.scheduledAt).getTime() : 0,
            label: 'Start'
          }))
          .filter(c => c.time > now)
          .sort((a, b) => a.time - b.time)
        
        if (future.length > 0) {
          setNextStartTime(new Date(future[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        } else {
          setNextStartTime(null)
        }
      }).catch(console.error)
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [wsConnected])

  const soc = Math.max(0, Math.min(100, vehicle?.stateOfCharge ?? 0))
  const homeW = Math.max(0, ha?.powerW ?? 0)
  const gridW = Math.max(0, ha?.gridW ?? 0)
  const vehicleW = Math.max(0, Math.round((vehicle?.chargeRateKw ?? 0) * 1000))
  const autoW = gridW - vehicleW
  const houseW = Math.max(0, homeW - vehicleW)
  const priceCt = 9.6

  const applyMode = async (mode: ChargeMode) => {
    setChargeMode(mode)
    setLoading(true)
    try {
      if (mode === 'off') {
        await stopCharging()
      } else if (mode === 'plan') {
        await setPlanMode(Math.max(1, targetSoc))
      } else {
        await startCharging(Math.max(1, targetSoc))
      }
    } finally {
      setLoading(false)
    }
  }

  if (!wsConnected && !vehicle) {
    return (
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center space-y-2">
        <div className="flex items-center justify-center gap-2 text-evload-muted">
          <WifiOff size={20} />
          <span>Connecting to backend...</span>
        </div>
      </div>
    )
  }

  if (!vehicle?.connected) {
    return (
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">
        Vehicle not connected
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">
      {demo && (
        <div className="bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-bold uppercase tracking-widest rounded-lg px-3 py-2 text-center">
          Demo Mode Active — Simulated Data
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-4 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-wider text-evload-muted font-bold flex items-center gap-1.5 mb-1">
             <Home size={10} /> Actual Grid
          </div>
          <div className="text-3xl font-black text-evload-text">
            {(gridW / 1000).toFixed(1)} <span className="text-xs font-normal">kW</span>
          </div>
          <div className="text-[10px] text-evload-muted mt-1 italic">Real-time grid consumption</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-4 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-wider text-evload-muted font-bold flex items-center gap-1.5 mb-1">
            <ZapIcon size={10} /> Auto Power
          </div>
          <div className="text-3xl font-black text-evload-text">
            {(autoW / 1000).toFixed(1)} <span className="text-xs font-normal">kW</span>
          </div>
          <div className="text-[10px] text-evload-muted mt-1 italic">Grid - Charger</div>
        </div>
      </div>

      <div className="bg-evload-surface border border-evload-border rounded-3xl p-4 sm:p-5 text-evload-text">
        <div className="rounded-full border border-evload-border bg-evload-bg p-1 flex items-center justify-between">
          <ModePill active={chargeMode === 'off'} label="Off" onClick={() => applyMode('off')} disabled={loading || !!failsafe?.active} />
          <ModePill active={chargeMode === 'plan'} label="Plan" onClick={() => applyMode('plan')} disabled={loading || !!failsafe?.active} />
          <ModePill active={chargeMode === 'on'} label="On" onClick={() => applyMode('on')} disabled={loading || !!failsafe?.active} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted">Power</div>
            <div className="mt-1 text-2xl font-semibold">{(vehicle?.chargeRateKw ?? 0).toFixed(1)} <span className="text-base text-evload-muted">kW</span></div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted">Next Charge</div>
            <div className="mt-1 text-2xl font-semibold flex items-center justify-center gap-1.5">
               {nextStartTime ? (
                 <>
                   <Clock3 size={18} className="text-evload-accent" />
                   {nextStartTime}
                 </>
               ) : (
                 <span className="text-sm text-evload-muted font-normal lowercase italic">— no schedule —</span>
               )}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted underline underline-offset-2">Price</div>
            <div className="mt-1 text-2xl font-semibold">{priceCt.toFixed(1)} <span className="text-base text-evload-muted">ct</span></div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-evload-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold flex items-center gap-2"><Car size={18} /> {vehicle.displayName ?? 'Vehicle'}</h2>
              <p className="text-sm text-evload-muted mt-1">{vehicle.charging ? 'Charging...' : vehicle.pluggedIn ? 'Connected' : 'Disconnected'}</p>
            </div>
            <div className="text-right text-xs text-evload-muted">
              <div>VIN</div>
              <div className="font-mono text-[11px] text-evload-text">{vehicle.vin ?? '-'}</div>
            </div>
          </div>

          <div className="mt-4">
            <EvccSocBar
              actualSoc={soc}
              targetSoc={targetSoc}
              charging={vehicle.charging}
              onTargetChange={setTargetSoc}
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="text-left">
              <div className="text-xs uppercase tracking-wide text-evload-muted">Charge</div>
              <div className="text-4xl font-semibold leading-none mt-1">{soc}%</div>
              <div className="text-sm text-evload-muted mt-1">{vehicle.batteryRange?.toFixed(0) ?? '0'} km</div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-evload-muted">Plan</div>
              <div className="text-4xl font-semibold leading-none mt-1 underline underline-offset-4">{engine?.phase ?? 'none'}</div>
              <div className="text-sm text-evload-muted mt-1 capitalize">{engine?.message ?? 'idle'}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-evload-muted">Limit</div>
              <div className="text-4xl font-semibold leading-none mt-1">{targetSoc}%</div>
              <div className="text-sm text-evload-muted mt-1">{Math.round((targetSoc / 100) * 422)} km</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Current</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text flex items-center gap-1"><Gauge size={14} />{vehicle.chargerActualCurrent ?? 0}A</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Desired Current</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text flex items-center gap-1"><Gauge size={14} />{vehicle.chargerPilotCurrent ?? 0}A</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Voltage</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text">{vehicle.chargerVoltage ?? 0}V</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Phases</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text">{vehicle.chargerPhases ?? 0}</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Inside</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text flex items-center gap-1"><Thermometer size={14} />{vehicle.insideTempC?.toFixed(1) ?? '-'}C</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Outside</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text flex items-center gap-1"><Thermometer size={14} />{vehicle.outsideTempC?.toFixed(1) ?? '-'}C</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Time Full</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text flex items-center gap-1"><Clock3 size={14} />{vehicle.timeToFullChargeH?.toFixed(1) ?? '-'}h</div>
        </div>
        <div className="bg-evload-surface border border-evload-border rounded-2xl p-3">
          <div className="text-xs uppercase tracking-wide text-evload-muted">Grid Home</div>
          <div className="mt-1 text-2xl font-semibold text-evload-text flex items-center gap-1"><Home size={14} />{ha?.gridW != null ? (ha.gridW / 1000).toFixed(1) : '-'}kW</div>
        </div>
      </div>

      <div className="text-sm text-evload-text/85 bg-evload-surface border border-evload-border rounded-2xl px-4 py-3">
        <span className="inline-flex items-center gap-1 mr-3"><Plug size={14} />Plug: {vehicle.pluggedIn ? 'plugged in' : 'unplugged'}</span>
        <span className="inline-flex items-center gap-1 mr-3"><Thermometer size={14} />Climate: {vehicle.climateOn ? 'on' : 'off'}</span>
        <span className="inline-flex items-center gap-1 mr-3"><Home size={14} />Home: {(homeW / 1000).toFixed(1)} kW</span>
        <span className="inline-flex items-center gap-1">House: {(houseW / 1000).toFixed(1)} kW</span>
      </div>

      <div className="bg-evload-surface border border-evload-border rounded-3xl p-4 sm:p-5 space-y-3">
        <h2 className="font-semibold text-lg">Engine Live Log</h2>
        <div className="bg-evload-bg border border-evload-border rounded-xl p-3 h-56 overflow-auto font-mono text-xs leading-5">
          {(engine?.debugLog?.length ?? 0) === 0 ? (
            <div className="text-evload-muted">No logs yet. Start charging control to see engine actions.</div>
          ) : (
            (engine?.debugLog ?? []).map((line, idx) => (
              <div key={`${idx}-${line}`} className="text-evload-text">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
