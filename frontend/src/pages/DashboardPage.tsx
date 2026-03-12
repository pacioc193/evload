import React, { useState } from 'react'
import { useWsStore } from '../store/wsStore'
import { startCharging, stopCharging } from '../api/index'
import { Zap, Thermometer, Activity, WifiOff } from 'lucide-react'
import { clsx } from 'clsx'

function BatteryBar({ soc, charging }: { soc: number; charging: boolean }) {
  const color = soc >= 80 ? 'bg-evload-success' : soc >= 30 ? 'bg-evload-warning' : 'bg-evload-error'
  return (
    <div className="relative w-full h-6 bg-evload-border rounded-full overflow-hidden">
      <div
        className={clsx('h-full rounded-full transition-all duration-1000', color, charging && 'animate-pulse')}
        style={{ width: `${soc}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
        {soc}%
      </span>
    </div>
  )
}

function StatCard({ label, value, unit, icon: Icon, color }: {
  label: string; value: string | number | null; unit?: string; icon: React.ElementType; color?: string
}) {
  return (
    <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-evload-muted text-sm mb-2">
        <Icon size={16} className={color} />
        {label}
      </div>
      <div className="text-2xl font-bold">
        {value !== null && value !== undefined ? (
          <>{value}{unit && <span className="text-sm font-normal text-evload-muted ml-1">{unit}</span>}</>
        ) : (
          <span className="text-evload-muted text-lg">—</span>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const vehicle = useWsStore((s) => s.vehicle)
  const engine = useWsStore((s) => s.engine)
  const ha = useWsStore((s) => s.ha)
  const failsafe = useWsStore((s) => s.failsafe)
  const wsConnected = useWsStore((s) => s.connected)
  const isDemo = vehicle?.vin === 'DEMO000000000001'
  const [targetSoc, setTargetSoc] = useState(80)
  const [targetAmps, setTargetAmps] = useState(16)
  const [loading, setLoading] = useState(false)

  const handleStart = async () => {
    setLoading(true)
    try { await startCharging(targetSoc, targetAmps) } catch { /* handled by interceptor */ }
    finally { setLoading(false) }
  }

  const handleStop = async () => {
    setLoading(true)
    try { await stopCharging() } catch { /* handled by interceptor */ }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {vehicle?.displayName && <span className="text-evload-muted text-sm">{vehicle.displayName}</span>}
      </div>

      {isDemo && (
        <div className="bg-evload-warning/10 border border-evload-warning text-evload-warning rounded-xl px-4 py-2 text-sm font-medium">
          🎮 Demo mode active — simulated data, no real vehicle
        </div>
      )}

      {/* WS not connected yet */}
      {!wsConnected && !vehicle && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-evload-muted">
            <WifiOff size={20} />
            <span>Connecting to backend…</span>
          </div>
          <p className="text-xs text-evload-muted">Make sure the backend server is running.</p>
        </div>
      )}

      {/* WS connected but no vehicle data yet (first tick pending) */}
      {wsConnected && !vehicle && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">
          <div className="animate-pulse">Waiting for vehicle data…</div>
          <p className="text-xs mt-2">
            If Demo Mode is enabled, data arrives within ~2 seconds.
            <br />If not, configure your Proxy URL and Vehicle ID in{' '}
            <a href="/settings" className="text-evload-accent underline">Settings</a>.
          </p>
        </div>
      )}

      {/* Vehicle data received but not connected */}
      {vehicle && !vehicle.connected && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center space-y-2">
          <p className="text-evload-muted">Vehicle not connected</p>
          {!isDemo && (
            <p className="text-xs text-evload-muted">
              Check Proxy URL / Vehicle ID in{' '}
              <a href="/settings" className="text-evload-accent underline">Settings</a>, or enable{' '}
              <a href="/settings" className="text-evload-accent underline">Demo Mode</a> to test the UI.
            </p>
          )}
        </div>
      )}

      {vehicle?.connected && (
        <>
          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Battery</h2>
            <BatteryBar soc={vehicle.stateOfCharge ?? 0} charging={vehicle.charging} />
            <div className="flex items-center gap-4 text-sm text-evload-muted">
              <span>State: <strong className="text-evload-text">{vehicle.chargingState ?? 'Unknown'}</strong></span>
              <span>Plug: <strong className="text-evload-text">{vehicle.pluggedIn ? 'Plugged in' : 'Unplugged'}</strong></span>
              {vehicle.timeToFullChargeH != null && vehicle.timeToFullChargeH > 0 && (
                <span>Full in: <strong className="text-evload-text">{vehicle.timeToFullChargeH.toFixed(1)}h</strong></span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Charge Rate" value={vehicle.chargeRateKw?.toFixed(1) ?? null} unit="kW" icon={Zap} color="text-evload-accent" />
            <StatCard label="Current" value={vehicle.chargerActualCurrent} unit="A" icon={Activity} color="text-evload-warning" />
            <StatCard label="Voltage" value={vehicle.chargerVoltage} unit="V" icon={Zap} color="text-evload-success" />
            <StatCard label="Cabin Temp" value={vehicle.insideTempC?.toFixed(1) ?? null} unit="°C" icon={Thermometer} color="text-evload-text" />
          </div>

          {ha && (
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Home Power" value={ha.powerW?.toFixed(0) ?? null} unit="W" icon={Zap} color="text-evload-accent" />
              {ha.gridW != null && (
                <StatCard label="Grid Power" value={ha.gridW.toFixed(0)} unit="W" icon={Activity} color="text-evload-text" />
              )}
            </div>
          )}

          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Charging Control</h2>
            {engine?.haThrottled && (
              <div className="bg-evload-warning/10 border border-evload-warning text-evload-warning rounded-lg px-3 py-2 text-sm">
                ⚡ HA throttling active — home power limit reached
              </div>
            )}
            {engine?.running ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={clsx('w-2 h-2 rounded-full', engine.phase === 'charging' ? 'bg-evload-success animate-pulse' : engine.phase === 'balancing' ? 'bg-evload-warning animate-pulse' : 'bg-evload-muted')} />
                  <span className="text-sm">{engine.message}</span>
                </div>
                <button onClick={handleStop} disabled={loading || !!failsafe?.active}
                  className="px-6 py-2 bg-evload-error hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                  Stop Charging
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-evload-muted mb-1">Target SoC: {targetSoc}%</label>
                    <input type="range" min={1} max={100} value={targetSoc}
                      onChange={(e) => setTargetSoc(Number(e.target.value))}
                      className="w-full accent-evload-accent" />
                  </div>
                  <div>
                    <label className="block text-sm text-evload-muted mb-1">Target Amps: {targetAmps}A</label>
                    <input type="range" min={5} max={32} value={targetAmps}
                      onChange={(e) => setTargetAmps(Number(e.target.value))}
                      className="w-full accent-evload-accent" />
                  </div>
                </div>
                <button onClick={handleStart}
                  disabled={loading || !!failsafe?.active || (!vehicle.pluggedIn && !isDemo)}
                  className="px-6 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                  Start Charging Control
                </button>
                {!vehicle.pluggedIn && !isDemo && (
                  <p className="text-sm text-evload-muted">Vehicle must be plugged in to start charging control</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
