import React, { useState } from 'react'
import { useWsStore } from '../store/wsStore'
import { api } from '../api/index'
import { Thermometer, Wind, Power } from 'lucide-react'
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Climate Control</h1>
      {!vehicle?.connected ? (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">
          Vehicle not connected
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
              <div className="text-evload-muted text-sm mb-1 flex items-center gap-2"><Thermometer size={16} />Cabin Temp</div>
              <div className="text-3xl font-bold">{vehicle.insideTempC?.toFixed(1) ?? '—'}°C</div>
            </div>
            <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
              <div className="text-evload-muted text-sm mb-1 flex items-center gap-2"><Wind size={16} />Outside Temp</div>
              <div className="text-3xl font-bold">{vehicle.outsideTempC?.toFixed(1) ?? '—'}°C</div>
            </div>
          </div>
          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Climate Status</h2>
            <div className="flex items-center gap-2">
              <span className={clsx('w-3 h-3 rounded-full', vehicle.climateOn ? 'bg-evload-success animate-pulse' : 'bg-evload-muted')} />
              <span>{vehicle.climateOn ? 'Climate ON' : 'Climate OFF'}</span>
            </div>
          </div>
          <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Controls</h2>
            <div>
              <label className="block text-sm text-evload-muted mb-2">Target Temperature: {targetTemp}°C</label>
              <input type="range" min={15} max={30} value={targetTemp}
                onChange={(e) => setTargetTemp(Number(e.target.value))}
                className="w-full accent-evload-accent mb-4" />
            </div>
            <div className="flex gap-3 flex-wrap">
              <button onClick={() => sendCommand('auto_conditioning_start')} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                <Power size={16} /> Start Climate
              </button>
              <button onClick={() => sendCommand('auto_conditioning_stop')} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-evload-border hover:bg-evload-surface text-evload-text rounded-lg font-medium transition-colors disabled:opacity-50">
                <Power size={16} /> Stop Climate
              </button>
              <button onClick={() => sendCommand('set_temps', { driver_temp: targetTemp, passenger_temp: targetTemp })} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-evload-surface border border-evload-border hover:bg-evload-border text-evload-text rounded-lg font-medium transition-colors disabled:opacity-50">
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
