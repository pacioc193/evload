import { useState } from 'react'
import { useWsStore } from '../store/wsStore'
import { api } from '../api/index'
import { Thermometer, Wind, Power, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

export default function ClimatePage() {
  const vehicle = useWsStore((s) => s.vehicle)
  const [targetTemp, setTargetTemp] = useState(21)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const sendCommand = async (cmd: string, body?: Record<string, unknown>) => {
    setLoading(true)
    setMessage('')
    try {
      await api.post(`/vehicle/command/${cmd}`, body ?? {})
      setMessage('Command sent successfully')
    } catch {
      setMessage('Command failed')
    } finally {
      setLoading(false)
      setTimeout(() => setMessage(''), 3000)
    }
  }

  return (
    <div className="ev-page">
      <section className="ev-hero">
        <div className="pointer-events-none absolute -right-12 -top-10 h-36 w-36 rounded-full bg-orange-300/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-12 h-44 w-44 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-evload-border bg-evload-bg/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-evload-muted">
              <Sparkles size={12} className="text-evload-accent" />
              Comfort Intelligence
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Climate Control</h1>
            <p className="mt-1 text-sm text-evload-muted">Regola temperatura abitacolo con comandi rapidi e feedback chiaro.</p>
          </div>
        </div>
      </section>

      {!vehicle?.connected && vehicle?.vin !== 'DEMO000000000001' ? (
        <div className="ev-card text-center text-evload-muted py-8">
          Vehicle not connected
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="ev-card">
              <div className="text-evload-muted text-sm mb-1 flex items-center gap-2"><Thermometer size={16} />Cabin Temp</div>
              <div className="text-3xl font-black">{vehicle.insideTempC?.toFixed(1) ?? '—'}°C</div>
            </div>
            <div className="ev-card">
              <div className="text-evload-muted text-sm mb-1 flex items-center gap-2"><Wind size={16} />Outside Temp</div>
              <div className="text-3xl font-black">{vehicle.outsideTempC?.toFixed(1) ?? '—'}°C</div>
            </div>
          </div>

          <div className="ev-card-strong space-y-4">
            <h2 className="font-semibold text-lg">Climate Status</h2>
            <div className="flex items-center gap-2">
              <span className={clsx('w-3 h-3 rounded-full', vehicle.climateOn ? 'bg-evload-success animate-pulse' : 'bg-evload-muted')} />
              <span>{vehicle.climateOn ? 'Climate ON' : 'Climate OFF'}</span>
            </div>
          </div>

          <div className="ev-card-strong space-y-4">
            <h2 className="font-semibold text-lg">Controls</h2>
            <div>
              <label className="block text-sm text-evload-muted mb-2">Target Temperature: {targetTemp}°C</label>
              <input type="range" min={15} max={30} value={targetTemp}
                onChange={(e) => setTargetTemp(Number(e.target.value))}
                className="w-full accent-evload-accent mb-4" />
            </div>
            <div className="flex gap-3 flex-wrap">
              <button onClick={() => sendCommand('auto_conditioning_start')} disabled={loading}
                className="ev-btn-primary disabled:opacity-50">
                <Power size={16} /> Start Climate
              </button>
              <button onClick={() => sendCommand('auto_conditioning_stop')} disabled={loading}
                className="ev-btn-ghost disabled:opacity-50">
                <Power size={16} /> Stop Climate
              </button>
              <button onClick={() => sendCommand('set_temps', { driver_temp: targetTemp, passenger_temp: targetTemp })} disabled={loading}
                className="ev-btn-ghost disabled:opacity-50">
                <Thermometer size={16} /> Set Temp
              </button>
            </div>
            {message && <p className="text-sm text-evload-success">{message}</p>}
          </div>
        </>
      )}
    </div>
  )
}
