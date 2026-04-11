import { useEffect, useRef, useState, useCallback } from 'react'
import { Zap, Square, Plug, Thermometer, Play, Moon, Sun, Wifi, WifiOff } from 'lucide-react'
import { useWsStore } from '../store/wsStore'
import { startCharging, stopCharging } from '../api/index'
import { sendVehicleCommand } from '../api/index'
import { flog } from '../utils/frontendLogger'
import { clsx } from 'clsx'

const GARAGE_SCREEN_TIMEOUT_KEY = 'evload.garageScreenTimeout'
const DEFAULT_SCREEN_TIMEOUT_MIN = 5

function formatETA(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return '—'
  const totalMin = Math.round(hours * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatKw(kw: number | null | undefined): string {
  if (kw == null || !Number.isFinite(kw) || kw <= 0) return '—'
  return `${kw.toFixed(1)} kW`
}

function formatW(w: number | null | undefined): string {
  if (w == null || !Number.isFinite(w)) return '—'
  if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`
  return `${Math.round(w)} W`
}

export default function GaragePage() {
  const vehicle = useWsStore((s) => s.vehicle)
  const engine = useWsStore((s) => s.engine)
  const ha = useWsStore((s) => s.ha)
  const proxy = useWsStore((s) => s.proxy)
  const wsConnected = useWsStore((s) => s.connected)

  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [targetSoc, setTargetSoc] = useState(80)
  const [showSocSlider, setShowSocSlider] = useState(false)

  // Screen saver state
  const [screenDim, setScreenDim] = useState(false)
  const [screenOff, setScreenOff] = useState(false)
  const [screenTimeoutMin, setScreenTimeoutMin] = useState<number>(() => {
    const stored = localStorage.getItem(GARAGE_SCREEN_TIMEOUT_KEY)
    return stored ? Number(stored) : DEFAULT_SCREEN_TIMEOUT_MIN
  })
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a reference to the active WakeLockSentinel so we can release before requesting a new one
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)

  const saveScreenTimeout = (val: number) => {
    setScreenTimeoutMin(val)
    localStorage.setItem(GARAGE_SCREEN_TIMEOUT_KEY, String(val))
  }

  const wakeScreen = useCallback(() => {
    setScreenDim(false)
    setScreenOff(false)

    // Try Screen Wake Lock API to prevent browser from sleeping.
    // Release any existing sentinel before requesting a new one to avoid leaks.
    if ('wakeLock' in navigator) {
      const nav = navigator as Navigator & { wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> } }
      const prevLock = wakeLockRef.current
      if (prevLock) {
        prevLock.release().catch(() => {})
        wakeLockRef.current = null
      }
      nav.wakeLock.request('screen')
        .then((sentinel) => { wakeLockRef.current = sentinel })
        .catch(() => {})
    }

    // Reset timers
    if (activityTimer.current) clearTimeout(activityTimer.current)
    if (dimTimer.current) clearTimeout(dimTimer.current)

    if (screenTimeoutMin > 0) {
      // Dim after 80% of the timeout, go fully dark at 100%
      dimTimer.current = setTimeout(() => setScreenDim(true), screenTimeoutMin * 60 * 1000 * 0.8)
      activityTimer.current = setTimeout(() => setScreenOff(true), screenTimeoutMin * 60 * 1000)
    }
  }, [screenTimeoutMin])

  // Register activity listeners
  useEffect(() => {
    const events = ['touchstart', 'mousedown', 'mousemove', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, wakeScreen, { passive: true }))
    wakeScreen()
    return () => {
      events.forEach((e) => window.removeEventListener(e, wakeScreen))
      if (activityTimer.current) clearTimeout(activityTimer.current)
      if (dimTimer.current) clearTimeout(dimTimer.current)
      // Release wake lock on unmount
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
  }, [wakeScreen])

  const isCharging = engine?.phase === 'charging' || engine?.phase === 'balancing'
  const engineRunning = engine?.running ?? false
  const soc = vehicle?.stateOfCharge ?? null
  const proxyOk = proxy?.connected ?? false

  const clearMsg = () => setTimeout(() => setStatusMsg(null), 4000)

  const handleStart = async () => {
    setBusy(true)
    setStatusMsg(null)
    try {
      await startCharging(targetSoc)
      setStatusMsg(`✅ Charging started -> ${targetSoc}%`)
      setShowSocSlider(false)
      flog.info('GARAGE', 'Charge started', { targetSoc })
    } catch (e) {
      setStatusMsg('❌ Start failed')
      flog.error('GARAGE', 'Start failed', { e })
    } finally {
      setBusy(false)
      clearMsg()
    }
  }

  const handleStop = async () => {
    setBusy(true)
    setStatusMsg(null)
    try {
      await stopCharging()
      setStatusMsg('⏹ Charging stopped')
      flog.info('GARAGE', 'Charge stopped')
    } catch (e) {
      setStatusMsg('❌ Stop failed')
      flog.error('GARAGE', 'Stop failed', { e })
    } finally {
      setBusy(false)
      clearMsg()
    }
  }

  const handleUnplug = async () => {
    setBusy(true)
    setStatusMsg(null)
    try {
      flog.info('GARAGE', 'Unlatch triggered', { cmd: 'charge_port_door_open' })
      await sendVehicleCommand('charge_port_door_open')
      setStatusMsg('🔌 Charge port opened')
      flog.info('GARAGE', 'Charge port open')
    } catch (e) {
      setStatusMsg('❌ Open command failed')
      flog.error('GARAGE', 'Charge port open failed', { e })
    } finally {
      setBusy(false)
      clearMsg()
    }
  }

  const handleDefrost = async () => {
    setBusy(true)
    setStatusMsg(null)
    try {
      await sendVehicleCommand('defrost_max', { on: true })
      setStatusMsg('🌡️ Defrost enabled')
      flog.info('GARAGE', 'Defrost activated')
    } catch (e) {
      setStatusMsg('❌ Defrost failed')
      flog.error('GARAGE', 'Defrost failed', { e })
    } finally {
      setBusy(false)
      clearMsg()
    }
  }

  // Charging status colours
  const chargingColor = isCharging
    ? 'text-green-400'
    : engineRunning
    ? 'text-yellow-400'
    : engine?.phase === 'complete'
    ? 'text-blue-400'
    : 'text-evload-muted'

  const chargingBorder = isCharging
    ? 'border-green-500'
    : engineRunning
    ? 'border-yellow-500'
    : 'border-evload-border'

  const socBarColor = isCharging ? 'bg-green-500' : soc != null && soc >= 80 ? 'bg-blue-500' : 'bg-evload-accent'

  // Next scheduled charge info
  const nextScheduleMsg = engine?.mode === 'plan' ? `Plan armed -> ${engine.targetSoc}%` : null

  return (
    <div className="relative min-h-screen bg-evload-bg text-evload-text flex flex-col select-none">

      {/* ── Screen saver overlay ─────────────────────────────────────────── */}
      {(screenDim || screenOff) && (
        <div
          className={clsx(
            'fixed inset-0 z-50 transition-opacity duration-1000 flex items-center justify-center cursor-pointer',
            screenOff ? 'bg-black opacity-100' : 'bg-black opacity-60'
          )}
          onTouchStart={wakeScreen}
          onMouseDown={wakeScreen}
        >
          {!screenOff && (
            <div className="text-white/30 text-sm flex flex-col items-center gap-2">
              <Moon size={32} />
              <span>Tap to wake screen</span>
            </div>
          )}
        </div>
      )}

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-evload-border bg-evload-surface shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="text-evload-accent" size={22} />
          <span className="font-bold text-lg">evload</span>
          <span className="text-xs text-evload-muted hidden sm:inline">Garage</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {wsConnected ? (
            <span className="flex items-center gap-1 text-green-400"><Wifi size={14} />Live</span>
          ) : (
            <span className="flex items-center gap-1 text-red-400"><WifiOff size={14} />Offline</span>
          )}
          {!proxyOk && (
            <span className="text-xs text-red-400 font-semibold">Proxy KO</span>
          )}
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">

        {/* ── Status card ──────────────────────────────────────────── */}
        <div className={clsx('rounded-2xl border p-5 bg-evload-surface flex flex-col gap-4', chargingBorder)}>

          {/* SOC bar */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-4xl font-bold">
                {soc != null ? `${soc}%` : '—'}
              </span>
              <span className={clsx('text-lg font-semibold', chargingColor)}>
                {isCharging ? '⚡ Charging' : engineRunning ? '⏳ Starting...' : engine?.phase === 'complete' ? '✅ Complete' : '💤 Idle'}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-4 rounded-full bg-evload-border overflow-hidden">
              <div
                className={clsx('h-full rounded-full transition-all duration-500', socBarColor)}
                style={{ width: `${soc ?? 0}%` }}
              />
            </div>
            {engine?.targetSoc && engineRunning && (
              <div className="text-xs text-evload-muted text-right">Target: {engine.targetSoc}%</div>
            )}
          </div>

          {/* Cable status indicator */}
          {vehicle != null && (
            <div className={clsx(
              'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
              vehicle.pluggedIn
                ? 'bg-green-500/10 border border-green-500/40 text-green-400'
                : 'bg-orange-500/10 border border-orange-500/40 text-orange-400'
            )}>
              <Plug size={18} />
              {vehicle.pluggedIn ? 'Cable connected' : 'Cable disconnected'}
              {vehicle.cableType && vehicle.pluggedIn && (
                <span className="ml-auto text-xs font-normal opacity-70">{vehicle.cableType}</span>
              )}
            </div>
          )}

          {/* Metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="rounded-xl bg-evload-bg p-3">
              <div className="text-2xl font-bold">{formatKw(vehicle?.chargeRateKw)}</div>
              <div className="text-xs text-evload-muted mt-1">Charging power</div>
            </div>
            <div className="rounded-xl bg-evload-bg p-3">
              <div className="text-2xl font-bold">{formatETA(vehicle?.timeToFullChargeH)}</div>
              <div className="text-xs text-evload-muted mt-1">Charge ETA</div>
            </div>
            <div className="rounded-xl bg-evload-bg p-3">
              <div className="text-2xl font-bold">{formatW(ha?.powerW)}</div>
              <div className="text-xs text-evload-muted mt-1">Home load</div>
            </div>
            <div className="rounded-xl bg-evload-bg p-3">
              <div className="text-2xl font-bold">{vehicle?.chargerActualCurrent != null ? `${vehicle.chargerActualCurrent}A` : '—'}</div>
              <div className="text-xs text-evload-muted mt-1">Current</div>
            </div>
          </div>

          {/* Next schedule */}
          {nextScheduleMsg && (
            <div className="text-center text-sm text-evload-muted border-t border-evload-border pt-3">
              🗓️ {nextScheduleMsg}
            </div>
          )}

          {/* Engine message */}
          {engine?.message && (
            <div className="text-center text-xs text-evload-muted">{engine.message}</div>
          )}
        </div>

        {/* ── Car Options ───────────────────────────────────────── */}
        <div className="rounded-2xl bg-evload-surface border border-evload-border p-4 flex flex-col gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-evload-muted mb-0.5">Vehicle Controls</div>
            <div className="text-[11px] text-evload-muted">Direct vehicle commands. Requires active proxy connectivity.</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

            {/* Start / Stop */}
            {!engineRunning ? (
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => showSocSlider ? handleStart() : setShowSocSlider(true)}
                  disabled={busy || !vehicle?.pluggedIn}
                  className={clsx(
                    'flex flex-col items-center justify-center gap-2 rounded-2xl p-5 min-h-[88px]',
                    'bg-green-600 hover:bg-green-500 text-white font-semibold text-base',
                    'disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  )}
                >
                  <Play size={28} />
                  {showSocSlider ? `Start -> ${targetSoc}%` : 'Start'}
                </button>
                <p className="text-[10px] text-evload-muted text-center">Start an EVload charging session with the selected SoC target</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleStop}
                  disabled={busy}
                  className={clsx(
                    'flex flex-col items-center justify-center gap-2 rounded-2xl p-5 min-h-[88px]',
                    'bg-red-600 hover:bg-red-500 text-white font-semibold text-base',
                    'disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  )}
                >
                  <Square size={28} />
                  Stop
                </button>
                <p className="text-[10px] text-evload-muted text-center">Stop the active charging session and release EVload control</p>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <button
                onClick={handleUnplug}
                disabled={busy}
                className={clsx(
                  'flex flex-col items-center justify-center gap-2 rounded-2xl p-5 min-h-[88px]',
                  'bg-evload-surface border border-evload-border hover:bg-evload-border',
                  'font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                )}
              >
                <Plug size={28} />
                Unlatch
              </button>
              <p className="text-[10px] text-evload-muted text-center">Open the charge-port door</p>
            </div>

            <div className="flex flex-col gap-1">
              <button
                onClick={handleDefrost}
                disabled={busy}
                className={clsx(
                  'flex flex-col items-center justify-center gap-2 rounded-2xl p-5 min-h-[88px]',
                  'bg-evload-surface border border-evload-border hover:bg-evload-border',
                  'font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                )}
              >
                <Thermometer size={28} />
                Defrost
              </button>
              <p className="text-[10px] text-evload-muted text-center">Enable maximum defrost for windshield and cabin</p>
            </div>
          </div>
        </div>

        {/* ── Screen Options ─────────────────────────────────────── */}
        <div className="rounded-2xl bg-evload-surface border border-evload-border p-4 flex flex-col gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-evload-muted mb-0.5">Screen Options</div>
            <div className="text-[11px] text-evload-muted">Control tablet screen behavior in garage mode.</div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Automatic screen saver</div>
                <div className="text-[11px] text-evload-muted">
                  {screenTimeoutMin === 0
                    ? 'Disabled — screen stays always on.'
                    : `Screen dims after ${screenTimeoutMin} min of inactivity, then turns fully off at timeout.`}
                </div>
              </div>
              <button
                onClick={() => screenTimeoutMin > 0 ? saveScreenTimeout(0) : saveScreenTimeout(DEFAULT_SCREEN_TIMEOUT_MIN)}
                className={clsx(
                  'flex flex-col items-center justify-center gap-1 rounded-2xl px-4 py-3 min-w-[80px]',
                  'border transition-colors font-semibold text-sm',
                  screenTimeoutMin === 0
                    ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                    : 'border-evload-border bg-evload-bg hover:bg-evload-border text-evload-text'
                )}
              >
                {screenTimeoutMin === 0 ? <Sun size={22} /> : <Moon size={22} />}
                {screenTimeoutMin === 0 ? 'Enable' : 'Disable'}
              </button>
            </div>
            {screenTimeoutMin > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-evload-muted">Minutes of inactivity before screen off</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={screenTimeoutMin}
                    onChange={(e) => saveScreenTimeout(Number(e.target.value))}
                    className="flex-1 h-2 rounded-full accent-red-500"
                  />
                  <span className="text-sm font-semibold w-12 text-right">{screenTimeoutMin} min</span>
                </div>
                <div className="flex gap-2 mt-1">
                  {[3, 5, 10, 15].map((m) => (
                    <button
                      key={m}
                      onClick={() => saveScreenTimeout(m)}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                        screenTimeoutMin === m
                          ? 'border-evload-accent bg-evload-accent/10 text-evload-accent'
                          : 'border-evload-border hover:bg-evload-border text-evload-muted'
                      )}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[10px] text-evload-muted">
              On Raspberry Pi, set <code>GARAGE_MODE=true</code> in .env to physically power off the display via DPMS.
            </p>
          </div>
        </div>

        {/* ── SOC Slider (shown after Start tap) ───────────────────── */}
        {showSocSlider && !engineRunning && (
          <div className="rounded-2xl bg-evload-surface border border-evload-border p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Target SoC</span>
              <span className="text-2xl font-bold text-evload-accent">{targetSoc}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={targetSoc}
              onChange={(e) => setTargetSoc(Number(e.target.value))}
              className="w-full h-3 rounded-full accent-red-500"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowSocSlider(false)}
                className="flex-1 py-3 rounded-xl border border-evload-border text-sm font-medium hover:bg-evload-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={busy}
                className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold disabled:opacity-40 transition-colors"
              >
                ▶ Start → {targetSoc}%
              </button>
            </div>
          </div>
        )}

        {/* ── Status message ────────────────────────────────────────── */}
        {statusMsg && (
          <div className="text-center text-sm py-2 px-4 rounded-xl bg-evload-surface border border-evload-border">
            {statusMsg}
          </div>
        )}

      </div>
    </div>
  )
}
