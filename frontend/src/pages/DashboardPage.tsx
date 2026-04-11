import React, { useState, useEffect, useRef } from 'react'
import { useWsStore } from '../store/wsStore'
import {
  startCharging,
  stopCharging,
  setPlanMode,
  wakeVehicle,
  getNextPlannedCharge,
  getSchedulerRuntimeStatus,
  getEngineTargetSocPreferences,
  patchEngineTargetSocPreference,
  NextPlannedCharge,
  SchedulerRuntimeStatus,
} from '../api/index'
import { WifiOff, Car, Clock3, Home, Zap as ZapIcon, ChevronDown, ChevronRight, AlertTriangle, Sparkles, Bot } from 'lucide-react'
import { clsx } from 'clsx'
import { flog } from '../utils/frontendLogger'

type ChargeMode = 'off' | 'plan' | 'on'

const RAW_PROXY_PANEL_STORAGE_KEY = 'evload.dashboard.rawProxyPanelExpanded'
const VEHICLE_DETAILS_PANEL_STORAGE_KEY = 'evload.dashboard.vehicleDetailsExpanded'

function readStoredBoolean(storageKey: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw == null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

function formatHoursToEta(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return '—'
    if (hours <= 0) return 'Completed'
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

interface MeterEnergySample {
  tsMs: number
  meterEnergyKwh: number
}

const EVLOAD_AVERAGE_WINDOW_MS = 90_000
const EVLOAD_AVERAGE_MIN_WINDOW_MS = 20_000

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
  onTargetCommit,
}: {
  actualSoc: number
  targetSoc: number
  carLimitSoc: number | null
  charging: boolean
  readonly: boolean
  onTargetChange: (value: number) => void
  onTargetCommit?: (value: number) => void
}) {
  const safeActual = Math.max(0, Math.min(100, actualSoc))
  const safeTarget = Math.max(0, Math.min(100, targetSoc))
  const safeCarLimit = carLimitSoc == null ? null : Math.max(0, Math.min(100, carLimitSoc))
  const plannedStart = Math.min(safeActual, safeTarget)
  const plannedWidth = Math.max(safeActual, safeTarget) - plannedStart
  const sliderRef = useRef<HTMLDivElement>(null)

  const resolveRatio = (clientX: number): number | null => {
    if (!sliderRef.current) return null
    const rect = sliderRef.current.getBoundingClientRect()
    const nextValue = Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100)
    onTargetChange(nextValue)
    return nextValue
  }

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    e.preventDefault() // prevent page scroll on touch
    e.currentTarget.setPointerCapture(e.pointerId) // route all future pointer events here even if finger/cursor leaves
    resolveRatio(e.clientX)
  }

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    resolveRatio(e.clientX)
  }

  const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const nextValue = resolveRatio(e.clientX)
    if (nextValue != null) {
      onTargetCommit?.(nextValue)
    }
  }

  return (
    <div
      ref={sliderRef}
      className={clsx(
        'relative h-8 rounded-lg bg-evload-bg border border-evload-border overflow-visible select-none',
        readonly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
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
        className="absolute -top-3 h-14 w-4 rounded-full bg-evload-success shadow-lg border border-evload-bg"
        style={{ left: `calc(${safeTarget}% - 8px)` }}
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
        'px-3 py-1.5 rounded-full text-sm font-semibold transition-all disabled:opacity-60',
        active
          ? 'bg-gradient-to-r from-evload-accent to-red-700 text-white shadow-[0_12px_28px_rgba(227,25,55,0.35)]'
          : 'text-evload-muted hover:bg-evload-border/50 hover:text-evload-text'
      )}
    >
      {label}
    </button>
  )
}

type FinishByWakeTone = 'idle' | 'waking' | 'ready' | 'scheduled'

