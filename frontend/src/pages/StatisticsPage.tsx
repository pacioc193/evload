import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ReferenceArea
} from 'recharts'
import { deleteSession, getSessions, getSession } from '../api/index'
import { BarChart2, Zap, Battery, Clock, Trash2, Maximize2, X, ZoomIn } from 'lucide-react'
import { useWsStore } from '../store/wsStore'

type ZoomedChart = 'soc' | 'powerCurrent' | 'voltage' | 'energyBar' | null

interface Session {
  id: number
  startedAt: string
  endedAt: string | null
  totalEnergyKwh: number
  meterEnergyKwh?: number
  vehicleEnergyKwh?: number
  chargingEfficiencyPct?: number | null
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
  meterEnergyKwh?: number
  vehicleEnergyKwh?: number
  chargingEfficiencyPct?: number | null
  totalCostEur: number
  energyPriceEurPerKwh: number
  telemetry: TelemetryPoint[]
  totalTelemetryPoints?: number
}

function formatChartTimeTick(tsMs: number): string {
  const d = new Date(tsMs)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatChartTimeLabel(tsMs: number): string {
  const d = new Date(tsMs)
  return d.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt) : new Date()
  const diff = end.getTime() - new Date(startedAt).getTime()
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return ''
  const raw = String(value)
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

export default function StatisticsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<number | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  const [zoomedChart, setZoomedChart] = useState<ZoomedChart>(null)

  // Zoom state for the pop-up modal charts
  const [zoomRefLeft, setZoomRefLeft] = useState<number | null>(null)
  const [zoomRefRight, setZoomRefRight] = useState<number | null>(null)
  const [zoomXDomain, setZoomXDomain] = useState<[number | string, number | string]>(['dataMin', 'dataMax'])
  const [zoomYDomain, setZoomYDomain] = useState<[number | string, number | string]>(['auto', 'auto'])
  const isZoomed = zoomXDomain[0] !== 'dataMin' || zoomYDomain[0] !== 'auto'

  const resetZoom = () => {
    setZoomRefLeft(null)
    setZoomRefRight(null)
    setZoomXDomain(['dataMin', 'dataMax'])
    setZoomYDomain(['auto', 'auto'])
  }

  const handleZoomMouseDown = (e: { activeLabel?: number | string; activePayload?: { value: number }[] } | null) => {
    if (!e || e.activeLabel == null) return
    const x = e.activeLabel as number
    setZoomRefLeft(x)
    setZoomRefRight(null)
  }

  const handleZoomMouseMove = (e: { activeLabel?: number | string; activePayload?: { value: number }[] } | null) => {
    if (!e || zoomRefLeft == null) return
    const x = e.activeLabel as number
    setZoomRefRight(x)
  }

  const handleZoomMouseUp = () => {
    if (zoomRefLeft == null || zoomRefRight == null) {
      setZoomRefLeft(null)
      setZoomRefRight(null)
      return
    }
    let x1 = zoomRefLeft
    let x2 = zoomRefRight
    if (x1 === x2) {
      setZoomRefLeft(null)
      setZoomRefRight(null)
      return
    }
    if (x1 > x2) { const tmp = x1; x1 = x2; x2 = tmp }
    setZoomXDomain([x1, x2])
    setZoomYDomain(['auto', 'auto'])
    setZoomRefLeft(null)
    setZoomRefRight(null)
  }

  // Reset zoom when changing chart in modal
  const openZoomedChart = (chart: ZoomedChart) => {
    resetZoom()
    setZoomedChart(chart)
  }

  const engineSessionId = useWsStore((s) => s.engine?.sessionId ?? null)
  const prevSessionIdRef = useRef<number | null>(engineSessionId)

  const loadSessions = async () => {
    const data = await getSessions(1, 20)
    setSessions(data.sessions as Session[])
  }

  useEffect(() => {
    loadSessions()
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Close zoom modal on Escape
  useEffect(() => {
    if (!zoomedChart) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { resetZoom(); setZoomedChart(null) } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [zoomedChart])

  // Reload sessions list when a charging session ends (sessionId goes from a value to null)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = engineSessionId
    if (prev !== null && engineSessionId === null) {
      // Small delay to let the backend commit the final session data
      const timer = setTimeout(() => {
        loadSessions().catch(console.error)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [engineSessionId])

  const loadSession = async (id: number) => {
    setSessionLoading(true)
    setPendingDeleteSessionId(null)
    try {
      setSelectedSession(await getSession(id) as SessionDetail)
    } catch (err) { console.error(err) }
    finally { setSessionLoading(false) }
  }

  const downloadSelectedSessionCsv = () => {
    if (!selectedSession) return

    const sessionStart = new Date(selectedSession.startedAt)
    const safeDate = `${sessionStart.getFullYear()}-${String(sessionStart.getMonth() + 1).padStart(2, '0')}-${String(sessionStart.getDate()).padStart(2, '0')}_${String(sessionStart.getHours()).padStart(2, '0')}-${String(sessionStart.getMinutes()).padStart(2, '0')}`
    const filename = `evload-session-${selectedSession.id}-${safeDate}.csv`

    const headerRows = [
      ['session_id', selectedSession.id],
      ['started_at', selectedSession.startedAt],
      ['ended_at', selectedSession.endedAt ?? ''],
      ['total_energy_kwh', selectedSession.totalEnergyKwh],
      ['meter_energy_kwh', selectedSession.meterEnergyKwh ?? selectedSession.totalEnergyKwh],
      ['vehicle_energy_kwh', selectedSession.vehicleEnergyKwh ?? ''],
      ['charging_efficiency_pct', selectedSession.chargingEfficiencyPct ?? ''],
      ['total_cost_eur', selectedSession.totalCostEur],
      ['energy_price_eur_per_kwh', selectedSession.energyPriceEurPerKwh],
      ['telemetry_points', selectedSession.telemetry.length],
      ['total_telemetry_points', selectedSession.totalTelemetryPoints ?? selectedSession.telemetry.length],
    ]

    const telemetryHeader = ['recorded_at', 'voltage_v', 'current_a', 'state_of_charge_pct', 'charger_power_kw']
    const telemetryRows = selectedSession.telemetry.map((t) => [
      t.recordedAt,
      t.voltageV,
      t.currentA,
      t.stateOfCharge,
      t.chargerPower,
    ])

    const csvLines = [
      ...headerRows.map((row) => row.map((value) => csvEscape(value)).join(',')),
      '',
      telemetryHeader.map((value) => csvEscape(value)).join(','),
      ...telemetryRows.map((row) => row.map((value) => csvEscape(value)).join(',')),
    ]

    const csvContent = csvLines.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.URL.revokeObjectURL(url)
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

  const telemetryData = (() => {
    if (!selectedSession?.telemetry.length) return []
    return selectedSession.telemetry.map((t) => {
      const recordedAtMs = new Date(t.recordedAt).getTime()
      return {
        time: recordedAtMs,
        label: formatChartTimeLabel(recordedAtMs),
        voltage: t.voltageV,
        current: t.currentA,
        soc: t.stateOfCharge,
        chargerPower: t.chargerPower,
      }
    })
  })()

  const totalEnergy = sessions.reduce((sum, s) => sum + s.totalEnergyKwh, 0)
  const avgEnergy = sessions.length ? totalEnergy / sessions.length : 0
  const totalCost = sessions.reduce((sum, s) => sum + (s.totalCostEur ?? 0), 0)
  const avgCost = sessions.length ? totalCost / sessions.length : 0
  const efficiencyValues = sessions
    .map((s) => s.chargingEfficiencyPct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const avgEfficiencyPct = efficiencyValues.length > 0
    ? efficiencyValues.reduce((sum, value) => sum + value, 0) / efficiencyValues.length
    : null
  const lastEfficiencyPct = sessions.find((s) => typeof s.chargingEfficiencyPct === 'number' && Number.isFinite(s.chargingEfficiencyPct) && (s.chargingEfficiencyPct ?? 0) > 0)?.chargingEfficiencyPct ?? null
  const efficiencySamplesCount = efficiencyValues.length

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
          {selectedSession && !sessionLoading && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={downloadSelectedSessionCsv}
                className="rounded-md border border-evload-border px-3 py-1.5 text-xs font-medium text-evload-text hover:bg-evload-border/40"
              >
                Download CSV
              </button>
            </div>
          )}
          {selectedSession && !sessionLoading && telemetryData.length > 0 && (
            <>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Meter Energy</div>
                  <div className="text-xl font-semibold">{(selectedSession.meterEnergyKwh ?? selectedSession.totalEnergyKwh).toFixed(2)} kWh</div>
                </div>
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Vehicle Battery Energy</div>
                  <div className="text-xl font-semibold">{(selectedSession.vehicleEnergyKwh ?? 0).toFixed(2)} kWh</div>
                </div>
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Charging Efficiency</div>
                  <div className="text-xl font-semibold">{selectedSession.chargingEfficiencyPct != null ? `${selectedSession.chargingEfficiencyPct.toFixed(2)}%` : '—'}</div>
                </div>
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Session Cost</div>
                  <div className="text-xl font-semibold">{(selectedSession.totalCostEur ?? 0).toFixed(2)} EUR</div>
                </div>
                <div>
                  <div className="text-evload-muted uppercase tracking-wide text-xs">Applied Tariff</div>
                  <div className="text-xl font-semibold">{(selectedSession.energyPriceEurPerKwh ?? 0).toFixed(3)} EUR/kWh</div>
                </div>
                {selectedSession.totalTelemetryPoints != null && (
                  <div>
                    <div className="text-evload-muted uppercase tracking-wide text-xs">Telemetry Points</div>
                    <div className="text-xl font-semibold">
                      {telemetryData.length}
                      {selectedSession.totalTelemetryPoints > telemetryData.length && (
                        <span className="text-sm text-evload-muted ml-1">/ {selectedSession.totalTelemetryPoints} (downsampled)</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-evload-muted">State of Charge (%)</h3>
                  <button onClick={() => openZoomedChart('soc')} className="text-evload-muted hover:text-evload-text transition-colors" title="Expand chart"><Maximize2 size={15} /></button>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={telemetryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatChartTimeTick} tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fill: '#888', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelFormatter={(v: number) => formatChartTimeLabel(v)} />
                    <Area type="monotone" dataKey="soc" stroke="#22c55e" fill="#22c55e20" name="SoC %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-evload-muted">Power & Current</h3>
                  <button onClick={() => openZoomedChart('powerCurrent')} className="text-evload-muted hover:text-evload-text transition-colors" title="Expand chart"><Maximize2 size={15} /></button>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={telemetryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatChartTimeTick} tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="power" tick={{ fill: '#888', fontSize: 10 }} />
                    <YAxis yAxisId="current" orientation="right" tick={{ fill: '#888', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelFormatter={(v: number) => formatChartTimeLabel(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="power" type="monotone" dataKey="chargerPower" stroke="#e31937" name="Power (kW)" dot={false} />
                    <Line yAxisId="current" type="monotone" dataKey="current" stroke="#f59e0b" name="Current (A)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-evload-surface border border-evload-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-sm text-evload-muted">Voltage (V)</h3>
                  <button onClick={() => openZoomedChart('voltage')} className="text-evload-muted hover:text-evload-text transition-colors" title="Expand chart"><Maximize2 size={15} /></button>
                </div>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={telemetryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatChartTimeTick} tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#888', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelFormatter={(v: number) => formatChartTimeLabel(v)} />
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
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Energy per Session (kWh)</h3>
            <button onClick={() => openZoomedChart('energyBar')} className="text-evload-muted hover:text-evload-text transition-colors" title="Expand chart"><Maximize2 size={15} /></button>
          </div>
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

      {/* Chart Zoom Modal */}
      {zoomedChart && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => { resetZoom(); setZoomedChart(null) }}
        >
          <div
            className="bg-evload-surface border border-evload-border rounded-2xl p-6 w-full max-w-4xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">
                {zoomedChart === 'soc' && 'State of Charge (%)'}
                {zoomedChart === 'powerCurrent' && 'Power & Current'}
                {zoomedChart === 'voltage' && 'Voltage (V)'}
                {zoomedChart === 'energyBar' && 'Energy per Session (kWh)'}
              </h3>
              <div className="flex items-center gap-2">
                {isZoomed && (
                  <button onClick={resetZoom} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-evload-border text-evload-muted hover:text-evload-text transition-colors" title="Reset zoom">
                    <ZoomIn size={13} />Reset zoom
                  </button>
                )}
                {!isZoomed && zoomedChart !== 'energyBar' && (
                  <span className="text-xs text-evload-muted select-none">Drag to zoom</span>
                )}
                <button onClick={() => { resetZoom(); setZoomedChart(null) }} className="text-evload-muted hover:text-evload-text transition-colors"><X size={20} /></button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={500}>
              {zoomedChart === 'soc' ? (
                <AreaChart
                  data={telemetryData}
                  onMouseDown={(e) => handleZoomMouseDown(e as Parameters<typeof handleZoomMouseDown>[0])}
                  onMouseMove={(e) => handleZoomMouseMove(e as Parameters<typeof handleZoomMouseMove>[0])}
                  onMouseUp={handleZoomMouseUp}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="time" type="number" domain={zoomXDomain} tickFormatter={formatChartTimeTick} tick={{ fill: '#888', fontSize: 11 }} interval="preserveStartEnd" allowDataOverflow />
                  <YAxis domain={isZoomed ? zoomYDomain : [0, 100]} tick={{ fill: '#888', fontSize: 11 }} allowDataOverflow />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelFormatter={(v: number) => formatChartTimeLabel(v)} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Area type="monotone" dataKey="soc" stroke="#22c55e" fill="#22c55e20" name="SoC %" isAnimationActive={false} />
                  {zoomRefLeft != null && zoomRefRight != null && (
                    <ReferenceArea x1={zoomRefLeft} x2={zoomRefRight} strokeOpacity={0.3} fill="#ffffff" fillOpacity={0.1} />
                  )}
                </AreaChart>
              ) : zoomedChart === 'powerCurrent' ? (
                <LineChart
                  data={telemetryData}
                  onMouseDown={(e) => handleZoomMouseDown(e as Parameters<typeof handleZoomMouseDown>[0])}
                  onMouseMove={(e) => handleZoomMouseMove(e as Parameters<typeof handleZoomMouseMove>[0])}
                  onMouseUp={handleZoomMouseUp}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="time" type="number" domain={zoomXDomain} tickFormatter={formatChartTimeTick} tick={{ fill: '#888', fontSize: 11 }} interval="preserveStartEnd" allowDataOverflow />
                  <YAxis yAxisId="power" domain={isZoomed ? zoomYDomain : ['auto', 'auto']} tick={{ fill: '#888', fontSize: 11 }} allowDataOverflow />
                  <YAxis yAxisId="current" orientation="right" domain={isZoomed ? zoomYDomain : ['auto', 'auto']} tick={{ fill: '#888', fontSize: 11 }} allowDataOverflow />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelFormatter={(v: number) => formatChartTimeLabel(v)} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Line yAxisId="power" type="monotone" dataKey="chargerPower" stroke="#e31937" name="Power (kW)" dot={false} isAnimationActive={false} />
                  <Line yAxisId="current" type="monotone" dataKey="current" stroke="#f59e0b" name="Current (A)" dot={false} isAnimationActive={false} />
                  {zoomRefLeft != null && zoomRefRight != null && (
                    <ReferenceArea yAxisId="power" x1={zoomRefLeft} x2={zoomRefRight} strokeOpacity={0.3} fill="#ffffff" fillOpacity={0.1} />
                  )}
                </LineChart>
              ) : zoomedChart === 'voltage' ? (
                <LineChart
                  data={telemetryData}
                  onMouseDown={(e) => handleZoomMouseDown(e as Parameters<typeof handleZoomMouseDown>[0])}
                  onMouseMove={(e) => handleZoomMouseMove(e as Parameters<typeof handleZoomMouseMove>[0])}
                  onMouseUp={handleZoomMouseUp}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="time" type="number" domain={zoomXDomain} tickFormatter={formatChartTimeTick} tick={{ fill: '#888', fontSize: 11 }} interval="preserveStartEnd" allowDataOverflow />
                  <YAxis domain={isZoomed ? zoomYDomain : ['auto', 'auto']} tick={{ fill: '#888', fontSize: 11 }} allowDataOverflow />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} labelFormatter={(v: number) => formatChartTimeLabel(v)} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Line type="monotone" dataKey="voltage" stroke="#60a5fa" name="Voltage (V)" dot={false} isAnimationActive={false} />
                  {zoomRefLeft != null && zoomRefRight != null && (
                    <ReferenceArea x1={zoomRefLeft} x2={zoomRefRight} strokeOpacity={0.3} fill="#ffffff" fillOpacity={0.1} />
                  )}
                </LineChart>
              ) : (
                <BarChart data={sessions.slice(0, 10).reverse().map((s) => ({ name: `#${s.id}`, energy: s.totalEnergyKwh }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                  <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 13 }} />
                  <YAxis tick={{ fill: '#888', fontSize: 13 }} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8 }} />
                  <Bar dataKey="energy" fill="#e31937" name="Energy (kWh)" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
