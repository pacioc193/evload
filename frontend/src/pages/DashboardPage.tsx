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
        {soc.toFixed(0)} %
      </span>
    </div>
  )
}

function StatCard({ label, value, unit, icon: Icon, color }: {
  label: string
  value: string | number | null
  unit?: string
  icon: React.ElementType
  color?: string
}) {
  return (
    <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-evload-muted text-sm mb-2">
        <Icon size={16} className={color} />
        {label}
      </div>
      <div className="text-2xl font-bold">
        {value !== null && value !== undefined ? (
          <>
            {value}
            {unit && <span className="text-sm font-normal text-evload-muted ml-1">{unit}</span>}
          </>
        ) : (
          <span className="text-evload-muted text-lg">0</span>
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
  const [loading, setLoading] = useState(false)

  const soc = Math.max(0, Math.min(100, vehicle?.stateOfCharge ?? 0))
  const homeW = Math.max(0, ha?.powerW ?? 0)
  const vehicleW = Math.max(0, Math.round((vehicle?.chargeRateKw ?? 0) * 1000))
  const houseW = Math.max(0, homeW - vehicleW)

  const handleStart = async () => {
    setLoading(true)
    try {
      await startCharging(Math.max(1, targetSoc))
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await stopCharging()
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {vehicle?.displayName && <span className="text-evload-muted text-sm">{vehicle.displayName}</span>}
      </div>

      {isDemo && (
        <div className="bg-evload-warning/10 border border-evload-warning text-evload-warning rounded-xl px-4 py-2 text-sm font-medium">
          Demo mode active - simulated data, no real vehicle
        </div>
      )}

      {!wsConnected && !vehicle && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-evload-muted">
            <WifiOff size={20} />
            <span>Connecting to backend...</span>
          </div>
          <p className="text-xs text-evload-muted">Make sure the backend server is running.</p>
        </div>
      )}

      {wsConnected && !vehicle && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">
          <div className="animate-pulse">Waiting for vehicle data...</div>
          <p className="text-xs mt-2">If Demo Mode is enabled, data arrives within ~2 seconds.</p>
        </div>
      )}

      {vehicle && !vehicle.connected && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center space-y-2">
          <p className="text-evload-muted">Vehicle not connected</p>
        </div>
      )}

      {vehicle?.connected && (
        <>
          {ha && (
            <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-lg">Energy Flow</h2>
                <span className="text-xs text-evload-muted">Home {(homeW / 1000).toFixed(1)} kW</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
                <div className="bg-evload-bg border border-evload-border rounded-lg px-3 py-2">
                  <div className="text-evload-muted text-xs">Home Total</div>
                  <div className="font-semibold">{homeW.toFixed(0)} W</div>
                </div>
                <div className="bg-evload-bg border border-evload-border rounded-lg px-3 py-2">
                  <div className="text-evload-muted text-xs">Vehicle</div>
                  <div className="font-semibold">{vehicleW.toFixed(0)} W</div>
                </div>
                <div className="bg-evload-bg border border-evload-border rounded-lg px-3 py-2">
                  <div className="text-evload-muted text-xs">House</div>
                  <div className="font-semibold">{houseW.toFixed(0)} W</div>
                </div>
              </div>
              <div className="text-xs text-evload-muted bg-evload-bg border border-evload-border rounded-lg px-3 py-2">
                House equation: Home Total = House + Car.
              </div>
            </div>
          )}

          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Battery</h2>
              <span className="text-sm text-evload-muted">{vehicle.batteryRange != null ? `${vehicle.batteryRange.toFixed(0)} km` : '0 km'}</span>
            </div>

            {!engine?.running && (
              <div>
                <label className="block text-sm text-evload-muted mb-1">Target SoC: {targetSoc.toFixed(0)} %</label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={targetSoc}
                  onChange={(e) => setTargetSoc(Number(e.target.value))}
                  className="w-full accent-evload-accent"
                />
              </div>
            )}

            <BatteryBar soc={soc} charging={vehicle.charging} />

            <div className="flex items-center gap-4 text-sm text-evload-muted">
              <span>Charge: <strong className="text-evload-text">{soc.toFixed(0)} %</strong></span>
              <span>Plug: <strong className="text-evload-text">{vehicle.pluggedIn ? 'Plugged in' : 'Unplugged'}</strong></span>
              {vehicle.timeToFullChargeH != null && vehicle.timeToFullChargeH > 0 && (
                <span>Full in: <strong className="text-evload-text">{vehicle.timeToFullChargeH.toFixed(1)} h</strong></span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Charge Rate" value={vehicle.chargeRateKw?.toFixed(2) ?? '0.00'} unit="kW" icon={Zap} color="text-evload-accent" />
            <StatCard label="Current" value={vehicle.chargerActualCurrent ?? 0} unit="A" icon={Activity} color="text-evload-warning" />
            <StatCard label="Voltage" value={vehicle.chargerVoltage ?? 0} unit="V" icon={Zap} color="text-evload-success" />
            <StatCard label="Cabin Temp" value={vehicle.insideTempC?.toFixed(1) ?? '0.0'} unit="°C" icon={Thermometer} color="text-evload-text" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Setpoint" value={engine?.setpointAmps ?? 0} unit="A" icon={Activity} color="text-evload-accent" />
            <StatCard label="Actual" value={vehicle.chargerActualCurrent ?? 0} unit="A" icon={Activity} color="text-evload-warning" />
            <StatCard label="Target SoC" value={engine?.targetSoc ?? targetSoc} unit="%" icon={Zap} color="text-evload-success" />
            <StatCard label="Engine Phase" value={engine?.phase ?? 'idle'} icon={Zap} color="text-evload-text" />
          </div>

          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Charging Control</h2>
            {engine?.haThrottled && (
              <div className="bg-evload-warning/10 border border-evload-warning text-evload-warning rounded-lg px-3 py-2 text-sm">
                HA throttling active - home power limit reached
              </div>
            )}
            {engine?.running ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={clsx('w-2 h-2 rounded-full', engine.phase === 'charging' ? 'bg-evload-success animate-pulse' : engine.phase === 'balancing' ? 'bg-evload-warning animate-pulse' : 'bg-evload-muted')} />
                  <span className="text-sm">{engine.message}</span>
                </div>
                <button
                  onClick={handleStop}
                  disabled={loading || !!failsafe?.active}
                  className="px-6 py-2 bg-evload-error hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Stop Charging
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={handleStart}
                  disabled={loading || !!failsafe?.active}
                  className="px-6 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Start Charging Control
                </button>
                <p className="text-sm text-evload-muted">Ampere control uses min/max limits configured in Settings YAML.</p>
              </div>
            )}
          </div>

          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-3">
            <h2 className="font-semibold text-lg">Engine Live Log</h2>
            <div className="text-xs text-evload-muted">
              Last decisions from control loop (setpoint computation, HA throttling, charging commands).
            </div>
            <div className="bg-evload-bg border border-evload-border rounded-lg p-3 h-56 overflow-auto font-mono text-xs leading-5">
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
        </>
      )}
    </div>
  )
}
