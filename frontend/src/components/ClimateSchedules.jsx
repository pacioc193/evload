import { Toggle } from './Toggle.jsx'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function ClimateSchedules({ climate, onUpdate }) {
  const enabled = climate?.enabled ?? false
  const schedules = climate?.schedules ?? []

  function updateSchedule(idx, patch) {
    const updated = schedules.map((s, i) => i === idx ? { ...s, ...patch } : s)
    onUpdate({ ...climate, schedules: updated })
  }

  function toggleDay(idx, day) {
    const s = schedules[idx]
    const days = s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day]
    updateSchedule(idx, { days })
  }

  function addSchedule() {
    const newSched = {
      id: `climate-${Date.now()}`,
      enabled: false,
      name: 'New Climate Schedule',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      startTime: '07:00',
      durationMinutes: 20,
      targetTempC: 21,
    }
    onUpdate({ ...climate, schedules: [...schedules, newSched] })
  }

  function removeSchedule(idx) {
    onUpdate({ ...climate, schedules: schedules.filter((_, i) => i !== idx) })
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-100">Climate Schedules</h2>
        <Toggle label="Enable Climate" checked={enabled} onChange={v => onUpdate({ ...climate, enabled: v })} />
      </div>
      <div className="space-y-4">
        {schedules.map((schedule, idx) => (
          <div key={schedule.id} className={`bg-gray-800 rounded-lg p-4 border ${schedule.enabled ? 'border-blue-700' : 'border-gray-700'}`}>
            <div className="flex items-center justify-between mb-3">
              <input
                className="bg-transparent text-gray-100 font-medium border-b border-gray-600 focus:border-blue-400 outline-none w-44"
                value={schedule.name}
                onChange={e => updateSchedule(idx, { name: e.target.value })}
              />
              <div className="flex items-center gap-3">
                <Toggle checked={schedule.enabled} onChange={v => updateSchedule(idx, { enabled: v })} />
                <button onClick={() => removeSchedule(idx)} className="text-gray-500 hover:text-red-400 text-lg leading-none">×</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {DAYS.map(day => (
                <button key={day} onClick={() => toggleDay(idx, day)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${schedule.days.includes(day) ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
                  {day}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400">Start Time</label>
                <input type="time" value={schedule.startTime} onChange={e => updateSchedule(idx, { startTime: e.target.value })}
                  className="w-full bg-gray-700 rounded px-2 py-1 text-sm text-gray-100 mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Duration (min)</label>
                <input type="number" min={1} max={120} value={schedule.durationMinutes}
                  onChange={e => updateSchedule(idx, { durationMinutes: parseInt(e.target.value) })}
                  className="w-full bg-gray-700 rounded px-2 py-1 text-sm text-gray-100 mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Temp: {schedule.targetTempC}°C</label>
                <input type="range" min={15} max={30} step={0.5} value={schedule.targetTempC}
                  onChange={e => updateSchedule(idx, { targetTempC: parseFloat(e.target.value) })}
                  className="w-full mt-2" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addSchedule} className="mt-4 w-full bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-2 text-sm border border-dashed border-gray-600 transition-colors">
        + Add Climate Schedule
      </button>
    </div>
  )
}
