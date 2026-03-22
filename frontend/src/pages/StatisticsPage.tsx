import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar
} from 'recharts'
import { deleteSession, getSessions, getSession } from '../api/index'
import { BarChart2, Zap, Battery, Clock, Trash2 } from 'lucide-react'

const EFFICIENCY_STORAGE_KEY = 'evload.vehicleEfficiencyPct'
const EFFICIENCY_HISTORY_STORAGE_KEY = 'evload.statistics.efficiencyHistory'

interface EfficiencyHistorySample {
  ts: string
  valuePct: number
}

interface Session {
  id: number
  startedAt: string
  endedAt: string | null
  totalEnergyKwh: number
  totalCostEur: number
  energyPriceEurPerKwh: number
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
  totalCostEur: number
  energyPriceEurPerKwh: number
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
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<number | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  const [lastEfficiencyPct, setLastEfficiencyPct] = useState<number | null>(null)
  const [avgEfficiencyPct, setAvgEfficiencyPct] = useState<number | null>(null)
  const [efficiencySamplesCount, setEfficiencySamplesCount] = useState(0)

  const loadSessions = async () => {
    const data = await getSessions(1, 20)
    setSessions(data.sessions as Session[])
  }

  useEffect(() => {
    loadSessions()
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const rawHistory = window.localStorage.getItem(EFFICIENCY_HISTORY_STORAGE_KEY)
    const parsed = rawHistory ? JSON.parse(rawHistory) : []
    const history = Array.isArray(parsed)
      ? parsed.filter((item): item is EfficiencyHistorySample => {
        if (!item || typeof item !== 'object') return false
        const candidate = item as Partial<EfficiencyHistorySample>
        return typeof candidate.ts === 'string' && typeof candidate.valuePct === 'number' && Number.isFinite(candidate.valuePct)
      })
      : []

    if (history.length > 0) {
      const avg = history.reduce((sum, sample) => sum + sample.valuePct, 0) / history.length
      const last = history[history.length - 1]
      setAvgEfficiencyPct(avg)
      setLastEfficiencyPct(last.valuePct)
      setEfficiencySamplesCount(history.length)
      return
    }

    const legacy = Number(window.localStorage.getItem(EFFICIENCY_STORAGE_KEY))
    if (Number.isFinite(legacy) && legacy > 0) {
      setLastEfficiencyPct(legacy)
      setAvgEfficiencyPct(legacy)
      setEfficiencySamplesCount(1)
    }
  }, [])

  const loadSession = async (id: number) => {
    setSessionLoading(true)
    setPendingDeleteSessionId(null)
    try {
      setSelectedSession(await getSession(id) as SessionDetail)
    } catch (err) { console.error(err) }
    finally { setSessionLoading(false) }
  }

  const handleDeleteSession = async (session: Session) => {
    if (pendingDeleteSessionId !== session.id) {
      setPendingDeleteSessionId(session.id)
      setSessionMessage('')
      return
    }

    const confirmed = window.confirm(`Delete charging session #${session.id} from ${new Date(session.startedAt).toLocaleString()}? This cannot be undone.`)
    if (!confirmed) return

    setDeletingSessionId(session.id)
    setSessionMessage('')

    try {
      await deleteSession(session.id)
      setSessions((prev) => prev.filter((item) => item.id !== session.id))
      if (selectedSession?.id === session.id) {
        setSelectedSession(null)
      }
      setPendingDeleteSessionId(null)
      setSessionMessage(`Session #${session.id} deleted`)
    } catch (err) {
      console.error(err)
      setSessionMessage('Delete failed')
    } finally {
      setDeletingSessionId(null)
    }
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
  const totalCost = sessions.reduce((sum, s) => sum + (s.totalCostEur ?? 0), 0)
  const avgCost = sessions.length ? totalCost / sessions.length : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Statistics</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Sessions', value: sessions.length, unit: '', icon: BarChart2 },
          { label: 'Total Energy', value: totalEnergy.toFixed(1), unit: 'kWh', icon: Zap },
          { label: 'Total Cost', value: totalCost.toFixed(2), unit: 'EUR', icon: Battery },
          { label: 'Avg Session Cost', value: avgCost.toFixed(2), unit: 'EUR', icon: Clock },
          { label: 'Avg Energy', value: avgEnergy.toFixed(1), unit: 'kWh', icon: Zap },
          { label: 'Avg Charge Efficiency', value: avgEfficiencyPct != null ? avgEfficiencyPct.toFixed(2) : '—', unit: avgEfficiencyPct != null ? '%' : '', icon: Battery },
          { label: 'Last Charge Efficiency', value: lastEfficiencyPct != null ? lastEfficiencyPct.toFixed(2) : '—', unit: lastEfficiencyPct != null ? '%' : '', icon: Zap },
          { label: 'Efficiency Samples', value: efficiencySamplesCount, unit: '', icon: BarChart2 },
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
          <p className="mb-3 text-xs text-evload-muted">Delete requires two confirmations: arm the action first, then approve the browser confirmation dialog.</p>
          {sessionMessage && <p className="mb-3 text-sm text-evload-muted">{sessionMessage}</p>}
          {loading ? <p className="text-evload-muted text-sm">Loading...</p> :
            sessions.length === 0 ? <p className="text-evload-muted text-sm">No sessions yet</p> : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {sessions.map((s) => (
                  <div key={s.id} className="rounded-lg border border-evload-border p-3 transition-colors hover:border-evload-accent">
                    <div className="flex items-start justify-between gap-3">
                      <button onClick={() => loadSession(s.id)} className="flex-1 text-left">
                        <div className="text-sm font-medium">{new Date(s.startedAt).toLocaleString()}</div>
                        <div className="text-xs text-evload-muted mt-1 flex flex-wrap gap-3">
                          <span>{s.totalEnergyKwh.toFixed(2)} kWh</span>
                          <span>{(s.totalCostEur ?? 0).toFixed(2)} EUR</span>
                          <span>@ {(s.energyPriceEurPerKwh ?? 0).toFixed(3)} EUR/kWh</span>
                          <span>{formatDuration(s.startedAt, s.endedAt)}</span>
                          {s._count && <span>{s._count.telemetry} pts</span>}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSession(s)}
                        disabled={deletingSessionId === s.id}
                        className={pendingDeleteSessionId === s.id
                          ? 'flex items-center gap-1 rounded-md border border-red-500 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50'
                          : 'flex items-center gap-1 rounded-md border border-evload-border px-2 py-1 text-xs text-evload-muted hover:text-evload-error disabled:opacity-50'}
                        title={pendingDeleteSessionId === s.id ? 'Click again to open the final confirmation dialog' : 'Arm delete for this charging session'}
                      >
                        <Trash2 size={12} />
                        {deletingSessionId === s.id ? 'Deleting...' : pendingDeleteSessionId === s.id ? 'Confirm Delete' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {sessionLoading && <div className="bg-evload-surface border border-evload-border rounded-xl p-6 text-center text-evload-muted">Loading...</div>}
          {selectedSession && !sessionLoading && telemetryData.length > 0 && (
            <>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Session Energy</div>
                  <div className="text-xl font-semibold">{selectedSession.totalEnergyKwh.toFixed(2)} kWh</div>
                </div>
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Session Cost</div>
                  <div className="text-xl font-semibold">{(selectedSession.totalCostEur ?? 0).toFixed(2)} EUR</div>
                </div>
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Applied Tariff</div>
                  <div className="text-xl font-semibold">{(selectedSession.energyPriceEurPerKwh ?? 0).toFixed(3)} EUR/kWh</div>
                </div>
              </div>
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
