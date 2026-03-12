import React, { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar
} from 'recharts'
import { getSessions, getSession } from '../api/index'
import { BarChart2, Zap, Battery, Clock } from 'lucide-react'

interface Session {
  id: number
  startedAt: string
  endedAt: string | null
  totalEnergyKwh: number
  _count?: { telemetry: number }
}

interface TelemetryPoint {
  recordedAt: string
  voltageV: number | null
  currentA: number | null
  stateOfCharge: number | null
  chargerPower: number | null
}

interface SessionDetail {
  id: number
  startedAt: string
  endedAt: string | null
  totalEnergyKwh: number
  telemetry: TelemetryPoint[]
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt) : new Date()
  const diff = end.getTime() - new Date(startedAt).getTime()
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}

export default function StatisticsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)

  useEffect(() => {
    getSessions(1, 20)
      .then((data) => setSessions(data.sessions as Session[]))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const loadSession = async (id: number) => {
    setSessionLoading(true)
    try {
      setSelectedSession(await getSession(id) as SessionDetail)
    } catch (err) { console.error(err) }
    finally { setSessionLoading(false) }
  }

  const telemetryData = selectedSession?.telemetry.map((t, i) => ({
    time: i,
    label: new Date(t.recordedAt).toLocaleTimeString(),
    voltage: t.voltageV,
    current: t.currentA,
    soc: t.stateOfCharge,
    chargerPower: t.chargerPower,
  })) ?? []

  const totalEnergy = sessions.reduce((sum, s) => sum + s.totalEnergyKwh, 0)
  const avgEnergy = sessions.length ? totalEnergy / sessions.length : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Statistics</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Sessions', value: sessions.length, unit: '', icon: BarChart2 },
          { label: 'Total Energy', value: totalEnergy.toFixed(1), unit: 'kWh', icon: Zap },
          { label: 'Avg Energy', value: avgEnergy.toFixed(1), unit: 'kWh', icon: Battery },
          { label: 'Last Session', value: sessions[0] ? new Date(sessions[0].startedAt).toLocaleDateString() : '—', unit: '', icon: Clock },
        ].map(({ label, value, unit, icon: Icon }) => (
          <div key={label} className="bg-evload-surface border border-evload-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-evload-muted text-sm mb-2"><Icon size={16} />{label}</div>
            <div className="text-2xl font-bold">{value}{unit && <span className="text-sm text-evload-muted ml-1">{unit}</span>}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-evload-surface border border-evload-border rounded-xl p-4">
          <h2 className="font-semibold mb-3">Sessions</h2>
          {loading ? <p className="text-evload-muted text-sm">Loading...</p> :
            sessions.length === 0 ? <p className="text-evload-muted text-sm">No sessions yet</p> : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {sessions.map((s) => (
                  <button key={s.id} onClick={() => loadSession(s.id)}
                    className="w-full text-left p-3 rounded-lg border border-evload-border hover:border-evload-accent transition-colors">
                    <div className="text-sm font-medium">{new Date(s.startedAt).toLocaleString()}</div>
                    <div className="text-xs text-evload-muted mt-1 flex gap-3">
                      <span>{s.totalEnergyKwh.toFixed(2)} kWh</span>
                      <span>{formatDuration(s.startedAt, s.endedAt)}</span>
                      {s._count && <span>{s._count.telemetry} pts</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {sessionLoading && <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">Loading...</div>}
          {selectedSession && !sessionLoading && telemetryData.length > 0 && (
            <>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
                <h3 className="font-medium mb-3 text-sm text-evload-muted">State of Charge (%)</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={telemetryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fill: '#888', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} />
                    <Area type="monotone" dataKey="soc" stroke="#22c55e" fill="#22c55e20" name="SoC %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
                <h3 className="font-medium mb-3 text-sm text-evload-muted">Power & Current</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={telemetryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="power" tick={{ fill: '#888', fontSize: 10 }} />
                    <YAxis yAxisId="current" orientation="right" tick={{ fill: '#888', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="power" type="monotone" dataKey="chargerPower" stroke="#e31937" name="Power (kW)" dot={false} />
                    <Line yAxisId="current" type="monotone" dataKey="current" stroke="#f59e0b" name="Current (A)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
                <h3 className="font-medium mb-3 text-sm text-evload-muted">Voltage (V)</h3>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={telemetryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#888', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} />
                    <Line type="monotone" dataKey="voltage" stroke="#60a5fa" name="Voltage (V)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          {selectedSession && !sessionLoading && telemetryData.length === 0 && (
            <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">No telemetry data</div>
          )}
          {!selectedSession && !sessionLoading && (
            <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">Select a session to view charts</div>
          )}
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
          <h3 className="font-medium mb-3">Energy per Session (kWh)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sessions.slice(0, 10).reverse().map((s) => ({ name: `#${s.id}`, energy: s.totalEnergyKwh }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 12 }} />
              <YAxis tick={{ fill: '#888', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} />
              <Bar dataKey="energy" fill="#e31937" name="Energy (kWh)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