function deriveFinishByWakeStatus(params: {
  nextCharge: NextPlannedCharge | null
  schedulerRuntime: SchedulerRuntimeStatus | null
  debugLog: string[]
  waking: boolean
  isVehicleSleeping: boolean
}): {
  tone: FinishByWakeTone
  title: string
  detail: string
} {
  const { nextCharge, schedulerRuntime, debugLog, waking, isVehicleSleeping } = params
  const isFinishByPlan = nextCharge?.scheduleType === 'finish_by' || nextCharge?.scheduleType === 'finish_by_weekly'

  if (!isFinishByPlan) {
    return {
      tone: 'idle',
      title: 'Finish-by wake monitor idle',
      detail: 'No active finish-by plan in queue.',
    }
  }

  if (waking) {
    return {
      tone: 'waking',
      title: 'Waking vehicle for finish-by',
      detail: 'Wake command sent, waiting for live SoC from vehicle_data.',
    }
  }

  if ((schedulerRuntime?.finishByWakePendingCount ?? 0) > 0) {
    return {
      tone: 'waking',
      title: 'Waiting SoC after wake',
      detail: 'Scheduler wake cycle active: collecting live SoC before computing the start window.',
    }
  }

  if ((schedulerRuntime?.finishByScheduledNotifiedCount ?? 0) > 0) {
    return {
      tone: 'scheduled',
      title: 'Finish-by window scheduled',
      detail: 'Start time computed and confirmed by scheduler runtime state.',
    }
  }

  const latestRelevant = [...debugLog].reverse().find((line) =>
    line.includes('[FINISH_BY_WAKE]') || line.includes('[FINISH_BY]')
  )
  const latest = latestRelevant?.toLowerCase() ?? ''

  if (latest.includes('waiting for soc data') || latest.includes('has no soc data')) {
    return {
      tone: 'waking',
      title: 'Waiting SoC after wake',
      detail: 'Finish-by planner requested wake-up and is waiting telemetry.',
    }
  }

  if (latest.includes('soc now available')) {
    return {
      tone: 'ready',
      title: 'Vehicle data received',
      detail: 'Live SoC acquired, computing charging window with safety margin.',
    }
  }

  if (latest.includes('charging start scheduled for') || latest.includes('computedstart')) {
    return {
      tone: 'scheduled',
      title: 'Finish-by window scheduled',
      detail: 'Start time computed and queued according to target SoC and finish deadline.',
    }
  }

  if (isVehicleSleeping) {
    return {
      tone: 'waking',
      title: 'Vehicle sleeping',
      detail: 'Finish-by plan will wake the vehicle when SoC is required for calculation.',
    }
  }

  return {
    tone: 'ready',
    title: 'Finish-by tracking active',
    detail: 'Waiting next scheduler tick to refresh plan timing.',
  }
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
  const [expanded, setExpanded] = useState(() => readStoredBoolean(RAW_PROXY_PANEL_STORAGE_KEY, false))

  useEffect(() => {
    window.localStorage.setItem(RAW_PROXY_PANEL_STORAGE_KEY, expanded ? 'true' : 'false')
  }, [expanded])

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
  const proxy = useWsStore((s) => s.proxy)
  const engine = useWsStore((s) => s.engine)
  const ha = useWsStore((s) => s.ha)
  const failsafe = useWsStore((s) => s.failsafe)
  const charging = useWsStore((s) => s.charging)
  const wsConnected = useWsStore((s) => s.connected)
  const demo = useWsStore((s) => s.demo)

  // Derive proxy connectivity early — used to guard stale vehicle telemetry in ETA/power display
  const proxyConnected = proxy?.connected ?? false

  const [manualTargetSoc, setManualTargetSoc] = useState(() => useWsStore.getState().engine?.targetSoc ?? 80)
  const [chargeMode, setChargeMode] = useState<ChargeMode>(
    () => (useWsStore.getState().engine?.mode as ChargeMode | undefined) ?? 'off'
  )
  const [loading, setLoading] = useState(false)
  const [waking, setWaking] = useState(false)
  const [nextCharge, setNextCharge] = useState<NextPlannedCharge | null>(null)
  const [schedulerRuntime, setSchedulerRuntime] = useState<SchedulerRuntimeStatus | null>(null)
  const [vehicleDetailsExpanded, setVehicleDetailsExpanded] = useState(() => readStoredBoolean(VEHICLE_DETAILS_PANEL_STORAGE_KEY, false))
  const meterEnergySamplesRef = useRef<MeterEnergySample[]>([])

  useEffect(() => {
    if (!engine?.mode) return
    if (engine.mode === 'off' || engine.mode === 'plan') {
      setChargeMode(engine.mode as ChargeMode)
      return
    }
    setChargeMode((prev) => (prev === 'plan' && nextCharge ? 'plan' : 'on'))
  }, [engine?.mode, nextCharge])

  useEffect(() => {
    if (!engine) return
    if (typeof engine.targetSoc === 'number' && Number.isFinite(engine.targetSoc)) {
      setManualTargetSoc(engine.targetSoc)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine?.targetSoc])

  useEffect(() => {
    if (!wsConnected) return
    getEngineTargetSocPreferences()
      .then((res) => {
        if (typeof res.targets?.value === 'number') setManualTargetSoc(res.targets.value)
      })
      .catch(() => {})
  }, [wsConnected])

  useEffect(() => {
    if (!wsConnected) return
    const poll = () => {
      Promise.all([
        getNextPlannedCharge().catch(() => null),
        getSchedulerRuntimeStatus().catch(() => null),
      ]).then(([next, runtime]) => {
        setNextCharge(next)
        setSchedulerRuntime(runtime)
      })
    }
    poll()
    const interval = setInterval(poll, 15000)
    return () => clearInterval(interval)
  }, [wsConnected])

  useEffect(() => {
    window.localStorage.setItem(VEHICLE_DETAILS_PANEL_STORAGE_KEY, vehicleDetailsExpanded ? 'true' : 'false')
  }, [vehicleDetailsExpanded])

  const soc = Math.max(0, Math.min(100, vehicle?.stateOfCharge ?? 0))
  const carLimitSoc = vehicle?.chargeLimitSoc ?? null
  const isPlanMode = chargeMode === 'plan'
  const effectiveTargetSoc = isPlanMode
    ? (nextCharge?.targetSoc ?? engine?.targetSoc ?? manualTargetSoc)
    : manualTargetSoc

  // When proxy is disconnected, chargeRateKw is stale — zero it out to avoid ETA and power display errors
  const chargePowerKw = proxyConnected ? Math.max(0, vehicle?.chargeRateKw ?? 0) : 0
  const vehicleChargerPowerW = Math.max(0, Math.round(chargePowerKw * 1000))
  const haChargerPowerW = ha?.chargerW != null && Number.isFinite(ha.chargerW)
    ? Math.max(0, Math.round(ha.chargerW))
    : null
  // EV power shown in dashboard should prefer HA Charger Power Entity, with vehicle telemetry as fallback.
  const chargerPowerW = haChargerPowerW ?? vehicleChargerPowerW
  const displayChargePowerKw = chargerPowerW / 1000
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
  const vehicleEnergyFromAutoKwh = backendChargeEnergyKwh != null && Number.isFinite(backendChargeEnergyKwh)
    ? Math.max(0, backendChargeEnergyKwh)
    : null
  const meterEnergyKwh = engine?.accumulatedSessionEnergyKwh != null && Number.isFinite(engine.accumulatedSessionEnergyKwh)
    ? Math.max(0, engine.accumulatedSessionEnergyKwh)
    : null
  // Session-relative energy: raw − baseline captured at session start (correct for efficiency)
  const vehicleChargedEnergyKwh = engine?.vehicleBatteryEnergyKwh != null && Number.isFinite(engine.vehicleBatteryEnergyKwh) && engine.vehicleBatteryEnergyKwh > 0
    ? engine.vehicleBatteryEnergyKwh
    : null
  // Raw proxy value (Tesla charge_energy_added, may include pre-session energy)
  const vehicleChargedEnergyRawKwh = engine?.vehicleBatteryEnergyRawKwh != null && Number.isFinite(engine.vehicleBatteryEnergyRawKwh) && engine.vehicleBatteryEnergyRawKwh > 0
    ? engine.vehicleBatteryEnergyRawKwh
    : vehicleEnergyFromAutoKwh
  const chargedEnergyWh = meterEnergyKwh != null
    ? Math.round(meterEnergyKwh * 1000)
    : null
  const cumulativeChargeCostEur = meterEnergyKwh != null
    ? meterEnergyKwh * energyPriceEurPerKwh
    : null

  useEffect(() => {
    const currentSessionId = engine?.sessionId ?? null
    if (currentSessionId == null) {
      meterEnergySamplesRef.current = []
      return
    }

    if (meterEnergyKwh == null || !Number.isFinite(meterEnergyKwh) || meterEnergyKwh < 0) {
      return
    }

    const nowMs = Date.now()
    const samples = meterEnergySamplesRef.current
    const last = samples.length > 0 ? samples[samples.length - 1] : null
    if (last == null || nowMs - last.tsMs >= 1000) {
      samples.push({ tsMs: nowMs, meterEnergyKwh })
    } else {
      last.tsMs = nowMs
      last.meterEnergyKwh = meterEnergyKwh
    }

    const keepFrom = nowMs - EVLOAD_AVERAGE_WINDOW_MS
    while (samples.length > 1 && samples[0].tsMs < keepFrom) {
      samples.shift()
    }
  }, [engine?.sessionId, meterEnergyKwh])

  const currentRangeKm = vehicle?.batteryRange ?? null
  const autoActualCurrentA = vehicle?.chargerActualCurrent ?? null
  const evloadRequestedCurrentA = engine?.setpointAmps ?? engine?.targetAmps ?? null
  const autoVoltageV = vehicle?.chargerVoltage ?? null
  const hardwareSetpointCandidatesA = [
    vehicle?.chargeCurrentRequestMax,
    vehicle?.chargerPilotCurrent,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const hardwareSetpointA = hardwareSetpointCandidatesA.length > 0 ? Math.min(...hardwareSetpointCandidatesA) : null
  const softwareSetpointA = evloadRequestedCurrentA ?? vehicle?.chargeCurrentRequest ?? null
  const autoPowerKw = autoVoltageV != null && autoActualCurrentA != null
    ? (autoVoltageV * autoActualCurrentA) / 1000
    : chargePowerKw
  // Efficiency = battery energy from vehicle (session-relative) / energy measured at the meter.
  const vehicleEfficiencyPct = engine?.chargingEfficiencyPct != null && Number.isFinite(engine.chargingEfficiencyPct)
    ? engine.chargingEfficiencyPct
    : (
      vehicleChargedEnergyKwh != null && vehicleChargedEnergyKwh > 0 &&
      meterEnergyKwh != null && meterEnergyKwh > 0
        ? (vehicleChargedEnergyKwh / meterEnergyKwh) * 100
        : null
    )
  const powerLimitCandidates = [
    hardwareSetpointA,
    engine?.targetAmps,
    engine?.setpointAmps,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const safeCurrentLimitA = powerLimitCandidates.length > 0 ? Math.min(...powerLimitCandidates) : null
  const isCurrentUnderLimit =
    autoActualCurrentA != null && safeCurrentLimitA != null
      ? autoActualCurrentA <= safeCurrentLimitA + 0.01
      : null
  const estimatedRangeAtTargetKm =
    currentRangeKm != null && soc > 0
      ? Math.round((currentRangeKm / soc) * effectiveTargetSoc)
      : null

  const timeToTarget = computeTimeToTargetH({
    machineHours: proxyConnected ? (vehicle?.timeToFullChargeH ?? null) : null,
    stateOfCharge: soc,
    desiredTargetSoc: effectiveTargetSoc,
    carLimitSoc,
    chargeRateKw: chargePowerKw,
    batteryCapacityKwh,
  })
  const remainingEnergyKwh = Math.max(0, ((effectiveTargetSoc - soc) / 100) * batteryCapacityKwh)
  // Only use live display power as fallback when proxy is connected; stale chargeRateKw would skew ETA
  const fallbackAveragePowerKw = proxyConnected && displayChargePowerKw > 0 ? displayChargePowerKw : null
  const evloadAveragePowerKw = (() => {
    const samples = meterEnergySamplesRef.current
    if (samples.length < 2) return fallbackAveragePowerKw

    const latest = samples[samples.length - 1]
    const minStartTs = latest.tsMs - EVLOAD_AVERAGE_WINDOW_MS
    const oldest = samples.find((sample) => sample.tsMs >= minStartTs) ?? samples[0]
    const deltaMs = latest.tsMs - oldest.tsMs
    const deltaKwh = latest.meterEnergyKwh - oldest.meterEnergyKwh

    if (deltaMs < EVLOAD_AVERAGE_MIN_WINDOW_MS) return fallbackAveragePowerKw
    if (!Number.isFinite(deltaKwh) || deltaKwh <= 0) return fallbackAveragePowerKw

    const computed = deltaKwh / (deltaMs / 3600000)
    if (!Number.isFinite(computed) || computed <= 0) return fallbackAveragePowerKw
    return Number(computed.toFixed(2))
  })()
  const usableEvloadAveragePowerKw = evloadAveragePowerKw != null && Number.isFinite(evloadAveragePowerKw) && evloadAveragePowerKw > 0
    ? evloadAveragePowerKw
    : fallbackAveragePowerKw
  const etaByEvloadAverageHours = remainingEnergyKwh <= 0
    ? 0
    : (usableEvloadAveragePowerKw != null ? remainingEnergyKwh / usableEvloadAveragePowerKw : null)
  const maxCurrentWhenIdleA = [
    isPlanMode ? nextCharge?.targetAmps : null,
    vehicle?.chargeCurrentRequestMax,
    vehicle?.chargerPilotCurrent,
    engine?.targetAmps,
    engine?.setpointAmps,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const idleMaxCurrentA = maxCurrentWhenIdleA.length > 0 ? Math.max(...maxCurrentWhenIdleA) : null
  const idleEstimatedPowerKw = idleMaxCurrentA != null ? (idleMaxCurrentA * 220) / 1000 : null
  const etaWhenNotChargingHours = remainingEnergyKwh <= 0
    ? 0
    : (idleEstimatedPowerKw != null && idleEstimatedPowerKw > 0 ? remainingEnergyKwh / idleEstimatedPowerKw : null)
  const shouldUseCarEta =
    hardwareSetpointA != null
    && softwareSetpointA != null
    && hardwareSetpointA < softwareSetpointA
    && timeToTarget.hours != null
  const etaHours = vehicle?.charging
    ? (shouldUseCarEta ? timeToTarget.hours : (etaByEvloadAverageHours ?? timeToTarget.hours))
    : (etaWhenNotChargingHours ?? timeToTarget.hours)
  const etaToChargeEnd = formatHoursToEta(etaHours)
  const etaSourceLabel = vehicle?.charging
    ? (shouldUseCarEta ? 'Source: vehicle ETA (hardware-limited)' : 'Source: evload average charging power')
    : (isPlanMode && nextCharge?.targetAmps ? 'Source: planned amps x 220V' : 'Source: max current x 220V')

  const nextChargeStartTime = nextCharge?.computedStartAt
    ? (() => {
        const d = new Date(nextCharge.computedStartAt)
        const isToday = new Date().toDateString() === d.toDateString()
        const isTomorrow = new Date(Date.now() + 86400000).toDateString() === d.toDateString()
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        if (isToday) return timeStr
        if (isTomorrow) return `Tomorrow ${timeStr}`
        return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`
      })()
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

  const applyMode = async (mode: ChargeMode) => {
    if (mode === 'plan' && timeToTarget.error) return
    setChargeMode(mode)
    setLoading(true)
    try {
      if (mode === 'off') {
        flog.info('SESSION', 'Stopping charge (user action)', {
          previousMode: chargeMode,
          currentSoc: vehicle?.stateOfCharge,
        })
        await stopCharging()
        flog.info('SESSION', 'Charge stopped successfully')
      } else if (mode === 'plan') {
        const targetSoc = nextCharge?.targetSoc ?? Math.max(1, manualTargetSoc)
        flog.info('SESSION', 'Setting plan mode (user action)', {
          targetSoc,
          scheduledAt: nextCharge?.computedStartAt,
        })
        await setPlanMode(targetSoc)
        flog.info('SESSION', 'Plan mode set successfully', { targetSoc })
      } else {
        const targetSoc = Math.max(1, manualTargetSoc)
        flog.info('SESSION', 'Starting charge immediately (user action)', {
          targetSoc,
          effectiveTargetSoc,
          engineCurrentTargetSoc: engine?.targetSoc ?? null,
          chargeLimitSoc: vehicle?.chargeLimitSoc ?? null,
          currentSoc: vehicle?.stateOfCharge,
          vehicleConnected: vehicle?.connected,
          vehiclePluggedIn: vehicle?.pluggedIn,
        })
        await startCharging(targetSoc)
        flog.info('SESSION', 'Charge start command sent', { targetSoc })
      }
    } catch (err) {
      flog.error('SESSION', `Failed to apply mode '${mode}'`, { error: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const canWakeVehicle = vehicle?.chargingState === 'Sleeping'
  const vehicleInGarage = vehicle?.connected ?? false
  const isVehicleSleeping = vehicle?.vehicleSleepStatus === 'VEHICLE_SLEEP_STATUS_ASLEEP' || vehicle?.chargingState === 'Sleeping'
  const carStatusLabel = isVehicleSleeping ? 'Sleeping' : vehicleInGarage ? 'In garage' : 'Not in garage / unreachable'
  const finishByWakeStatus = deriveFinishByWakeStatus({
    nextCharge,
    schedulerRuntime,
    debugLog: engine?.debugLog ?? [],
    waking,
    isVehicleSleeping,
  })
  const statusReason = vehicle?.error ?? proxy?.error ?? vehicle?.reason ?? null
  const controlsDisabled = loading || !!failsafe?.active

  const persistTargetSocPreference = async (targetSoc: number): Promise<void> => {
    const safeSoc = Math.max(1, Math.min(100, Math.round(targetSoc)))
    try {
      await patchEngineTargetSocPreference({
        targetSoc: safeSoc,
        applyToRunningSession: engine?.running ?? false,
      })
      flog.info('TARGET_SOC', 'Persisted target SoC preference', { targetSoc: safeSoc })
    } catch (err) {
      flog.error('TARGET_SOC', 'Failed to persist target SoC preference', {
        targetSoc: safeSoc,
        error: String(err),
      })
    }
  }

  const handleWakeVehicle = async () => {
    if (waking) return
    setWaking(true)
    try {
      flog.info('SESSION', 'Wake vehicle requested', {
        sleepStatus: vehicle?.vehicleSleepStatus,
        chargingState: vehicle?.chargingState,
      })
      await wakeVehicle()
      flog.info('SESSION', 'Wake vehicle command sent')
    } catch (err) {
      flog.error('SESSION', 'Wake vehicle failed', { error: String(err) })
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

  if (!vehicle) {
    return (
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">
        Waiting for first vehicle state...
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-10">
      <div className="relative overflow-hidden rounded-[2rem] border border-evload-border bg-evload-surface/85 px-5 py-5 sm:px-6 sm:py-6 shadow-[0_20px_60px_rgba(4,10,24,0.18)]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-red-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-52 w-52 rounded-full bg-orange-300/25 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-evload-border bg-evload-bg/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-evload-muted">
              <Sparkles size={12} className="text-evload-accent" />
              Live Smart Charging
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-evload-text sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-evload-muted">Controllo immediato, stato piano chiaro, UX ottimizzata anche su smartphone.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[290px]">
            <div className="rounded-2xl border border-evload-border bg-evload-bg/80 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-evload-muted">Car</div>
              <div className="mt-1 text-sm font-semibold text-evload-text">{carStatusLabel}</div>
            </div>
            <div className="rounded-2xl border border-evload-border bg-evload-bg/80 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-evload-muted">Engine</div>
              <div className="mt-1 text-sm font-semibold text-evload-text">{enginePhaseLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {demo && (
        <div className="bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-bold uppercase tracking-widest rounded-lg px-3 py-2 text-center">
          Demo Mode Active — Simulated Data
        </div>
      )}

      {engine?.chargeStartBlocked && (
        <div className="bg-amber-500/15 border border-amber-500/50 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-300 mt-0.5" size={20} />
            <div>
              <div className="text-sm font-bold tracking-wide text-amber-200 uppercase">Charging blocked</div>
              <div className="text-base text-amber-100 mt-1">
                {engine.chargeStartBlockReason ?? 'Charging cannot start with current vehicle state'}
              </div>
              <div className="text-xs text-amber-200/90 mt-2">
                Connect the charging cable and wait for vehicle connection recovery. Evload suspended automatic charge_start retries to avoid command spam.
              </div>
            </div>
          </div>
        </div>
      )}

      {vehicleInGarage && !vehicle.pluggedIn && !isVehicleSleeping && (
        <div className="bg-orange-500/15 border border-orange-500/50 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-orange-300 mt-0.5" size={20} />
            <div>
              <div className="text-sm font-bold tracking-wide text-orange-200 uppercase">Cable not connected</div>
              <div className="text-base text-orange-100 mt-1">
                The charging cable is not plugged in. Connect the cable to start or schedule charging.
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={clsx(
          'rounded-3xl border p-4 sm:p-5 transition-all',
          finishByWakeStatus.tone === 'waking' && 'border-indigo-400/60 bg-indigo-500/10',
          finishByWakeStatus.tone === 'ready' && 'border-cyan-400/60 bg-cyan-500/10',
          finishByWakeStatus.tone === 'scheduled' && 'border-emerald-400/60 bg-emerald-500/10',
          finishByWakeStatus.tone === 'idle' && 'border-evload-border bg-evload-surface'
        )}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-evload-text">
            <Bot size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.2em] text-evload-muted">Finish-by Wake & Sync</div>
            <h3 className="mt-1 text-base font-bold text-evload-text">{finishByWakeStatus.title}</h3>
            <p className="mt-1 text-sm text-evload-muted">{finishByWakeStatus.detail}</p>
            {nextCharge?.finishBy && (
              <div className="mt-2 text-xs text-evload-muted">
                Deadline: {new Date(nextCharge.finishBy).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-evload-surface/90 border border-evload-border rounded-[2rem] p-4 sm:p-5 shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-evload-muted font-semibold">Energy Flow</div>
            <h2 className="mt-1 text-xl font-semibold text-evload-text">Home split</h2>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-evload-muted">Grid Total</div>
            <div className="mt-1 text-2xl font-black text-evload-text">
              {(homeTotalPowerW / 1000).toFixed(2)} <span className="text-xs font-medium text-evload-muted">kW</span>
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
                <span>{homeBaseLoadSharePct > 12 ? `${(homeNonChargingPowerW / 1000).toFixed(2)} kW` : ''}</span>
                <span>{chargerLoadSharePct > 12 ? `${(chargerPowerW / 1000).toFixed(2)} kW` : ''}</span>
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
              value={`${(homeNonChargingPowerW / 1000).toFixed(2)} kW`}
              accentClass="bg-emerald-500/70 text-emerald-100"
            />
            <FlowStatRow
              icon={<ZapIcon size={14} className="text-yellow-950" />}
              label="EV"
              value={`${(chargerPowerW / 1000).toFixed(2)} kW`}
              accentClass="bg-yellow-400/90 text-yellow-950"
            />
          </div>
        </div>
      </div>

      <div className="bg-evload-surface/90 border border-evload-border rounded-3xl p-4 sm:p-5 text-evload-text shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
        <div className="rounded-full border border-evload-border bg-evload-bg p-1 flex items-center justify-between">
          <ModePill active={chargeMode === 'off'} label="Off" onClick={() => applyMode('off')} disabled={controlsDisabled} />
          <ModePill active={chargeMode === 'plan'} label="Plan" onClick={() => applyMode('plan')} disabled={controlsDisabled} />
          <ModePill active={chargeMode === 'on'} label="On" onClick={() => applyMode('on')} disabled={controlsDisabled} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted">Power</div>
            <div className="mt-1 text-2xl font-semibold">
              {displayChargePowerKw.toFixed(2)} <span className="text-base text-evload-muted">kW</span>
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
            {nextCharge?.name && (
              <div className="mt-1 flex items-center justify-center">
                <span className="inline-flex items-center gap-1 rounded-full border border-evload-border bg-evload-bg px-2 py-0.5 text-[10px] font-medium text-evload-muted max-w-[120px] truncate" title={nextCharge.name}>
                  📌 {nextCharge.name}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-center">
              <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300">
                Polling Active
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-evload-muted">Charge Cost</div>
            <div className="mt-1 text-2xl font-semibold">
              {cumulativeChargeCostEur != null ? cumulativeChargeCostEur.toFixed(2) : '—'} <span className="text-base text-evload-muted">EUR</span>
            </div>
            <div className="text-[11px] text-evload-muted mt-1">
              Meter energy: {chargedEnergyWh != null ? `${chargedEnergyWh} Wh` : '—'}
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
              <p className="text-sm text-evload-muted mt-1">Proxy: {proxyConnected ? 'Online' : 'Offline'}</p>
              <p className="text-sm text-evload-muted">Car: {carStatusLabel}</p>
              {isVehicleSleeping && (
                <span className="inline-flex items-center mt-1 rounded-full border border-indigo-400/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-indigo-300">
                  😴 Sleeping — vehicle_data polling suspended
                </span>
              )}
              {vehicle.userPresence === 'VEHICLE_USER_PRESENCE_PRESENT' && (
                <span className="inline-flex items-center mt-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300">
                  👤 User present
                </span>
              )}
              {statusReason && (
                <p className="text-xs text-evload-muted mt-1">Reason: {statusReason}</p>
              )}
              {canWakeVehicle && (
                <button
                  onClick={handleWakeVehicle}
                  disabled={waking || !proxyConnected}
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
              onTargetChange={(v) => {
                flog.debug('TARGET_SOC', 'Slider dragged', {
                  newTargetSoc: v,
                  previousTargetSoc: manualTargetSoc,
                  engineRunning: engine?.running ?? false,
                  engineTargetSoc: engine?.targetSoc ?? null,
                })
                setManualTargetSoc(v)
              }}
              onTargetCommit={(v) => {
                if (chargeMode === 'plan') return
                void persistTargetSocPreference(v)
              }}
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

          <div className="mt-3 rounded-xl border border-evload-border bg-evload-bg/70 px-3 py-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-evload-muted">Charge End ETA</div>
              <div className="text-lg font-semibold text-evload-text">{etaToChargeEnd}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-evload-muted">{etaSourceLabel}</div>
              {usableEvloadAveragePowerKw != null && (
                <div className="text-xs text-evload-muted">Evload average: {usableEvloadAveragePowerKw.toFixed(2)} kW</div>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-evload-border pt-4">
            <button
              type="button"
              onClick={() => setVehicleDetailsExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between rounded-xl border border-evload-border bg-evload-bg px-3 py-2 text-left"
            >
              <div>
                <div className="text-sm font-semibold text-evload-text">Vehicle Details</div>
                <div className="text-xs text-evload-muted">Current, voltage, power, energy, ETA, and efficiency</div>
              </div>
              {vehicleDetailsExpanded ? (
                <ChevronDown size={16} className="text-evload-muted" />
              ) : (
                <ChevronRight size={16} className="text-evload-muted" />
              )}
            </button>

            {vehicleDetailsExpanded && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Actual / Requested Current</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">
                    {autoActualCurrentA != null ? `${autoActualCurrentA.toFixed(1)} A` : '—'} / {evloadRequestedCurrentA != null ? `${evloadRequestedCurrentA.toFixed(1)} A` : '—'}
                  </div>
                </div>

                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Vehicle Voltage</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">{autoVoltageV != null ? `${Math.round(autoVoltageV)} V` : '—'}</div>
                </div>

                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Vehicle Power</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">{autoPowerKw > 0 ? `${autoPowerKw.toFixed(2)} kW` : '—'}</div>
                </div>

                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Vehicle Energy (da partenza sessione)</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">{vehicleChargedEnergyKwh != null ? `${vehicleChargedEnergyKwh.toFixed(2)} kWh` : '—'}</div>
                  <div className="mt-1 text-[11px] text-evload-muted">charge_energy_added − baseline avvio sessione</div>
                </div>

                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Vehicle Energy (raw Tesla proxy)</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">{vehicleChargedEnergyRawKwh != null ? `${vehicleChargedEnergyRawKwh.toFixed(2)} kWh` : '—'}</div>
                  <div className="mt-1 text-[11px] text-evload-muted">charge_energy_added diretto dal proxy</div>
                </div>

                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Meter Charged Energy</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">{meterEnergyKwh != null ? `${meterEnergyKwh.toFixed(2)} kWh` : '—'}</div>
                </div>

                <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Charging Efficiency</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">
                    {vehicleEfficiencyPct != null ? `${vehicleEfficiencyPct.toFixed(2)}%` : '—'}
                  </div>
                  <div className="mt-1 text-[11px] text-evload-muted">
                    (energia sessione Tesla / contatore) × 100
                  </div>
                </div>

                <div className="sm:col-span-2 rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                  <div className="text-xs uppercase tracking-wide text-evload-muted">Current vs Power Limit Check</div>
                  <div className="mt-1 text-sm font-semibold text-evload-text">
                    {isCurrentUnderLimit == null
                      ? 'Insufficient data'
                      : isCurrentUnderLimit
                        ? `OK: ${autoActualCurrentA?.toFixed(1)} A <= ${safeCurrentLimitA?.toFixed(1)} A`
                        : `WARNING: ${autoActualCurrentA?.toFixed(1)} A > ${safeCurrentLimitA?.toFixed(1)} A`}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-evload-surface/90 border border-evload-border rounded-3xl p-4 sm:p-5 space-y-3 shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
        <h2 className="font-semibold text-lg">Engine Live Log</h2>
        <div className="bg-evload-bg border border-evload-border rounded-xl p-3 h-56 overflow-auto font-mono text-xs leading-5">
          {(engine?.debugLog?.length ?? 0) === 0 ? (
            <div className="text-evload-muted">No logs yet. Start charging control to see engine actions.</div>
          ) : (
            [...(engine?.debugLog ?? [])].reverse().map((line, idx) => (
              <div key={`${idx}-${line}`} className="text-evload-text">{line}</div>
            ))
          )}
        </div>
      </div>

      <VehicleRawProxyPanel rawChargeState={vehicle.rawChargeState} />
    </div>
  )
}
