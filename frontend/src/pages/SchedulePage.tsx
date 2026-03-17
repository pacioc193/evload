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

function setDateToTodayOrTomorrow(value: string, offsetDays: number): string {
  const source = new Date(value)
  const now = new Date()
  const out = new Date(now)
  out.setHours(source.getHours(), source.getMinutes(), 0, 0)
  out.setDate(out.getDate() + offsetDays)
  return toLocalDatetimeInputValue(out.toISOString())
}

export default function SchedulePage() {
  const [charges, setCharges] = useState<ScheduledCharge[]>([])
  const [climates, setClimates] = useState<ScheduledClimate[]>([])
  const [loadingCharges, setLoadingCharges] = useState(true)
  const [loadingClimates, setLoadingClimates] = useState(true)

  const [settingsMode, setSettingsMode] = useState<SettingsMode>('charger')
  const [formMsg, setFormMsg] = useState('')

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

  const applyTodayTomorrowQuick = (kind: 'today' | 'tomorrow') => {
    const offset = kind === 'today' ? 0 : 1
    const weekday = (new Date().getDay() + offset) % 7

    if (settingsMode === 'charger') {
      if (chargeType === 'weekly') {
        setChargeWeekdays([weekday])
      } else {
        setChargeAt((prev) => setDateToTodayOrTomorrow(prev, offset))
        setChargeFinishBy((prev) => setDateToTodayOrTomorrow(prev, offset))
      }
      return
    }

    if (climateType === 'weekly') {
      setClimateWeekdays([weekday])
    } else {
      setClimateAt((prev) => setDateToTodayOrTomorrow(prev, offset))
      setClimateFinishBy((prev) => setDateToTodayOrTomorrow(prev, offset))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setFormMsg('')
    try {
      if (settingsMode === 'charger') {
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
          })
        } else if (chargeType === 'finish_by') {
          await createScheduledCharge({
            scheduleType: 'finish_by',
            finishBy: new Date(chargeFinishBy).toISOString(),
            targetSoc: chargeSoc,
            targetAmps: chargeAmps,
          })
        } else {
          await createScheduledCharge({
            scheduleType: 'start_at',
            scheduledAt: new Date(chargeAt).toISOString(),
            targetSoc: chargeSoc,
            targetAmps: chargeAmps,
          })
        }
        await loadCharges()
      } else {
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
          })
        } else {
          await createScheduledClimate({
            scheduleType: 'start_at',
            scheduledAt: new Date(climateAt).toISOString(),
            targetTempC: climateTemp,
          })
        }
        await loadClimates()
      }

      setFormMsg('Scheduled successfully')
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Calendar size={24} className="text-evload-accent" />
        <h1 className="text-2xl font-bold">Schedule</h1>
      </div>

      <div className="bg-evload-surface border border-evload-border rounded-3xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-lg">Schedule Settings</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setSettingsMode('charger')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${settingsMode === 'charger' ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
            >
              Charger
            </button>
            <button
              onClick={() => setSettingsMode('climate')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${settingsMode === 'climate' ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
            >
              Climate
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => applyTodayTomorrowQuick('today')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-evload-border text-evload-muted hover:text-evload-text"
          >
            Oggi
          </button>
          <button
            onClick={() => applyTodayTomorrowQuick('tomorrow')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-evload-border text-evload-muted hover:text-evload-text"
          >
            Domani
          </button>
        </div>

        {settingsMode === 'charger' ? (
          <>
            <div className="flex gap-2 flex-wrap">
              {(['start_at', 'finish_by', 'start_end', 'weekly'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setChargeType(t)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${chargeType === t ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
                >
                  {t === 'start_at' ? <><Clock size={13} />Start at</> : t === 'finish_by' ? <><FlagTriangleRight size={13} />Finish by</> : t === 'start_end' ? <><Calendar size={13} />Start + End</> : <><Calendar size={13} />Weekly</>}
                </button>
              ))}
            </div>

            {chargeType === 'weekly' ? (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {[
                    { d: 1, label: 'Mon' },
                    { d: 2, label: 'Tue' },
                    { d: 3, label: 'Wed' },
                    { d: 4, label: 'Thu' },
                    { d: 5, label: 'Fri' },
                    { d: 6, label: 'Sat' },
                    { d: 0, label: 'Sun' },
                  ].map((item) => {
                    const active = chargeWeekdays.includes(item.d)
                    return (
                      <button
                        key={item.d}
                        onClick={() => toggleWeekday(chargeWeekdays, item.d, setChargeWeekdays)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
                <div>
                  <label className="block text-sm text-evload-muted mb-1">Time</label>
                  <input
                    type="time"
                    value={chargeWeeklyTime}
                    onChange={(e) => setChargeWeeklyTime(e.target.value)}
                    className="w-full sm:w-56 bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {chargeType !== 'finish_by' && (
                  <div>
                    <label className="block text-sm text-evload-muted mb-1">Start Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      value={chargeAt}
                      onChange={(e) => setChargeAt(e.target.value)}
                      className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
                    />
                  </div>
                )}
                {(chargeType === 'finish_by' || chargeType === 'start_end') && (
                  <div>
                    <label className="block text-sm text-evload-muted mb-1">Finish by</label>
                    <input
                      type="datetime-local"
                      value={chargeFinishBy}
                      onChange={(e) => setChargeFinishBy(e.target.value)}
                      className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-sm text-evload-muted mb-1">Target SoC: {chargeSoc}%</label>
                <input type="range" min={1} max={100} value={chargeSoc} onChange={(e) => setChargeSoc(Number(e.target.value))} className="w-full accent-evload-accent" />
              </div>
              <div>
                <label className="block text-sm text-evload-muted mb-1">Target Amps: {chargeAmps}A</label>
                <input type="range" min={5} max={32} value={chargeAmps} onChange={(e) => setChargeAmps(Number(e.target.value))} className="w-full accent-evload-accent" />
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Plus size={16} />{saving ? 'Saving…' : 'Save Charger Schedule'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {(['start_at', 'start_end', 'weekly'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setClimateType(t)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${climateType === t ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
                >
                  {t === 'start_at' ? <><Clock size={13} />Start at</> : t === 'start_end' ? <><Calendar size={13} />Start + End</> : <><Calendar size={13} />Weekly</>}
                </button>
              ))}
            </div>

            {climateType === 'weekly' ? (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {[
                    { d: 1, label: 'Mon' },
                    { d: 2, label: 'Tue' },
                    { d: 3, label: 'Wed' },
                    { d: 4, label: 'Thu' },
                    { d: 5, label: 'Fri' },
                    { d: 6, label: 'Sat' },
                    { d: 0, label: 'Sun' },
                  ].map((item) => {
                    const active = climateWeekdays.includes(item.d)
                    return (
                      <button
                        key={item.d}
                        onClick={() => toggleWeekday(climateWeekdays, item.d, setClimateWeekdays)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-evload-accent text-white' : 'bg-evload-border text-evload-muted hover:text-evload-text'}`}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
                <div>
                  <label className="block text-sm text-evload-muted mb-1">Time</label>
                  <input
                    type="time"
                    value={climateWeeklyTime}
                    onChange={(e) => setClimateWeeklyTime(e.target.value)}
                    className="w-full sm:w-56 bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-evload-muted mb-1">Start Date &amp; Time</label>
                  <input
                    type="datetime-local"
                    value={climateAt}
                    onChange={(e) => setClimateAt(e.target.value)}
                    className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
                  />
                </div>
                {climateType === 'start_end' && (
                  <div>
                    <label className="block text-sm text-evload-muted mb-1">End Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      value={climateFinishBy}
                      onChange={(e) => setClimateFinishBy(e.target.value)}
                      className="w-full bg-evload-bg border border-evload-border rounded-lg px-3 py-2 text-sm text-evload-text focus:outline-none focus:border-evload-accent"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-sm text-evload-muted mb-1">Target Temperature: {climateTemp}°C</label>
                <input type="range" min={15} max={30} value={climateTemp} onChange={(e) => setClimateTemp(Number(e.target.value))} className="w-full accent-evload-accent" />
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-evload-accent hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Plus size={16} />{saving ? 'Saving…' : 'Save Climate Schedule'}
              </button>
            </div>
          </>
        )}

        {formMsg && (
          <p className={`text-sm ${formMsg.includes('Failed') ? 'text-evload-error' : 'text-evload-success'}`}>{formMsg}</p>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-evload-surface border border-evload-border rounded-3xl p-6 space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Zap size={18} className="text-evload-accent" />
            Charger Recap
          </h2>
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
                      {sc.scheduleType === 'weekly' ? 'Weekly' : sc.scheduleType === 'finish_by' ? 'Finish by' : sc.scheduleType === 'start_end' ? 'Start + End' : 'Start at'}
                    </span>
                    <span className="font-medium">
                      {sc.scheduleType === 'weekly'
                        ? `Every ${weekdayNameFromDate(sc.scheduledAt)} at ${timeFromDate(sc.scheduledAt)}`
                        : sc.scheduleType === 'finish_by'
                          ? `Finish ${formatDateTime(sc.finishBy)}`
                          : sc.scheduleType === 'start_end'
                            ? `Start ${formatDateTime(sc.scheduledAt)} · End ${formatDateTime(sc.finishBy)}`
                            : formatDateTime(sc.scheduledAt)}
                    </span>
                    <span className="text-evload-muted">→ {sc.targetSoc}%</span>
                    {sc.targetAmps && <span className="text-evload-muted">{sc.targetAmps}A</span>}
                    {!sc.enabled && <span className="text-xs text-evload-muted italic">executed</span>}
                  </div>
                  <button onClick={() => handleDeleteCharge(sc.id)} className="p-1 text-evload-muted hover:text-evload-error transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-evload-surface border border-evload-border rounded-3xl p-6 space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Thermometer size={18} className="text-evload-accent" />
            Climate Recap
          </h2>
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
                    <span className="text-xs px-2 py-0.5 rounded bg-evload-border text-evload-muted">
                      {sc.scheduleType === 'weekly' ? 'Weekly' : sc.scheduleType === 'start_end' ? 'Start + End' : 'Start at'}
                    </span>
                    <span className="font-medium">
                      {sc.scheduleType === 'weekly'
                        ? `Every ${weekdayNameFromDate(sc.scheduledAt)} at ${timeFromDate(sc.scheduledAt)}`
                        : sc.scheduleType === 'start_end'
                          ? `Start ${formatDateTime(sc.scheduledAt)} · End ${formatDateTime(sc.finishBy)}`
                          : formatDateTime(sc.scheduledAt)}
                    </span>
                    <span className="text-evload-muted">→ {sc.targetTempC}°C</span>
                    {!sc.enabled && <span className="text-xs text-evload-muted italic">executed</span>}
                  </div>
                  <button onClick={() => handleDeleteClimate(sc.id)} className="p-1 text-evload-muted hover:text-evload-error transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
