import { useEffect, useState } from 'react'
import { Calendar, Zap, Thermometer, Trash2, Plus } from 'lucide-react'
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

type SettingsMode = 'charger' | 'climate'
type ChargeType = 'start_at' | 'finish_by' | 'start_end' | 'weekly'
type ClimateType = 'start_at' | 'start_end' | 'weekly'

function toLocalDatetimeInputValue(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function weekdayNameFromDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString([], { weekday: 'short' })
}

function timeFromDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function nextWeeklyOccurrenceIso(weekday: number, timeHHmm: string): string {
  const now = new Date()
  const [h, m] = timeHHmm.split(':').map(Number)
  const target = new Date(now)
  target.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)

  const deltaDays = (weekday - target.getDay() + 7) % 7
  if (deltaDays > 0) target.setDate(target.getDate() + deltaDays)
  if (deltaDays === 0 && target <= now) target.setDate(target.getDate() + 7)

  return target.toISOString()
}

export default function SchedulePage() {
  const [charges, setCharges] = useState<ScheduledCharge[]>([])
  const [climates, setClimates] = useState<ScheduledClimate[]>([])
  const [loadingCharges, setLoadingCharges] = useState(true)
  const [loadingClimates, setLoadingClimates] = useState(true)

  const [mode, setMode] = useState<SettingsMode>('charger')
  const [formMsg, setFormMsg] = useState('')
  const [showForm, setShowForm] = useState(false)

  const [chargeType, setChargeType] = useState<ChargeType>('start_at')
  const [chargeAt, setChargeAt] = useState(toLocalDatetimeInputValue())
  const [chargeFinishBy, setChargeFinishBy] = useState(toLocalDatetimeInputValue())
  const [chargeWeekdays, setChargeWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [chargeWeeklyTime, setChargeWeeklyTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [chargeSoc, setChargeSoc] = useState(80)
  const [chargeAmps, setChargeAmps] = useState(16)
  const [chargeName, setChargeName] = useState('')

  const [climateType, setClimateType] = useState<ClimateType>('start_at')
  const [climateAt, setClimateAt] = useState(toLocalDatetimeInputValue())
  const [climateFinishBy, setClimateFinishBy] = useState(toLocalDatetimeInputValue())
  const [climateWeekdays, setClimateWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [climateWeeklyTime, setClimateWeeklyTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [climateTemp, setClimateTemp] = useState(21)
  const [climateName, setClimateName] = useState('')

  const [saving, setSaving] = useState(false)

  const loadCharges = () =>
    getScheduledCharges()
      .then(setCharges)
      .catch(() => setFormMsg('Failed to load charge schedules'))
      .finally(() => setLoadingCharges(false))

  const loadClimates = () =>
    getScheduledClimates()
      .then(setClimates)
      .catch(() => setFormMsg('Failed to load climate schedules'))
      .finally(() => setLoadingClimates(false))

  useEffect(() => {
    loadCharges()
    loadClimates()
  }, [])

  const toggleWeekday = (days: number[], day: number, setter: (next: number[]) => void) => {
    setter(days.includes(day) ? days.filter((d) => d !== day) : [...days, day])
  }

  const handleSave = async () => {
    setSaving(true)
    setFormMsg('')
    try {
      if (mode === 'charger') {
        const nameVal = chargeName.trim() || undefined
        if (nameVal && nameVal.length > 50) {
          setFormMsg('Name must be at most 50 characters')
          return
        }
        if (chargeType === 'weekly') {
          if (chargeWeekdays.length === 0) {
            setFormMsg('Select at least one weekday')
            return
          }
          const uniqueDays = [...new Set(chargeWeekdays)].sort((a, b) => a - b)
          await Promise.all(
            uniqueDays.map((day) =>
              createScheduledCharge({
                scheduleType: 'weekly',
                scheduledAt: nextWeeklyOccurrenceIso(day, chargeWeeklyTime),
                targetSoc: chargeSoc,
                targetAmps: chargeAmps,
                name: nameVal,
              })
            )
          )
        } else if (chargeType === 'start_end') {
          const start = new Date(chargeAt)
          const end = new Date(chargeFinishBy)
          if (end <= start) {
            setFormMsg('End time must be after start time')
            return
          }
          await createScheduledCharge({
            scheduleType: 'start_end',
            scheduledAt: start.toISOString(),
            finishBy: end.toISOString(),
            targetSoc: chargeSoc,
            targetAmps: chargeAmps,
            name: nameVal,
          })
        } else if (chargeType === 'finish_by') {
          await createScheduledCharge({
            scheduleType: 'finish_by',
            finishBy: new Date(chargeFinishBy).toISOString(),
            targetSoc: chargeSoc,
            targetAmps: chargeAmps,
            name: nameVal,
          })
        } else {
          await createScheduledCharge({
            scheduleType: 'start_at',
            scheduledAt: new Date(chargeAt).toISOString(),
            targetSoc: chargeSoc,
            targetAmps: chargeAmps,
            name: nameVal,
          })
        }
        await loadCharges()
      } else {
        const nameVal = climateName.trim() || undefined
        if (nameVal && nameVal.length > 50) {
          setFormMsg('Name must be at most 50 characters')
          return
        }
        if (climateType === 'weekly') {
          if (climateWeekdays.length === 0) {
            setFormMsg('Select at least one weekday')
            return
          }
          const uniqueDays = [...new Set(climateWeekdays)].sort((a, b) => a - b)
          await Promise.all(
            uniqueDays.map((day) =>
              createScheduledClimate({
                scheduleType: 'weekly',
                scheduledAt: nextWeeklyOccurrenceIso(day, climateWeeklyTime),
                targetTempC: climateTemp,
                name: nameVal,
              })
            )
          )
        } else if (climateType === 'start_end') {
          const start = new Date(climateAt)
          const end = new Date(climateFinishBy)
          if (end <= start) {
            setFormMsg('End time must be after start time')
            return
          }
          await createScheduledClimate({
            scheduleType: 'start_end',
            scheduledAt: start.toISOString(),
            finishBy: end.toISOString(),
            targetTempC: climateTemp,
            name: nameVal,
          })
        } else {
          await createScheduledClimate({
            scheduleType: 'start_at',
            scheduledAt: new Date(climateAt).toISOString(),
            targetTempC: climateTemp,
            name: nameVal,
          })
        }
        await loadClimates()
      }

      setFormMsg('Scheduled successfully')
      setShowForm(false)
      setChargeName('')
      setClimateName('')
    } catch {
      setFormMsg('Failed to save schedule')
    } finally {
      setSaving(false)
      setTimeout(() => setFormMsg(''), 4000)
    }
  }

  const handleDeleteCharge = async (id: number) => {
    try {
      await deleteScheduledCharge(id)
      setCharges((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setFormMsg('Failed to delete charge schedule')
    }
  }

  const handleDeleteClimate = async (id: number) => {
    try {
      await deleteScheduledClimate(id)
      setClimates((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setFormMsg('Failed to delete climate schedule')
    }
  }

  const renderScheduleItem = (sc: ScheduledCharge | ScheduledClimate, type: 'charge' | 'climate') => {
    const isClimate = type === 'climate'
    const target = isClimate ? `${(sc as ScheduledClimate).targetTempC}°C` : `${(sc as ScheduledCharge).targetSoc}%`
    const details = isClimate 
      ? undefined
      : `${(sc as ScheduledCharge).targetAmps}A`
    
    return (
      <div key={sc.id} className="group bg-evload-bg hover:bg-evload-border/50 border border-evload-border rounded-xl p-4 transition-all duration-200 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${sc.enabled ? 'bg-gradient-to-br from-green-400 to-green-600' : 'bg-evload-muted'}`} />
            <h3 className="font-semibold text-sm text-evload-text truncate">
              {sc.name || (isClimate ? 'Climate' : 'Charge')}
            </h3>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-evload-accent/20 text-evload-accent flex-shrink-0">
              {sc.scheduleType === 'weekly' ? '🔄' : sc.scheduleType === 'start_end' ? '⏱️' : '⏰'}
            </span>
          </div>
          <p className="text-xs text-evload-muted/80 line-clamp-2">
            {sc.scheduleType === 'weekly'
              ? `Every ${weekdayNameFromDate(sc.scheduledAt)} at ${timeFromDate(sc.scheduledAt)}`
              : sc.scheduleType === 'finish_by'
                ? `Finish by ${formatDateTime(sc.finishBy)}`
                : sc.scheduleType === 'start_end'
                  ? `${formatDateTime(sc.scheduledAt)} → ${formatDateTime(sc.finishBy)}`
                  : formatDateTime(sc.scheduledAt)}
          </p>
          <p className="text-xs text-evload-accent font-medium mt-1">
            {target} {details ? `• ${details}` : ''}
          </p>
          {!sc.enabled && <p className="text-xs text-evload-muted italic mt-1">✓ Executed</p>}
        </div>
        <button
          onClick={() => isClimate ? handleDeleteClimate(sc.id) : handleDeleteCharge(sc.id)}
          className="p-1.5 flex-shrink-0 text-evload-muted hover:text-evload-error hover:bg-evload-error/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-20" style={{ background: 'linear-gradient(135deg, transparent 0%, rgba(220,38,38,0.03) 100%)' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-evload-bg/95 backdrop-blur border-b border-evload-border/50 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Calendar size={24} className="text-evload-accent" />
            <div>
              <h1 className="text-2xl font-bold">Schedule</h1>
              <p className="text-xs text-evload-muted">Manage charging & climate</p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-evload-accent to-red-700 text-white rounded-lg font-medium hover:shadow-lg transition-all duration-200 hover:scale-105"
          >
            <Plus size={18} /> New
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-6">
        {/* Form Section */}
        {showForm && (
          <div className="bg-gradient-to-br from-evload-surface to-evload-bg border border-evload-border rounded-2xl p-5 sm:p-6 space-y-5">
            {/* Mode Tabs */}
            <div className="flex gap-2 bg-evload-bg rounded-lg p-1">
              {['charger', 'climate'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m as SettingsMode)}
                  className={`flex-1 py-2 px-3 rounded-md font-medium text-sm transition-all ${
                    mode === m
                      ? 'bg-evload-accent text-white shadow-md'
                      : 'text-evload-muted hover:text-evload-text'
                  }`}
                >
                  {m === 'charger' ? '⚡ Charger' : '🌡️ Climate'}
                </button>
              ))}
            </div>

            {/* Type Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted">Schedule Type</label>
              <div className="flex gap-2 flex-wrap">
                {mode === 'charger'
                  ? (['start_at', 'finish_by', 'start_end', 'weekly'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setChargeType(t)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${chargeType === t ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
                      >
                        {t === 'start_at' ? '🕐 Start' : t === 'finish_by' ? '🏁 Finish' : t === 'start_end' ? '⏱️ Range' : '🔄 Weekly'}
                      </button>
                    ))
                  : (['start_at', 'start_end', 'weekly'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setClimateType(t)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${climateType === t ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
                      >
                        {t === 'start_at' ? '🕐 Start' : t === 'start_end' ? '⏱️ Range' : '🔄 Weekly'}
                      </button>
                    ))}
              </div>
            </div>

            {/* Dynamic Fields */}
            <div className="space-y-4">
              {mode === 'charger' ? (
                <>
                  {chargeType === 'weekly' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-2">Days</label>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            { d: 1, label: 'M' },
                            { d: 2, label: 'T' },
                            { d: 3, label: 'W' },
                            { d: 4, label: 'T' },
                            { d: 5, label: 'F' },
                            { d: 6, label: 'S' },
                            { d: 0, label: 'S' },
                          ].map((item) => (
                            <button
                              key={item.d}
                              onClick={() => toggleWeekday(chargeWeekdays, item.d, setChargeWeekdays)}
                              className={`py-2 rounded-lg font-bold text-sm transition-all ${chargeWeekdays.includes(item.d) ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted'}`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-2">Time</label>
                        <input
                          type="time"
                          value={chargeWeeklyTime}
                          onChange={(e) => setChargeWeeklyTime(e.target.value)}
                          className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {chargeType !== 'finish_by' && (
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-1">Start</label>
                          <input
                            type="datetime-local"
                            value={chargeAt}
                            onChange={(e) => setChargeAt(e.target.value)}
                            className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      )}
                      {(chargeType === 'finish_by' || chargeType === 'start_end') && (
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-1">End</label>
                          <input
                            type="datetime-local"
                            value={chargeFinishBy}
                            onChange={(e) => setChargeFinishBy(e.target.value)}
                            className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-evload-muted block mb-2">SoC: {chargeSoc}%</label>
                      <input type="range" min={1} max={100} value={chargeSoc} onChange={(e) => setChargeSoc(Number(e.target.value))} className="w-full accent-evload-accent" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-evload-muted block mb-2">Amps: {chargeAmps}A</label>
                      <input type="range" min={5} max={32} value={chargeAmps} onChange={(e) => setChargeAmps(Number(e.target.value))} className="w-full accent-evload-accent" />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="text-xs font-semibold text-evload-muted block mb-1">Name (opt)</label>
                      <input
                        type="text"
                        maxLength={50}
                        placeholder="e.g. Late shift"
                        value={chargeName}
                        onChange={(e) => setChargeName(e.target.value)}
                        className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-xs"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {climateType === 'weekly' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-2">Days</label>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            { d: 1, label: 'M' },
                            { d: 2, label: 'T' },
                            { d: 3, label: 'W' },
                            { d: 4, label: 'T' },
                            { d: 5, label: 'F' },
                            { d: 6, label: 'S' },
                            { d: 0, label: 'S' },
                          ].map((item) => (
                            <button
                              key={item.d}
                              onClick={() => toggleWeekday(climateWeekdays, item.d, setClimateWeekdays)}
                              className={`py-2 rounded-lg font-bold text-sm transition-all ${climateWeekdays.includes(item.d) ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted'}`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-2">Time</label>
                        <input
                          type="time"
                          value={climateWeeklyTime}
                          onChange={(e) => setClimateWeeklyTime(e.target.value)}
                          className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-1">Start</label>
                        <input
                          type="datetime-local"
                          value={climateAt}
                          onChange={(e) => setClimateAt(e.target.value)}
                          className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      {climateType === 'start_end' && (
                        <div>
                          <label className="text-xs font-semibold uppercase tracking-wider text-evload-muted block mb-1">End</label>
                          <input
                            type="datetime-local"
                            value={climateFinishBy}
                            onChange={(e) => setClimateFinishBy(e.target.value)}
                            className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-evload-muted block mb-2">Temp: {climateTemp}°C</label>
                      <input type="range" min={15} max={30} value={climateTemp} onChange={(e) => setClimateTemp(Number(e.target.value))} className="w-full accent-evload-accent" />
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <label className="text-xs font-semibold text-evload-muted block mb-1">Name (opt)</label>
                      <input
                        type="text"
                        maxLength={50}
                        placeholder="e.g. Morning warmup"
                        value={climateName}
                        onChange={(e) => setClimateName(e.target.value)}
                        className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-xs"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 px-4 bg-gradient-to-r from-evload-accent to-red-700 text-white rounded-lg font-medium hover:shadow-lg transition-all disabled:opacity-50"
              >
                {saving ? 'Saving…' : '✓ Save'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 px-4 bg-evload-border text-evload-text rounded-lg font-medium hover:bg-evload-surface transition-colors"
              >
                Cancel
              </button>
            </div>

            {formMsg && (
              <p className={`text-sm text-center ${formMsg.includes('Failed') ? 'text-evload-error' : 'text-evload-success'}`}>
                {formMsg}
              </p>
            )}
          </div>
        )}

        {/* Schedules Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Charger Schedules */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Zap size={20} className="text-evload-accent" />
              <h2 className="font-bold text-lg">Charger Schedules</h2>
              <span className="text-xs bg-evload-accent/20 text-evload-accent px-2 py-1 rounded-full font-semibold">
                {loadingCharges ? '...' : charges.length}
              </span>
            </div>
            <div className="space-y-3">
              {loadingCharges ? (
                <div className="flex items-center justify-center p-6 text-evload-muted">Loading…</div>
              ) : charges.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-evload-muted/60 bg-evload-bg/50 rounded-lg border border-dashed border-evload-border">
                  <Zap size={24} className="opacity-50 mb-2" />
                  <p className="text-xs">No schedules yet</p>
                </div>
              ) : (
                charges.map((sc) => renderScheduleItem(sc, 'charge'))
              )}
            </div>
          </div>

          {/* Climate Schedules */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Thermometer size={20} className="text-evload-accent" />
              <h2 className="font-bold text-lg">Climate Schedules</h2>
              <span className="text-xs bg-evload-accent/20 text-evload-accent px-2 py-1 rounded-full font-semibold">
                {loadingClimates ? '...' : climates.length}
              </span>
            </div>
            <div className="space-y-3">
              {loadingClimates ? (
                <div className="flex items-center justify-center p-6 text-evload-muted">Loading…</div>
              ) : climates.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-evload-muted/60 bg-evload-bg/50 rounded-lg border border-dashed border-evload-border">
                  <Thermometer size={24} className="opacity-50 mb-2" />
                  <p className="text-xs">No schedules yet</p>
                </div>
              ) : (
                climates.map((sc) => renderScheduleItem(sc, 'climate'))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
