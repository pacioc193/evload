import React, { useState, useEffect, useRef } from 'react'
import { useWsStore } from '../store/wsStore'
import { startCharging, stopCharging, setPlanMode, wakeVehicle, getNextPlannedCharge, NextPlannedCharge } from '../api/index'
import { WifiOff, Car, Clock3, Home, Zap as ZapIcon, ChevronDown, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'

type ChargeMode = 'off' | 'plan' | 'on'

function computeTimeToTargetH(params: {
  machineHours: number | null
  stateOfCharge: number
  desiredTargetSoc: number
  carLimitSoc: number | null
  chargeRateKw: number
  batteryCapacityKwh: number
}): { hours: number | null; error: string | null } {
  const { machineHours, stateOfCharge, desiredTargetSoc, carLimitSoc, chargeRateKw, batteryCapacityKwh } = params
  const clampedDesired = Math.max(0, Math.min(100, desiredTargetSoc))
  const clampedSoc = Math.max(0, Math.min(100, stateOfCharge))

  if (carLimitSoc != null && clampedDesired > carLimitSoc) {
    return { hours: null, error: `Target ${clampedDesired}% exceeds car limit ${carLimitSoc}%` }
  }
  if (clampedDesired <= clampedSoc) {
    return { hours: 0, error: null }
  }
  if (carLimitSoc != null && clampedDesired === carLimitSoc && machineHours != null) {
    return { hours: machineHours, error: null }
  }
  if (machineHours != null && carLimitSoc != null && carLimitSoc > clampedSoc && clampedDesired < carLimitSoc) {
    const ratio = (clampedDesired - clampedSoc) / (carLimitSoc - clampedSoc)
    return { hours: Number((machineHours * ratio).toFixed(2)), error: null }
  }
  if (chargeRateKw > 0 && batteryCapacityKwh > 0) {
    const remainingEnergyKwh = ((clampedDesired - clampedSoc) / 100) * batteryCapacityKwh
    return { hours: Number((remainingEnergyKwh / chargeRateKw).toFixed(2)), error: null }
  }
  return { hours: null, error: null }
}

function EvccSocBar({
  actualSoc,
  targetSoc,
  carLimitSoc,
  charging,
  readonly,
  onTargetChange,
}: {
  actualSoc: number
  targetSoc: number
  carLimitSoc: number | null
  charging: boolean
  readonly: boolean
  onTargetChange: (value: number) => void
}) {
  const safeActual = Math.max(0, Math.min(100, actualSoc))
  const safeTarget = Math.max(0, Math.min(100, targetSoc))
  const safeCarLimit = carLimitSoc == null ? null : Math.max(0, Math.min(100, carLimitSoc))
  const plannedStart = Math.min(safeActual, safeTarget)
  const plannedWidth = Math.max(safeActual, safeTarget) - plannedStart
  const sliderRef = useRef<HTMLDivElement>(null)

  const resolveRatio = (clientX: number) => {
    if (!sliderRef.current) return
    const rect = sliderRef.current.getBoundingClientRect()
    onTargetChange(Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100))
  }

  const handleClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    resolveRatio(e.clientX)
  }

  const handleMouseDown: React.MouseEventHandler<HTMLDivElement> = () => {
    if (readonly) return
    const onMove = (e: MouseEvent) => resolveRatio(e.clientX)
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={sliderRef}
      className={clsx(
        'relative h-8 rounded-lg bg-evload-bg border border-evload-border overflow-visible',
        readonly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeTarget}
      aria-label="Target SoC"
      aria-readonly={readonly}
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
      {safeCarLimit != null && (
        <div
          className="absolute top-0 h-full w-[2px] bg-amber-400"
          style={{ left: `calc(${safeCarLimit}% - 1px)` }}
          title={`Car limit ${safeCarLimit}%`}
        />
      )}
    </div>
  )
}

function ModePill({ active, label, onClick, disabled }: {
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
        active
          ? 'bg-evload-border text-evload-text shadow-sm'
          : 'text-evload-muted hover:bg-evload-border/50 hover:text-evload-text'
      )}
    >
      {label}
    </button>
  )
}

