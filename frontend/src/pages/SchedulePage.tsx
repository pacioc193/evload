import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Zap, Thermometer, Trash2, Plus } from 'lucide-react'
import {
  getSettings,
  getScheduledCharges,
  createScheduledCharge,
  deleteScheduledCharge,
  getScheduledClimates,
  createScheduledClimate,
  deleteScheduledClimate,
  type AppSettings,
  type ScheduledCharge,
  type ScheduledClimate,
} from '../api/index'
import { useWsStore } from '../store/wsStore'

type BuilderMode = 'charger' | 'climate'
type ChargePlanType = 'start' | 'end' | 'range' | 'finish'
type ClimatePlanType = 'start' | 'range'

const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
]

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-evload-muted/50 text-evload-muted text-[9px] font-bold leading-none hover:border-evload-accent hover:text-evload-accent transition-colors flex-shrink-0"
      >?</button>
      {open && (
        <div className="absolute z-50 left-0 bottom-full mb-2 w-72 max-w-[90vw] rounded-lg border border-evload-border bg-evload-surface shadow-xl px-3 py-2.5 text-xs text-evload-text leading-relaxed">
          {text}
        </div>
      )}
    </div>
  )
}

function toLocalDatetimeInputValue(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB')
}

function nextOccurrenceFromWeekday(sourceLocalDateTime: string, weekday: number): string {
  const source = new Date(sourceLocalDateTime)
  const now = new Date()
  const target = new Date(now)
  target.setHours(source.getHours(), source.getMinutes(), 0, 0)
  const deltaDays = (weekday - target.getDay() + 7) % 7
  if (deltaDays > 0) target.setDate(target.getDate() + deltaDays)
  if (deltaDays === 0 && target <= now) target.setDate(target.getDate() + 7)
  return target.toISOString()
}

function moveDateToOffset(localDateTime: string, dayOffset: number): string {
  const source = new Date(localDateTime)
  const now = new Date()
  const out = new Date(now)
  out.setHours(source.getHours(), source.getMinutes(), 0, 0)
  out.setDate(out.getDate() + dayOffset)
  return toLocalDatetimeInputValue(out.toISOString())
}

function sliderClassName(kind: 'soc' | 'amps' | 'temp'): string {
  const base = [
    'w-full appearance-none h-2 rounded-full cursor-pointer',
    '[&::-webkit-slider-thumb]:appearance-none',
    '[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5',
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
    '[&::-webkit-slider-thumb]:border-2',
    '[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150',
    'hover:[&::-webkit-slider-thumb]:scale-110',
  ]

  if (kind === 'soc') {
    return [
      ...base,
      'bg-gradient-to-r from-green-500/40 to-emerald-600/70',
      '[&::-webkit-slider-thumb]:border-emerald-500',
      '[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(16,185,129,0.20)]',
    ].join(' ')
  }

  if (kind === 'amps') {
    return [
      ...base,
      'bg-gradient-to-r from-rose-500/40 to-red-600/70',
      '[&::-webkit-slider-thumb]:border-red-500',
      '[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(239,68,68,0.20)]',
    ].join(' ')
  }

  return [
    ...base,
    'bg-gradient-to-r from-amber-500/40 to-orange-600/70',
    '[&::-webkit-slider-thumb]:border-orange-500',
    '[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(249,115,22,0.20)]',
  ].join(' ')
}

