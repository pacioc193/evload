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
import { WifiOff, Car, Home, Zap as ZapIcon, ChevronDown, ChevronRight, AlertTriangle, Sparkles, Bot } from 'lucide-react'
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

function SocRingControl({
  actualSoc,
  targetSoc,
  carLimitSoc,
  currentRangeKm,
  targetRangeKm,
  charging,
  readonly,
  onTargetChange,
  onTargetCommit,
}: {
  actualSoc: number
  targetSoc: number
  carLimitSoc: number | null
  currentRangeKm: number | null
  targetRangeKm: number | null
  charging: boolean
  readonly: boolean
  onTargetChange: (value: number) => void
  onTargetCommit?: (value: number) => void
}) {
  const safeActual = Math.max(0, Math.min(100, actualSoc))
  const safeTarget = Math.max(0, Math.min(100, targetSoc))
  const safeCarLimit = carLimitSoc == null ? null : Math.max(0, Math.min(100, carLimitSoc))
  const ringRef = useRef<HTMLDivElement>(null)
  const lastDragValueRef = useRef<number>(safeTarget)
  const ringSize = 280
  const ringRadius = 115
  const ringStroke = 18
  const ringCenter = ringSize / 2
  const circumference = 2 * Math.PI * ringRadius

  const resolveByPointer = (clientX: number, clientY: number): number | null => {
    if (!ringRef.current) return null
    const rect = ringRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const dx = x - rect.width / 2
    const dy = y - rect.height / 2
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    const normalized = (angleDeg + 450) % 360
    let nextValue = Math.round((normalized / 360) * 100)

    // Keep target stable at the seam to avoid accidental wrap 100 -> 0.
    if (lastDragValueRef.current >= 95 && nextValue <= 5) {
      nextValue = 100
    }

    nextValue = Math.max(1, Math.min(100, nextValue))
    lastDragValueRef.current = nextValue
    onTargetChange(nextValue)
    return nextValue
  }

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    e.preventDefault() // prevent page scroll on touch
    e.currentTarget.setPointerCapture(e.pointerId) // route all future pointer events here even if finger/cursor leaves
    resolveByPointer(e.clientX, e.clientY)
  }

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    resolveByPointer(e.clientX, e.clientY)
  }

  const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (readonly) return
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const nextValue = resolveByPointer(e.clientX, e.clientY)
    if (nextValue != null) {
      onTargetCommit?.(nextValue)
    }
  }

  const arcStartPct = Math.min(safeActual, safeTarget)
  const arcEndPct = Math.max(safeActual, safeTarget)
  const actualLength = (safeActual / 100) * circumference
  const targetArcSpanPct = Math.max(0, arcEndPct - arcStartPct)
  const targetAngleRad = ((safeTarget / 100) * 360 - 90) * (Math.PI / 180)
  const knobX = ringCenter + ringRadius * Math.cos(targetAngleRad)
  const knobY = ringCenter + ringRadius * Math.sin(targetAngleRad)

  const polarPoint = (angleDeg: number) => {
    const angleRad = (angleDeg * Math.PI) / 180
    return {
      x: ringCenter + ringRadius * Math.cos(angleRad),
      y: ringCenter + ringRadius * Math.sin(angleRad),
    }
  }

  const describeArc = (startPct: number, endPct: number) => {
    const startAngle = (startPct / 100) * 360 - 90
    const endAngle = (endPct / 100) * 360 - 90
    const start = polarPoint(startAngle)
    const end = polarPoint(endAngle)
    const largeArcFlag = endPct - startPct > 50 ? 1 : 0
    return `M ${start.x} ${start.y} A ${ringRadius} ${ringRadius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`
  }

  const targetArcPath = targetArcSpanPct > 0 ? describeArc(arcStartPct, arcEndPct) : null
  const carLimitAngle = safeCarLimit != null ? (safeCarLimit / 100) * 360 - 90 : null
  const carLimitInner = carLimitAngle != null
    ? {
        x: ringCenter + (ringRadius - ringStroke / 2 - 6) * Math.cos((carLimitAngle * Math.PI) / 180),
        y: ringCenter + (ringRadius - ringStroke / 2 - 6) * Math.sin((carLimitAngle * Math.PI) / 180),
      }
    : null
  const carLimitOuter = carLimitAngle != null
    ? {
        x: ringCenter + (ringRadius + ringStroke / 2 + 6) * Math.cos((carLimitAngle * Math.PI) / 180),
        y: ringCenter + (ringRadius + ringStroke / 2 + 6) * Math.sin((carLimitAngle * Math.PI) / 180),
      }
    : null

  return (
    <div
      ref={ringRef}
      className={clsx(
        'relative select-none',
        readonly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
      style={{ width: `${ringSize}px`, height: `${ringSize}px`, touchAction: 'none' }}
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
      <svg
        viewBox={`0 0 ${ringSize} ${ringSize}`}
        className="h-full w-full transition-all"
        style={charging ? { filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.45))' } : undefined}
      >
        <defs>
          <pattern
            id="soc-delta-hatch"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(-45 0 0)"
          >
            <rect width="10" height="10" fill="rgb(34,197,94)" fillOpacity="0.85" />
            <line x1="5" y1="0" x2="5" y2="10" stroke="rgba(255,255,255,0.55)" strokeWidth="3" />
          </pattern>
        </defs>
        <circle
          cx={ringCenter}
          cy={ringCenter}
          r={ringRadius}
          fill="none"
          stroke="rgba(127,127,127,0.24)"
          strokeWidth={ringStroke}
        />
        <circle
          cx={ringCenter}
          cy={ringCenter}
          r={ringRadius}
          fill="none"
          stroke="rgb(34, 197, 94)"
          strokeWidth={ringStroke}
          strokeDasharray={`${actualLength} ${circumference}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          transform={`rotate(-90 ${ringCenter} ${ringCenter})`}
          className={clsx(charging && 'animate-pulse')}
        />
        {targetArcPath && safeActual < safeTarget && (
          <path
            d={targetArcPath}
            fill="none"
            stroke="url(#soc-delta-hatch)"
            strokeWidth={ringStroke}
            strokeLinecap="butt"
          />
        )}
        {carLimitInner != null && carLimitOuter != null && (
          <line
            x1={carLimitInner.x}
            y1={carLimitInner.y}
            x2={carLimitOuter.x}
            y2={carLimitOuter.y}
            stroke="rgb(251, 191, 36)"
            strokeWidth={5}
            strokeLinecap="round"
          />
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0 m-[34px] flex flex-col items-center justify-center rounded-full border border-evload-border/60 bg-evload-bg shadow-[inset_0_2px_8px_rgba(0,0,0,0.18)]">
        <div className="text-5xl font-black text-evload-text leading-none tracking-tight">{safeActual}%</div>
        <div className="mt-1.5 text-[10px] uppercase tracking-[0.22em] text-evload-muted font-semibold">State Of Charge</div>
        <div className="mt-3 rounded-full border border-evload-border/80 bg-evload-surface/90 px-3 py-0.5 text-[12px] font-bold text-evload-text shadow-sm">
          Target {safeTarget}%
        </div>
        <div className="mt-2.5 text-[10px] text-evload-muted/80 text-center px-3 leading-relaxed">
          {currentRangeKm != null ? `${Math.round(currentRangeKm)} km` : '—'} now&nbsp;·&nbsp;{targetRangeKm != null ? `${targetRangeKm} km` : '—'} target
        </div>
      </div>

      <div
        className="absolute h-7 w-7 rounded-full border-2 border-evload-bg bg-evload-success shadow-[0_0_0_3px_rgba(34,197,94,0.4)]"
        style={{ left: `${knobX - 14}px`, top: `${knobY - 14}px` }}
        title={`Target ${safeTarget}%`}
      />
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
  const etaEndTime =
    etaHours != null && etaHours > 0 && Number.isFinite(etaHours)
      ? new Date(Date.now() + etaHours * 3_600_000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : null
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
            <p className="mt-1 text-sm text-evload-muted">Fast operational control, clear planner status, and mobile-optimized UX.</p>
          </div>
          <div className="sm:min-w-[420px] space-y-2">
            <div className="rounded-full border border-evload-border bg-evload-bg p-1 flex items-center justify-between">
              <ModePill active={chargeMode === 'off'} label="Off" onClick={() => applyMode('off')} disabled={controlsDisabled} />
              <ModePill active={chargeMode === 'plan'} label="Plan" onClick={() => applyMode('plan')} disabled={controlsDisabled} />
              <ModePill active={chargeMode === 'on'} label="On" onClick={() => applyMode('on')} disabled={controlsDisabled} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-evload-border bg-evload-bg/80 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-evload-muted">Car</div>
                <div className="mt-1 text-sm font-semibold text-evload-text">{carStatusLabel}</div>
              </div>
              <div className="rounded-2xl border border-evload-border bg-evload-bg/80 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-evload-muted">Engine</div>
                <div className="mt-1 text-sm font-semibold text-evload-text">{enginePhaseLabel}</div>
              </div>
              <div className="rounded-2xl border border-evload-border bg-evload-bg/80 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-evload-muted">Cable</div>
                <div className={clsx('mt-1 text-sm font-semibold', vehicle?.pluggedIn ? 'text-emerald-300' : 'text-orange-300')}>
                  {vehicle?.pluggedIn ? 'Connected' : 'Not connected'}
                </div>
              </div>
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

      <div className="grid items-stretch gap-4 xl:grid-cols-[1.25fr_1fr]">
        <section className="h-full bg-evload-surface/90 border border-evload-border rounded-3xl p-4 sm:p-5 shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-evload-muted font-semibold">Charge Cockpit</div>
              <h2 className="mt-1 text-xl font-semibold text-evload-text flex items-center gap-2"><Car size={18} /> {vehicle.displayName ?? 'Vehicle'}</h2>
              <div className="mt-1 text-xs text-evload-muted">Proxy: {proxyConnected ? 'Online' : 'Offline'}</div>
              {statusReason && <div className="mt-1 text-xs text-amber-300">Reason: {statusReason}</div>}
            </div>
            <div className="text-right text-xs text-evload-muted">
              <div>VIN</div>
              <div className="font-mono text-[11px] text-evload-text">{vehicle.vin ?? '-'}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="relative min-h-[88px] rounded-xl border border-evload-border bg-evload-bg/75 p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-evload-muted whitespace-nowrap">Live Power</div>
              <div className="text-lg font-semibold text-evload-text whitespace-nowrap">{displayChargePowerKw.toFixed(2)} kW</div>
              <div className="absolute left-2 right-2 bottom-2 rounded-md border border-evload-border/60 bg-evload-bg/85 px-2 py-1 text-[11px] text-evload-text/90">
                {haChargerPowerW != null ? 'HA source' : 'Vehicle source'}
              </div>
            </div>
            <div className="relative min-h-[100px] rounded-xl border border-evload-border bg-evload-bg/75 p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-evload-muted whitespace-nowrap">Estimated End</div>
              <div className="text-base font-bold text-evload-text whitespace-nowrap leading-snug">{etaToChargeEnd}</div>
              {etaEndTime != null && (
                <div className="text-[11px] text-evload-muted whitespace-nowrap mt-0.5 mb-2.5">
                  {etaEndTime}
                </div>
              )}
              <div className="absolute left-2 right-2 bottom-2 rounded-md border border-evload-border/60 bg-evload-bg/85 px-2 py-1 text-[11px] text-evload-text/90" title={etaSourceLabel}>
                {vehicle?.charging ? 'Live charge model' : 'Idle forecast'}
              </div>
            </div>
            <div className="relative min-h-[88px] rounded-xl border border-evload-border bg-evload-bg/75 p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-evload-muted whitespace-nowrap">Charge Mode</div>
              <div className="text-lg font-semibold text-evload-text whitespace-nowrap">{chargeMode.toUpperCase()}</div>
              <div className="absolute left-2 right-2 bottom-2 rounded-md border border-evload-border/60 bg-evload-bg/85 px-2 py-1 text-[11px] text-evload-text/90">
                {isPlanMode ? 'Plan active' : 'Direct control'}
              </div>
            </div>
            <div className="relative min-h-[88px] rounded-xl border border-evload-border bg-evload-bg/75 p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-evload-muted whitespace-nowrap">Session Cost</div>
              <div className="text-lg font-semibold text-evload-text whitespace-nowrap">{cumulativeChargeCostEur != null ? `${cumulativeChargeCostEur.toFixed(2)} EUR` : '—'}</div>
              <div className="absolute left-2 right-2 bottom-2 rounded-md border border-evload-border/60 bg-evload-bg/85 px-2 py-1 text-[11px] text-evload-text/90">
                Energy: {chargedEnergyWh != null ? `${chargedEnergyWh} Wh` : '—'}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-4">
            <SocRingControl
              actualSoc={soc}
              targetSoc={effectiveTargetSoc}
              carLimitSoc={carLimitSoc}
              currentRangeKm={currentRangeKm}
              targetRangeKm={estimatedRangeAtTargetKm}
              charging={vehicle.charging}
              readonly={isPlanMode}
              onTargetChange={(v) => {
                flog.debug('TARGET_SOC', 'Ring dragged', {
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
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {isPlanMode && (
                <div className="rounded-full border border-evload-border/60 bg-evload-bg/60 px-3 py-1 text-[11px] text-evload-muted">
                  Target controlled by active plan
                </div>
              )}
              {timeToTarget.error && (
                <div className="text-xs text-evload-error bg-evload-error/10 border border-evload-error/30 rounded-full px-3 py-1">{timeToTarget.error}</div>
              )}
              {carLimitSoc != null && carLimitSoc < effectiveTargetSoc && (
                <div className="text-xs text-amber-300 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1">Hardware limit active at {carLimitSoc}%</div>
              )}
              {canWakeVehicle && (
                <button
                  onClick={handleWakeVehicle}
                  disabled={waking || !proxyConnected}
                  className="inline-flex items-center rounded-full border border-evload-border bg-evload-bg px-3 py-1 text-xs font-semibold text-evload-text transition-colors hover:bg-evload-border/50 disabled:opacity-60"
                >
                  {waking ? 'Waking...' : 'Wake Vehicle'}
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="space-y-4 xl:h-full xl:flex xl:flex-col">
          <section className="bg-evload-surface/90 border border-evload-border rounded-3xl p-4 sm:p-5 shadow-[0_20px_40px_rgba(0,0,0,0.08)] xl:flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-evload-muted font-semibold">Power Snapshot</div>
                <h3 className="mt-1 text-lg font-semibold text-evload-text">Home vs EV</h3>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-evload-muted">Grid Total</div>
                <div className="text-xl font-black text-evload-text">{(homeTotalPowerW / 1000).toFixed(2)} kW</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <div
                className="h-36 w-36 rounded-full border border-evload-border"
                style={{
                  background: `conic-gradient(#22c55e 0 ${homeBaseLoadSharePct}%, #facc15 ${homeBaseLoadSharePct}% 100%)`,
                }}
              >
                <div className="m-4 h-28 w-28 rounded-full bg-evload-surface border border-evload-border flex items-center justify-center text-xs font-semibold text-evload-muted">
                  Split
                </div>
              </div>
              <div className="flex-1 space-y-2 text-xs">
                <div className="flex items-center justify-between rounded-lg border border-evload-border/60 bg-evload-bg/50 px-2 py-1.5">
                  <span className="text-evload-muted">Home Base</span>
                  <span className="font-semibold text-evload-text">{homeBaseLoadSharePct.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-evload-border/60 bg-evload-bg/50 px-2 py-1.5">
                  <span className="text-evload-muted">EV Charging</span>
                  <span className="font-semibold text-evload-text">{chargerLoadSharePct.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FlowStatRow
                icon={<Home size={14} className="text-emerald-100" />}
                label="Home Base"
                value={`${(homeNonChargingPowerW / 1000).toFixed(2)} kW`}
                accentClass="bg-emerald-500/70 text-emerald-100"
              />
              <FlowStatRow
                icon={<ZapIcon size={14} className="text-yellow-950" />}
                label="EV Charging"
                value={`${(chargerPowerW / 1000).toFixed(2)} kW`}
                accentClass="bg-yellow-400/90 text-yellow-950"
              />
            </div>
          </section>

          <section
            className={clsx(
              'rounded-3xl border p-4 sm:p-5 transition-all xl:flex-1',
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
                <div className="text-[11px] uppercase tracking-[0.2em] text-evload-muted">Plan Timeline</div>
                <h3 className="mt-1 text-base font-bold text-evload-text">{finishByWakeStatus.title}</h3>
                <p className="mt-1 text-sm text-evload-muted">{finishByWakeStatus.detail}</p>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg border border-evload-border/60 bg-evload-bg/50 px-2 py-1.5">
                    <span className="text-evload-muted">Next Start</span>
                    <span className="font-semibold text-evload-text">{nextChargeStartTime ?? 'No schedule'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-evload-border/60 bg-evload-bg/50 px-2 py-1.5">
                    <span className="text-evload-muted">Finish Deadline</span>
                    <span className="font-semibold text-evload-text">{nextCharge?.finishBy ? new Date(nextCharge.finishBy).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="bg-evload-surface/90 border border-evload-border rounded-3xl p-4 sm:p-5 text-evload-text shadow-[0_20px_40px_rgba(0,0,0,0.08)]">
        <div className="mt-1 border-t border-evload-border pt-4">
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
                <div className="text-xs uppercase tracking-wide text-evload-muted">Vehicle Energy (from session start)</div>
                <div className="mt-1 text-sm font-semibold text-evload-text">{vehicleChargedEnergyKwh != null ? `${vehicleChargedEnergyKwh.toFixed(2)} kWh` : '—'}</div>
                <div className="mt-1 text-[11px] text-evload-muted">charge_energy_added minus session-start baseline</div>
              </div>

              <div className="rounded-xl border border-evload-border bg-evload-bg/70 p-3">
                <div className="text-xs uppercase tracking-wide text-evload-muted">Vehicle Energy (raw Tesla proxy)</div>
                <div className="mt-1 text-sm font-semibold text-evload-text">{vehicleChargedEnergyRawKwh != null ? `${vehicleChargedEnergyRawKwh.toFixed(2)} kWh` : '—'}</div>
                <div className="mt-1 text-[11px] text-evload-muted">charge_energy_added directly from proxy</div>
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
                  (Tesla session energy / meter energy) x 100
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

      <VehicleRawProxyPanel rawChargeState={vehicle.rawChargeState} />
    </div>
  )
}