function FlowStatRow({ icon, label, value, accentClass }: {
  icon: React.ReactNode
  label: string
  value: string
  accentClass: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-evload-border bg-evload-bg/60 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={clsx('inline-flex h-7 w-7 items-center justify-center rounded-full', accentClass)}>
          {icon}
        </span>
        <span className="text-sm text-evload-text truncate">{label}</span>
      </div>
      <span className="text-sm font-semibold text-evload-text whitespace-nowrap">{value}</span>
    </div>
  )
}

function VehicleRawProxyPanel({ rawChargeState }: { rawChargeState: Record<string, unknown> | null | undefined }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-evload-surface border border-evload-border rounded-3xl p-4 sm:p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        {expanded
          ? <ChevronDown size={16} className="text-evload-muted flex-shrink-0" />
          : <ChevronRight size={16} className="text-evload-muted flex-shrink-0" />
        }
        <span className="font-semibold text-lg text-evload-text">Vehicle Details</span>
        <span className="ml-2 text-xs text-evload-muted">Raw proxy response — inspect unexpected vehicle state</span>
      </button>
      {expanded && (
        <pre className="mt-4 text-[11px] text-evload-text bg-evload-bg border border-evload-border rounded-xl p-3 overflow-auto max-h-96 font-mono leading-5">
          {rawChargeState != null
            ? JSON.stringify(rawChargeState, null, 2)
            : 'No data received from proxy yet.'}
        </pre>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const vehicle = useWsStore((s) => s.vehicle)
  const pollMode = useWsStore((s) => s.pollMode)
  const engine = useWsStore((s) => s.engine)
  const ha = useWsStore((s) => s.ha)
  const failsafe = useWsStore((s) => s.failsafe)
  const charging = useWsStore((s) => s.charging)
  const wsConnected = useWsStore((s) => s.connected)
  const wsLastUpdate = useWsStore((s) => s.lastUpdate)
  const demo = useWsStore((s) => s.demo)

  const [manualTargetSoc, setManualTargetSoc] = useState(80)
  const seededFromCarRef = useRef(false)
  const [chargeMode, setChargeMode] = useState<ChargeMode>(
    () => (useWsStore.getState().engine?.mode as ChargeMode | undefined) ?? 'off'
  )
  const [loading, setLoading] = useState(false)
  const [waking, setWaking] = useState(false)
  const [nextCharge, setNextCharge] = useState<NextPlannedCharge | null>(null)
  const [integratedEnergyKwh, setIntegratedEnergyKwh] = useState(0)
  const integrationRef = useRef<{ lastTsMs: number | null }>({ lastTsMs: null })

  useEffect(() => {
    if (!engine?.mode) return
    if (engine.mode === 'off' || engine.mode === 'plan') {
      setChargeMode(engine.mode as ChargeMode)
      return
    }
    setChargeMode((prev) => (prev === 'plan' && nextCharge ? 'plan' : 'on'))
  }, [engine?.mode, nextCharge])

  useEffect(() => {
    if (seededFromCarRef.current) return
    if (vehicle?.chargeLimitSoc == null) return
    setManualTargetSoc(vehicle.chargeLimitSoc)
    seededFromCarRef.current = true
  }, [vehicle?.chargeLimitSoc])

  useEffect(() => {
    if (!wsConnected) return
    const poll = () => {
      getNextPlannedCharge().then(setNextCharge).catch(() => setNextCharge(null))
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [wsConnected])

  const soc = Math.max(0, Math.min(100, vehicle?.stateOfCharge ?? 0))
  const carLimitSoc = vehicle?.chargeLimitSoc ?? null
  const isPlanMode = chargeMode === 'plan'
  const effectiveTargetSoc = isPlanMode
    ? (nextCharge?.targetSoc ?? engine?.targetSoc ?? manualTargetSoc)
    : manualTargetSoc

  const chargePowerKw = Math.max(0, vehicle?.chargeRateKw ?? 0)
  const chargerPowerW = Math.max(0, Math.round(chargePowerKw * 1000))
  const homeTotalPowerW = Math.max(0, ha?.powerW ?? 0)
  const homeNonChargingPowerW = Math.max(0, homeTotalPowerW - chargerPowerW)
  const refPowerW = Math.max(homeNonChargingPowerW + chargerPowerW, 1)
  const homeBaseLoadSharePct = Math.max(0, Math.min(100, (homeNonChargingPowerW / refPowerW) * 100))
  const chargerLoadSharePct = Math.max(0, Math.min(100, (chargerPowerW / refPowerW) * 100))
  const energyPriceEurPerKwh = Math.max(0, charging?.energyPriceEurPerKwh ?? 0.3)
  const batteryCapacityKwh = Math.max(1, charging?.batteryCapacityKwh ?? 75)
  const rawChargeEnergyAdded = vehicle?.rawChargeState?.charge_energy_added
  const backendChargeEnergyKwh = typeof rawChargeEnergyAdded === 'number'
    ? rawChargeEnergyAdded
    : (typeof rawChargeEnergyAdded === 'string' ? Number(rawChargeEnergyAdded) : null)
  const validBackendEnergyKwh = backendChargeEnergyKwh != null && Number.isFinite(backendChargeEnergyKwh)
    ? Math.max(0, backendChargeEnergyKwh)
    : null
  const chargedEnergyKwh = validBackendEnergyKwh != null
    ? Math.max(validBackendEnergyKwh, integratedEnergyKwh)
    : (integratedEnergyKwh > 0 ? integratedEnergyKwh : null)
  const chargedEnergyWh = chargedEnergyKwh != null
    ? Math.round(chargedEnergyKwh * 1000)
    : null
  const cumulativeChargeCostEur = chargedEnergyKwh != null
    ? chargedEnergyKwh * energyPriceEurPerKwh
    : null
  const currentRangeKm = vehicle?.batteryRange ?? null
  const estimatedRangeAtTargetKm =
    currentRangeKm != null && soc > 0
      ? Math.round((currentRangeKm / soc) * effectiveTargetSoc)
      : null

  const timeToTarget = computeTimeToTargetH({
    machineHours: vehicle?.timeToFullChargeH ?? null,
    stateOfCharge: soc,
    desiredTargetSoc: effectiveTargetSoc,
    carLimitSoc,
    chargeRateKw: chargePowerKw,
    batteryCapacityKwh,
  })

  const nextChargeStartTime = nextCharge?.computedStartAt
    ? new Date(nextCharge.computedStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  const enginePhaseLabelMap: Record<string, string> = {
    idle: 'Idle',
    charging: 'Charging',
    balancing: 'Balancing',
    complete: 'Completed',
    paused: 'Paused',
  }
  const enginePhaseLabel = engine?.phase ? (enginePhaseLabelMap[engine.phase] ?? engine.phase) : 'Idle'
  const engineMessageLabel = engine?.message
    ? engine.message.charAt(0).toUpperCase() + engine.message.slice(1)
    : 'Idle'

  useEffect(() => {
    if (validBackendEnergyKwh == null) return
    setIntegratedEnergyKwh(validBackendEnergyKwh)
  }, [validBackendEnergyKwh])

  useEffect(() => {
    const tsMs = wsLastUpdate ? new Date(wsLastUpdate).getTime() : Date.now()
    if (!Number.isFinite(tsMs)) return

    const prevTsMs = integrationRef.current.lastTsMs
    if (prevTsMs != null && vehicle?.charging && chargePowerKw > 0 && tsMs > prevTsMs) {
      const deltaHours = (tsMs - prevTsMs) / 3600000
      if (deltaHours > 0 && deltaHours < 1) {
        setIntegratedEnergyKwh((prev) => prev + (chargePowerKw * deltaHours))
      }
    }
    integrationRef.current.lastTsMs = tsMs
  }, [wsLastUpdate, vehicle?.charging, chargePowerKw])

  const applyMode = async (mode: ChargeMode) => {
    if ((mode === 'on' || mode === 'plan') && timeToTarget.error) return
    setChargeMode(mode)
    setLoading(true)
    try {
      if (mode === 'off') {
        await stopCharging()
      } else if (mode === 'plan') {
        await setPlanMode(nextCharge?.targetSoc ?? Math.max(1, manualTargetSoc))
      } else {
        await startCharging(Math.max(1, manualTargetSoc))
      }
    } finally {
      setLoading(false)
    }
  }

  const canWakeVehicle = pollMode === 'REACTIVE' || vehicle?.chargingState === 'Sleeping'

  const handleWakeVehicle = async () => {
    if (waking) return
    setWaking(true)
    try {
      await wakeVehicle()
    } finally {
      setWaking(false)
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
    <div className="max-w-2xl mx-auto space-y-4 pb-8">
      {demo && (
        <div className="bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-bold uppercase tracking-widest rounded-lg px-3 py-2 text-center">
          Demo Mode Active — Simulated Data
        </div>
      )}

      <div className="bg-evload-surface border border-evload-border rounded-[2rem] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-evload-muted font-semibold">Energy Flow</div>
            <h2 className="mt-1 text-xl font-semibold text-evload-text">Home split</h2>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-evload-muted">Grid Total</div>
            <div className="mt-1 text-2xl font-black text-evload-text">
              {(homeTotalPowerW / 1000).toFixed(1)} <span className="text-xs font-medium text-evload-muted">kW</span>
            </div>
          </div>
        </div>
        <div className="mt-5 rounded-[1.75rem] border border-evload-border bg-evload-bg/75 px-4 py-4 sm:px-5">
          <div className="grid grid-cols-[56px_1fr_56px] items-center gap-3 sm:gap-4">
            <div className="text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-evload-border bg-evload-surface text-emerald-300">
                <Home size={16} />
              </div>
            </div>
            <div className="relative">
              <div className="h-11 w-full overflow-hidden rounded-2xl border border-evload-border bg-evload-surface flex shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="h-full bg-[#22c55e] transition-all" style={{ width: `${homeBaseLoadSharePct}%` }} />
                <div className="h-full bg-[#facc15] transition-all" style={{ width: `${chargerLoadSharePct}%` }} />
              </div>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4 text-[13px] font-semibold text-black/70">
                <span>{homeBaseLoadSharePct > 12 ? `${(homeNonChargingPowerW / 1000).toFixed(1)} kW` : ''}</span>
                <span>{chargerLoadSharePct > 12 ? `${(chargerPowerW / 1000).toFixed(1)} kW` : ''}</span>
              </div>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-evload-border bg-evload-surface text-yellow-300">
                <ZapIcon size={16} />
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FlowStatRow
              icon={<Home size={14} className="text-emerald-100" />}
              label="Home Total"
              value={`${(homeNonChargingPowerW / 1000).toFixed(1)} kW`}
              accentClass="bg-emerald-500/70 text-emerald-100"
            />
            <FlowStatRow
              icon={<ZapIcon size={14} className="text-yellow-950" />}
              label="EV"
              value={`${(chargerPowerW / 1000).toFixed(1)} kW`}
              accentClass="bg-yellow-400/90 text-yellow-950"
            />
          </div>
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
            <div className="mt-1 text-2xl font-semibold">
              {chargePowerKw.toFixed(1)} <span className="text-base text-evload-muted">kW</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted">Next Charge</div>
            <div className="mt-1 text-2xl font-semibold flex items-center justify-center gap-1.5">
              {nextChargeStartTime ? (
                <>
                  <Clock3 size={18} className="text-evload-accent" />
                  {nextChargeStartTime}
                </>
              ) : (
                <span className="text-sm text-evload-muted font-normal lowercase italic">— no schedule —</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-center">
              <span className={clsx(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                pollMode === 'REACTIVE'
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                  : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
              )}>
                {pollMode === 'REACTIVE' ? 'Garage Reactive' : 'Normal'}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted">Charge Cost</div>
            <div className="mt-1 text-2xl font-semibold">
              {cumulativeChargeCostEur != null ? cumulativeChargeCostEur.toFixed(2) : '—'} <span className="text-base text-evload-muted">EUR</span>
            </div>
            <div className="text-[11px] text-evload-muted mt-1">
              Charged: {chargedEnergyWh != null ? `${chargedEnergyWh} Wh` : '—'}
            </div>
            <div className="text-[11px] text-evload-muted">Price: {energyPriceEurPerKwh.toFixed(3)} EUR/kWh</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-evload-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold flex items-center gap-2">
                <Car size={18} /> {vehicle.displayName ?? 'Vehicle'}
              </h2>
              <p className="text-sm text-evload-muted mt-1">
                {vehicle.charging ? 'Charging...' : vehicle.pluggedIn ? 'Connected' : 'Disconnected'}
              </p>
              {canWakeVehicle && (
                <button
                  onClick={handleWakeVehicle}
                  disabled={waking}
                  className="mt-2 inline-flex items-center rounded-md border border-evload-border bg-evload-bg px-2.5 py-1 text-xs font-semibold text-evload-text transition-colors hover:bg-evload-border/50 disabled:opacity-60"
                >
                  {waking ? 'Waking...' : 'Wake Vehicle'}
                </button>
              )}
            </div>
            <div className="text-right text-xs text-evload-muted">
              <div>VIN</div>
              <div className="font-mono text-[11px] text-evload-text">{vehicle.vin ?? '-'}</div>
            </div>
          </div>

          <div className="mt-4">
            <EvccSocBar
              actualSoc={soc}
              targetSoc={effectiveTargetSoc}
              carLimitSoc={carLimitSoc}
              charging={vehicle.charging}
              readonly={isPlanMode}
              onTargetChange={setManualTargetSoc}
            />
            {isPlanMode && (
              <div className="mt-1 text-[11px] text-evload-muted">Target set by schedule</div>
            )}
            {carLimitSoc != null && carLimitSoc < effectiveTargetSoc && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300">
                  Hardware Limit: {carLimitSoc}%
                </span>
              </div>
            )}
            {timeToTarget.error && (
              <div className="mt-2 text-xs text-evload-error bg-evload-error/10 border border-evload-error/30 rounded px-2 py-1">
                {timeToTarget.error}
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="text-left">
              <div className="text-xs uppercase tracking-wide text-evload-muted">Charge</div>
              <div className="text-4xl font-semibold leading-none mt-1">{soc}%</div>
              <div className="text-sm text-evload-muted mt-1">{vehicle.batteryRange?.toFixed(0) ?? '0'} km</div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-evload-muted">Engine</div>
              <div className="text-4xl font-semibold leading-none mt-1">
                {enginePhaseLabel}
              </div>
              <div className="text-sm text-evload-muted mt-1">{engineMessageLabel}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-evload-muted">Limit</div>
              <div className="text-4xl font-semibold leading-none mt-1">{effectiveTargetSoc}%</div>
              <div className="text-sm text-evload-muted mt-1">
                {estimatedRangeAtTargetKm != null ? `${estimatedRangeAtTargetKm} km` : '—'}
              </div>
              {carLimitSoc != null && carLimitSoc < effectiveTargetSoc && (
                <div className="text-xs text-evload-error mt-1">Auto limit {carLimitSoc}% is lower</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-evload-surface border border-evload-border rounded-3xl p-4 sm:p-5 space-y-3">
        <h2 className="font-semibold text-lg">Engine Live Log</h2>
        <div className="bg-evload-bg border border-evload-border rounded-xl p-3 h-56 overflow-auto font-mono text-xs leading-5">
          {(engine?.debugLog?.length ?? 0) === 0 ? (
            <div className="text-evload-muted">No logs yet. Start charging control to see engine actions.</div>
          ) : (
            (engine?.debugLog ?? []).map((line, idx) => (
              <div key={`${idx}-${line}`} className="text-evload-text">{line}</div>
            ))
          )}
        </div>
      </div>

      <VehicleRawProxyPanel rawChargeState={vehicle.rawChargeState} />
    </div>
  )
}
