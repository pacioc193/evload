import { useEffect, useState } from 'react'
import { Calendar, Clock, Zap, Thermometer, Trash2, Plus, FlagTriangleRight } from 'lucide-react'
import {
  getScheduledCharges,
  createScheduledCharge,
  deleteScheduledCharge,
  getScheduledClimates,
  createScheduledClimate,
  deleteScheduledClimate,
  type ScheduledCharge,
  type ScheduledClimate,
} from '../api/index'

function toLocalDatetimeInputValue(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function SchedulePage() {
  const [charges, setCharges] = useState<ScheduledCharge[]>([])
  const [climates, setClimates] = useState<ScheduledClimate[]>([])
  const [loadingCharges, setLoadingCharges] = useState(true)
  const [loadingClimates, setLoadingClimates] = useState(true)

  const [chargeType, setChargeType] = useState<'start_at' | 'finish_by'>('start_at')
  const [chargeAt, setChargeAt] = useState(toLocalDatetimeInputValue())
  const [finishBy, setFinishBy] = useState(toLocalDatetimeInputValue())
  const [chargeSoc, setChargeSoc] = useState(80)
  const [chargeAmps, setChargeAmps] = useState(16)
  const [addingCharge, setAddingCharge] = useState(false)
  const [chargeMsg, setChargeMsg] = useState('')

  const [climateAt, setClimateAt] = useState(toLocalDatetimeInputValue())
  const [climateTemp, setClimateTemp] = useState(21)
  const [addingClimate, setAddingClimate] = useState(false)
  const [climateMsg, setClimateMsg] = useState('')

  const loadCharges = () =>
    getScheduledCharges()
      .then(setCharges)
      .catch(() => setChargeMsg('Failed to load'))
      .finally(() => setLoadingCharges(false))

  const loadClimates = () =>
    getScheduledClimates()
      .then(setClimates)
      .catch(() => setClimateMsg('Failed to load'))
      .finally(() => setLoadingClimates(false))

  useEffect(() => {
    loadCharges()
    loadClimates()
  }, [])

  const handleAddCharge = async () => {
    setAddingCharge(true)
    setChargeMsg('')
    try {
      if (chargeType === 'start_at') {
        await createScheduledCharge({ scheduleType: 'start_at', scheduledAt: new Date(chargeAt).toISOString(), targetSoc: chargeSoc, targetAmps: chargeAmps })
      } else {
        await createScheduledCharge({ scheduleType: 'finish_by', finishBy: new Date(finishBy).toISOString(), targetSoc: chargeSoc, targetAmps: chargeAmps })
      }
      setChargeMsg('Scheduled successfully')
      setChargeAt(toLocalDatetimeInputValue())
      setFinishBy(toLocalDatetimeInputValue())
      await loadCharges()
    } catch {
      setChargeMsg('Failed to schedule charge')
    } finally {
      setAddingCharge(false)
      setTimeout(() => setChargeMsg(''), 4000)
    }
  }

  const handleDeleteCharge = async (id: number) => {
    try {
      await deleteScheduledCharge(id)
      setCharges((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setChargeMsg('Failed to delete')
    }
  }

  const handleAddClimate = async () => {
    setAddingClimate(true)
    setClimateMsg('')
    try {
      await createScheduledClimate(new Date(climateAt).toISOString(), climateTemp)
      setClimateMsg('Scheduled successfully')
      setClimateAt(toLocalDatetimeInputValue())
      await loadClimates()
    } catch {
      setClimateMsg('Failed to schedule climate')
    } finally {
      setAddingClimate(false)
      setTimeout(() => setClimateMsg(''), 4000)
    }
  }

  const handleDeleteClimate = async (id: number) => {
    try {
      await deleteScheduledClimate(id)
      setClimates((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setClimateMsg('Failed to delete')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Calendar size={24} className="text-evload-accent" />
        <h1 className="text-2xl font-bold">Schedule</h1>
      </div>

      {/* ── Scheduled Charges ─────────────────────────────── */}
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Zap size={18} className="text-evload-accent" />
          Scheduled Charging
        </h2>

        {/* Schedule type toggle */}
        <div className="flex gap-2">
          {(['start_at', 'finish_by'] as const).map((t) => (
            <button key={t} onClick={() => setChargeType(t)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${chargeType === t ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}>
              {t === 'start_at' ? <><Clock size={13} />Start at</> : <><FlagTriangleRight size={13} />Finish by</>}
            </button>
          ))}
        </div>

        {/* Add form */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-1">
            {chargeType === 'start_at' ? (
              <>
                <label className="block text-sm text-evload-muted mb-1 flex items-center gap-1"><Clock size={13} />Start Date &amp; Time</label>
                <input type="datetime-local" value={chargeAt} onChange={(e) => setChargeAt(e.target.value)}
                  className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent" />
              </>
            ) : (
              <>
                <label className="block text-sm text-evload-muted mb-1 flex items-center gap-1"><FlagTriangleRight size={13} />Finish by</label>
                <input type="datetime-local" value={finishBy} onChange={(e) => setFinishBy(e.target.value)}
                  className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent" />
              </>
            )}
          </div>
          <div>
            <label className="block text-sm text-evload-muted mb-1">Target SoC: {chargeSoc}%</label>
            <input type="range" min={1} max={100} value={chargeSoc}
              onChange={(e) => setChargeSoc(Number(e.target.value))}
              className="w-full accent-evload-accent" />
          </div>
          <div>
            <label className="block text-sm text-evload-muted mb-1">Target Amps: {chargeAmps}A</label>
            <input type="range" min={5} max={32} value={chargeAmps}
              onChange={(e) => setChargeAmps(Number(e.target.value))}
              className="w-full accent-evload-accent" />
          </div>
          <button onClick={handleAddCharge} disabled={addingCharge}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            <Plus size={16} />{addingCharge ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
        {chargeMsg && (
          <p className={`text-sm ${chargeMsg.includes('Failed') ? 'text-evload-error' : 'text-evload-success'}`}>{chargeMsg}</p>
        )}

        {/* List */}
        {loadingCharges ? (
          <p className="text-evload-muted text-sm">Loading…</p>
        ) : charges.length === 0 ? (
          <p className="text-evload-muted text-sm">No scheduled charges</p>
        ) : (
          <div className="space-y-2">
            {charges.map((sc) => (
              <div key={sc.id} className="flex items-center justify-between p-3 rounded-lg border border-evload-border bg-evload-bg">
                <div className="flex items-center gap-4 text-sm">
                  <span className={`w-2 h-2 rounded-full ${sc.enabled ? 'bg-evload-success' : 'bg-evload-muted'}`} />
                  <span className="text-xs px-2 py-0.5 rounded bg-evload-border text-evload-muted">
                    {sc.scheduleType === 'finish_by' ? 'Finish by' : 'Start at'}
                  </span>
                  <span className="font-medium">
                    {sc.scheduleType === 'finish_by' ? formatDateTime(sc.finishBy) : formatDateTime(sc.scheduledAt)}
                  </span>
                  <span className="text-evload-muted">→ {sc.targetSoc}%</span>
                  {sc.targetAmps && <span className="text-evload-muted">{sc.targetAmps}A</span>}
                  {!sc.enabled && <span className="text-xs text-evload-muted italic">executed</span>}
                </div>
                <button onClick={() => handleDeleteCharge(sc.id)}
                  className="p-1 text-evload-muted hover:text-evload-error transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Scheduled Climate ─────────────────────────────── */}
      <div className="bg-evload-surface border border-evload-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Thermometer size={18} className="text-evload-accent" />
          Scheduled Climate
          <span className="text-xs text-evload-muted font-normal">(only fires when plugged in)</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-sm text-evload-muted mb-1 flex items-center gap-1"><Clock size={13} />Date &amp; Time</label>
            <input type="datetime-local" value={climateAt} onChange={(e) => setClimateAt(e.target.value)}
              className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent" />
          </div>
          <div>
            <label className="block text-sm text-evload-muted mb-1">Target Temperature: {climateTemp}°C</label>
            <input type="range" min={15} max={30} value={climateTemp}
              onChange={(e) => setClimateTemp(Number(e.target.value))}
              className="w-full accent-evload-accent" />
          </div>
          <button onClick={handleAddClimate} disabled={addingClimate}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            <Plus size={16} />{addingClimate ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
        {climateMsg && (
          <p className={`text-sm ${climateMsg.includes('Failed') ? 'text-evload-error' : 'text-evload-success'}`}>{climateMsg}</p>
        )}

        {loadingClimates ? (
          <p className="text-evload-muted text-sm">Loading…</p>
        ) : climates.length === 0 ? (
          <p className="text-evload-muted text-sm">No scheduled climate sessions</p>
        ) : (
          <div className="space-y-2">
            {climates.map((sc) => (
              <div key={sc.id} className="flex items-center justify-between p-3 rounded-lg border border-evload-border bg-evload-bg">
                <div className="flex items-center gap-4 text-sm">
                  <span className={`w-2 h-2 rounded-full ${sc.enabled ? 'bg-evload-success' : 'bg-evload-muted'}`} />
                  <span className="font-medium">{formatDateTime(sc.scheduledAt)}</span>
                  <span className="text-evload-muted">→ {sc.targetTempC}°C</span>
                  {!sc.enabled && <span className="text-xs text-evload-muted italic">executed</span>}
                </div>
                <button onClick={() => handleDeleteClimate(sc.id)}
                  className="p-1 text-evload-muted hover:text-evload-error transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