export default function SchedulePage() {
  const vehicle = useWsStore((s) => s.vehicle)

  const [charges, setCharges] = useState<ScheduledCharge[]>([])
  const [climates, setClimates] = useState<ScheduledClimate[]>([])
  const [loadingCharges, setLoadingCharges] = useState(true)
  const [loadingClimates, setLoadingClimates] = useState(true)

  const [mode, setMode] = useState<BuilderMode>('charger')
  const [planName, setPlanName] = useState('')
  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatDays, setRepeatDays] = useState<number[]>([1, 2, 3, 4, 5])

  const [chargeType, setChargeType] = useState<ChargePlanType>('start')
  const [chargeStartAt, setChargeStartAt] = useState(toLocalDatetimeInputValue())
  const [chargeFinishAt, setChargeFinishAt] = useState(toLocalDatetimeInputValue())
  const [chargeSoc, setChargeSoc] = useState(80)
  const [chargeAmps, setChargeAmps] = useState(16)

  const [climateType, setClimateType] = useState<ClimatePlanType>('start')
  const [climateStartAt, setClimateStartAt] = useState(toLocalDatetimeInputValue())
  const [climateFinishAt, setClimateFinishAt] = useState(toLocalDatetimeInputValue())
  const [climateTemp, setClimateTemp] = useState(21)

  const [showBuilder, setShowBuilder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const [engineSettings, setEngineSettings] = useState<Pick<AppSettings, 'minAmps' | 'maxAmps'> | null>(null)

  const ampsMin = engineSettings?.minAmps ?? 5
  const ampsMax = engineSettings?.maxAmps ?? 32

  const targetSocKm = useMemo(() => {
    const socNow = vehicle?.stateOfCharge
    const rangeNow = vehicle?.batteryRange
    if (socNow == null || rangeNow == null || socNow <= 0 || rangeNow <= 0) return null
    return Math.round((rangeNow / socNow) * chargeSoc)
  }, [vehicle?.stateOfCharge, vehicle?.batteryRange, chargeSoc])

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

    getSettings()
      .then((s) => setEngineSettings({ minAmps: s.minAmps, maxAmps: s.maxAmps }))
      .catch(() => {
        // Keep default range if settings endpoint is temporarily unavailable.
        setEngineSettings(null)
      })
  }, [])

  useEffect(() => {
    setChargeAmps((prev) => Math.min(Math.max(prev, ampsMin), ampsMax))
  }, [ampsMin, ampsMax])

  const toggleDay = (day: number) => {
    setRepeatDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  const applyTodayTomorrow = (offset: 0 | 1) => {
    if (mode === 'charger') {
      setChargeStartAt((prev) => moveDateToOffset(prev, offset))
      setChargeFinishAt((prev) => moveDateToOffset(prev, offset))
      return
    }
    setClimateStartAt((prev) => moveDateToOffset(prev, offset))
    setClimateFinishAt((prev) => moveDateToOffset(prev, offset))
  }

  const normalizeRange = (startIso: string, finishIso: string): { start: string; finish: string } => {
    const start = new Date(startIso)
    const finish = new Date(finishIso)
    if (finish <= start) {
      finish.setDate(finish.getDate() + 1)
    }
    return { start: start.toISOString(), finish: finish.toISOString() }
  }

  const handleSave = async () => {
    setSaving(true)
    setFormMsg('')
    try {
      const cleanName = planName.trim()
      if (cleanName.length > 50) {
        setFormMsg('Name must be at most 50 characters')
        return
      }
      const name = cleanName || undefined

      if (repeatEnabled && repeatDays.length === 0) {
        setFormMsg('Select at least one repetition day')
        return
      }

      if (mode === 'charger') {
        if (!repeatEnabled) {
          if (chargeType === 'start') {
            await createScheduledCharge({
              scheduleType: 'start_at',
              scheduledAt: new Date(chargeStartAt).toISOString(),
              targetSoc: chargeSoc,
              targetAmps: chargeAmps,
              name,
            })
          } else if (chargeType === 'end') {
            await createScheduledCharge({
              scheduleType: 'end_at',
              finishBy: new Date(chargeFinishAt).toISOString(),
              targetSoc: chargeSoc,
              targetAmps: chargeAmps,
              name,
            })
          } else if (chargeType === 'finish') {
            await createScheduledCharge({
              scheduleType: 'finish_by',
              finishBy: new Date(chargeFinishAt).toISOString(),
              targetSoc: chargeSoc,
              targetAmps: chargeAmps,
              name,
            })
          } else {
            const normalized = normalizeRange(chargeStartAt, chargeFinishAt)
            await createScheduledCharge({
              scheduleType: 'start_end',
              scheduledAt: normalized.start,
              finishBy: normalized.finish,
              targetSoc: chargeSoc,
              targetAmps: chargeAmps,
              name,
            })
          }
        } else {
          const uniqueDays = [...new Set(repeatDays)].sort((a, b) => a - b)
          if (chargeType === 'start') {
            await Promise.all(
              uniqueDays.map((day) =>
                createScheduledCharge({
                  scheduleType: 'weekly',
                  scheduledAt: nextOccurrenceFromWeekday(chargeStartAt, day),
                  targetSoc: chargeSoc,
                  targetAmps: chargeAmps,
                  name,
                })
              )
            )
          } else if (chargeType === 'end') {
            await Promise.all(
              uniqueDays.map((day) =>
                createScheduledCharge({
                  scheduleType: 'end_at_weekly',
                  finishBy: nextOccurrenceFromWeekday(chargeFinishAt, day),
                  targetSoc: chargeSoc,
                  targetAmps: chargeAmps,
                  name,
                })
              )
            )
          } else if (chargeType === 'finish') {
            await Promise.all(
              uniqueDays.map((day) =>
                createScheduledCharge({
                  scheduleType: 'finish_by_weekly',
                  finishBy: nextOccurrenceFromWeekday(chargeFinishAt, day),
                  targetSoc: chargeSoc,
                  targetAmps: chargeAmps,
                  name,
                })
              )
            )
          } else {
            await Promise.all(
              uniqueDays.map((day) => {
                const startIso = nextOccurrenceFromWeekday(chargeStartAt, day)
                const finishIso = nextOccurrenceFromWeekday(chargeFinishAt, day)
                const normalized = normalizeRange(startIso, finishIso)
                return createScheduledCharge({
                  scheduleType: 'start_end_weekly',
                  scheduledAt: normalized.start,
                  finishBy: normalized.finish,
                  targetSoc: chargeSoc,
                  targetAmps: chargeAmps,
                  name,
                })
              })
            )
          }
        }
        await loadCharges()
      } else {
        if (!repeatEnabled) {
          if (climateType === 'start') {
            await createScheduledClimate({
              scheduleType: 'start_at',
              scheduledAt: new Date(climateStartAt).toISOString(),
              targetTempC: climateTemp,
              name,
            })
          } else {
            const normalized = normalizeRange(climateStartAt, climateFinishAt)
            await createScheduledClimate({
              scheduleType: 'start_end',
              scheduledAt: normalized.start,
              finishBy: normalized.finish,
              targetTempC: climateTemp,
              name,
            })
          }
        } else {
          const uniqueDays = [...new Set(repeatDays)].sort((a, b) => a - b)
          if (climateType === 'start') {
            await Promise.all(
              uniqueDays.map((day) =>
                createScheduledClimate({
                  scheduleType: 'weekly',
                  scheduledAt: nextOccurrenceFromWeekday(climateStartAt, day),
                  targetTempC: climateTemp,
                  name,
                })
              )
            )
          } else {
            await Promise.all(
              uniqueDays.map((day) => {
                const startIso = nextOccurrenceFromWeekday(climateStartAt, day)
                const finishIso = nextOccurrenceFromWeekday(climateFinishAt, day)
                const normalized = normalizeRange(startIso, finishIso)
                return createScheduledClimate({
                  scheduleType: 'start_end',
                  scheduledAt: normalized.start,
                  finishBy: normalized.finish,
                  targetTempC: climateTemp,
                  name,
                })
              })
            )
          }
        }
        await loadClimates()
      }

      setFormMsg('Plan saved')
      setPlanName('')
      setShowBuilder(false)
    } catch {
      setFormMsg('Failed to save schedule')
    } finally {
      setSaving(false)
      setTimeout(() => setFormMsg(''), 3500)
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

  const renderScheduleCard = (item: ScheduledCharge | ScheduledClimate, kind: 'charge' | 'climate') => {
    const isClimate = kind === 'climate'
    const meta = isClimate
      ? `${(item as ScheduledClimate).targetTempC}°C`
      : `${(item as ScheduledCharge).targetSoc}% • ${(item as ScheduledCharge).targetAmps ?? '—'}A`

    return (
      <div key={item.id} className="group rounded-2xl border border-evload-border bg-evload-bg/80 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-evload-accent/50">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-evload-text">{item.name || 'Unnamed plan'}</p>
            <p className="text-xs text-evload-muted">{item.scheduleType}</p>
          </div>
          <button
            onClick={() => (isClimate ? handleDeleteClimate(item.id) : handleDeleteCharge(item.id))}
            className="rounded-lg p-1.5 text-evload-muted transition-colors hover:bg-evload-error/10 hover:text-evload-error"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <p className="text-xs text-evload-muted">
          {item.scheduleType === 'end_at' || item.scheduleType === 'end_at_weekly'
            ? `End at: ${formatDateTime(item.finishBy)}`
            : item.scheduleType === 'finish_by' || item.scheduleType === 'finish_by_weekly'
            ? `Finish by: ${formatDateTime(item.finishBy)}`
            : item.scheduleType === 'start_end' || item.scheduleType === 'start_end_weekly'
              ? `Start: ${formatDateTime(item.scheduledAt)} • End: ${formatDateTime(item.finishBy)}`
              : `Start: ${formatDateTime(item.scheduledAt)}`}
        </p>

        <p className="mt-2 text-xs font-semibold text-evload-accent">{meta}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-20" style={{ background: 'radial-gradient(1200px circle at 20% -20%, rgba(239,68,68,0.16), transparent 40%), radial-gradient(900px circle at 100% 0%, rgba(14,165,233,0.12), transparent 35%)' }}>
      <div className="sticky top-0 z-30 border-b border-evload-border/60 bg-evload-bg/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Calendar size={22} className="text-evload-accent" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Planner</h1>
              <p className="text-xs text-evload-muted">New flow: name, today/tomorrow, start at, end at, time range, finish by, recurrence, target</p>
            </div>
          </div>
          <button
            onClick={() => setShowBuilder((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-evload-accent to-red-700 px-4 py-2 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
          >
            <Plus size={16} />
            New plan
          </button>
        </div>
      </div>

      <div className="space-y-6 p-4 sm:p-6">
        {showBuilder && (
          <div className="rounded-3xl border border-evload-border bg-gradient-to-br from-evload-surface to-evload-bg p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-evload-bg p-1">
              <button
                onClick={() => setMode('charger')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === 'charger' ? 'bg-evload-accent text-white' : 'text-evload-muted hover:text-evload-text'}`}
              >
                <span className="inline-flex items-center gap-1.5"><Zap size={14} /> Charger</span>
              </button>
              <button
                onClick={() => setMode('climate')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === 'climate' ? 'bg-evload-accent text-white' : 'text-evload-muted hover:text-evload-text'}`}
              >
                <span className="inline-flex items-center gap-1.5"><Thermometer size={14} /> Climate</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="space-y-4 rounded-2xl border border-evload-border bg-evload-bg/60 p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-evload-muted">1. Plan name</h2>
                <input
                  type="text"
                  maxLength={50}
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder={mode === 'charger' ? 'e.g. Overnight Home' : 'e.g. Morning Preheat'}
                  className="w-full rounded-xl border border-evload-border bg-evload-bg px-3 py-2 text-sm text-evload-text focus:border-evload-accent focus:outline-none"
                />

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-evload-muted">2. Today / Tomorrow</h3>
                  <div className="flex gap-2">
                    <button onClick={() => applyTodayTomorrow(0)} className="rounded-lg border border-evload-border px-3 py-2 text-sm font-medium text-evload-text hover:border-evload-accent/60">Today</button>
                    <button onClick={() => applyTodayTomorrow(1)} className="rounded-lg border border-evload-border px-3 py-2 text-sm font-medium text-evload-text hover:border-evload-accent/60">Tomorrow</button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-evload-muted">3. Start at / End at / Time range / Finish by</h3>
                  {mode === 'charger' ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {([
                          { key: 'start', label: 'Start at' },
                          { key: 'end', label: 'End at' },
                          { key: 'range', label: 'Time range' },
                          { key: 'finish', label: 'Finish by' },
                        ] as const).map((option) => (
                          <button
                            key={option.key}
                            onClick={() => setChargeType(option.key)}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold ${chargeType === option.key ? 'bg-evload-accent text-white' : 'bg-evload-bg text-evload-muted hover:text-evload-text'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-2 text-xs text-evload-muted sm:grid-cols-2">
                        <div className="flex items-center gap-1.5">
                          <span>Start at</span>
                          <Tooltip text="Starts charging at the selected time." />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>End at</span>
                          <Tooltip text="Stops charging at the selected end time." />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>Time range</span>
                          <Tooltip text="Starts at the first time and stops at the second time." />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span>Finish by</span>
                          <Tooltip text="Calculates when charging must start to reach the target SoC by the selected time." />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: 'start', label: 'Start' },
                        { key: 'range', label: 'Range' },
                      ] as const).map((option) => (
                        <button
                          key={option.key}
                          onClick={() => setClimateType(option.key)}
                          className={`rounded-lg px-3 py-2 text-sm font-semibold ${climateType === option.key ? 'bg-evload-accent text-white' : 'bg-evload-bg text-evload-muted hover:text-evload-text'}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {mode === 'charger' ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {(chargeType === 'start' || chargeType === 'range') && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-evload-muted">Start</label>
                          <input type="datetime-local" value={chargeStartAt} onChange={(e) => setChargeStartAt(e.target.value)} className="w-full rounded-xl border border-evload-border bg-evload-bg px-3 py-2 text-sm focus:border-evload-accent focus:outline-none" />
                        </div>
                      )}
                      {(chargeType === 'end' || chargeType === 'range' || chargeType === 'finish') && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-evload-muted">{chargeType === 'finish' ? 'Finish by' : 'End at'}</label>
                          <input type="datetime-local" value={chargeFinishAt} onChange={(e) => setChargeFinishAt(e.target.value)} className="w-full rounded-xl border border-evload-border bg-evload-bg px-3 py-2 text-sm focus:border-evload-accent focus:outline-none" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-evload-muted">Start</label>
                        <input type="datetime-local" value={climateStartAt} onChange={(e) => setClimateStartAt(e.target.value)} className="w-full rounded-xl border border-evload-border bg-evload-bg px-3 py-2 text-sm focus:border-evload-accent focus:outline-none" />
                      </div>
                      {climateType === 'range' && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-evload-muted">Finish</label>
                          <input type="datetime-local" value={climateFinishAt} onChange={(e) => setClimateFinishAt(e.target.value)} className="w-full rounded-xl border border-evload-border bg-evload-bg px-3 py-2 text-sm focus:border-evload-accent focus:outline-none" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-evload-border bg-evload-bg/60 p-4">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-evload-muted">4. Recurrence</h3>
                  <label className="flex items-center justify-between rounded-lg border border-evload-border px-3 py-2">
                    <span className="text-sm text-evload-text">Enable recurrence</span>
                    <input type="checkbox" checked={repeatEnabled} onChange={(e) => setRepeatEnabled(e.target.checked)} className="h-4 w-4 accent-evload-accent" />
                  </label>
                  {repeatEnabled && (
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                      {WEEKDAYS.map((w) => (
                        <button
                          key={w.day}
                          onClick={() => toggleDay(w.day)}
                          className={`rounded-lg px-2 py-2 text-xs font-semibold ${repeatDays.includes(w.day) ? 'bg-evload-accent text-white' : 'bg-evload-bg text-evload-muted hover:text-evload-text'}`}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-evload-muted">5. Target</h3>
                  {mode === 'charger' ? (
                    <>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-evload-muted">
                          <span>SOC</span>
                          <span className="text-evload-text">{chargeSoc}% • {targetSocKm != null ? `${targetSocKm} km` : '— km'}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={100}
                          value={chargeSoc}
                          onChange={(e) => setChargeSoc(Number(e.target.value))}
                          className={sliderClassName('soc')}
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-evload-muted">
                          <span>Amps</span>
                          <span className="text-evload-text">{chargeAmps}A ({ampsMin}-{ampsMax})</span>
                        </div>
                        <input
                          type="range"
                          min={ampsMin}
                          max={ampsMax}
                          value={chargeAmps}
                          onChange={(e) => setChargeAmps(Number(e.target.value))}
                          className={sliderClassName('amps')}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-evload-muted">
                        <span>Temperature</span>
                        <span className="text-evload-text">{climateTemp}°C</span>
                      </div>
                      <input
                        type="range"
                        min={15}
                        max={30}
                        value={climateTemp}
                        onChange={(e) => setClimateTemp(Number(e.target.value))}
                        className={sliderClassName('temp')}
                      />
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full rounded-xl bg-gradient-to-r from-evload-accent to-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save plan'}
                  </button>
                </div>

                {formMsg && (
                  <p className={`text-xs font-medium ${formMsg.toLowerCase().includes('failed') ? 'text-evload-error' : 'text-evload-success'}`}>
                    {formMsg}
                  </p>
                )}
              </section>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Zap size={18} className="text-evload-accent" />
              <h2 className="text-lg font-bold">Charger Plans</h2>
              <span className="rounded-full bg-evload-accent/20 px-2 py-0.5 text-xs font-semibold text-evload-accent">{loadingCharges ? '...' : charges.length}</span>
            </div>
            <div className="space-y-3">
              {loadingCharges
                ? <div className="rounded-xl border border-evload-border p-4 text-sm text-evload-muted">Loading...</div>
                : charges.length === 0
                  ? <div className="rounded-xl border border-dashed border-evload-border p-4 text-sm text-evload-muted">No plans yet</div>
                  : charges.map((item) => renderScheduleCard(item, 'charge'))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Thermometer size={18} className="text-evload-accent" />
              <h2 className="text-lg font-bold">Climate Plans</h2>
              <span className="rounded-full bg-evload-accent/20 px-2 py-0.5 text-xs font-semibold text-evload-accent">{loadingClimates ? '...' : climates.length}</span>
            </div>
            <div className="space-y-3">
              {loadingClimates
                ? <div className="rounded-xl border border-evload-border p-4 text-sm text-evload-muted">Loading...</div>
                : climates.length === 0
                  ? <div className="rounded-xl border border-dashed border-evload-border p-4 text-sm text-evload-muted">No plans yet</div>
                  : climates.map((item) => renderScheduleCard(item, 'climate'))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
