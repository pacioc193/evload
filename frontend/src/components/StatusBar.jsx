export function StatusBar({ connected, vehicleState, config }) {
  const batteryLevel = vehicleState?.charge_state?.battery_level ?? '--'
  const isCharging = vehicleState?.charge_state?.charging_state === 'Charging'
  const vehicleName = config?.vehicle?.name ?? 'Tesla'

  return (
    <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-xl font-bold text-green-400">⚡ EVLoad</span>
        <span className="text-gray-400 text-sm">{vehicleName}</span>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Battery</span>
          <span className={`font-mono font-bold text-lg ${batteryLevel >= 80 ? 'text-green-400' : batteryLevel >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
            {batteryLevel}%
          </span>
        </div>
        <div className={`text-sm font-medium ${isCharging ? 'text-green-400' : 'text-gray-500'}`}>
          {isCharging ? '⚡ Charging' : '○ Idle'}
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">{connected ? 'Live' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  )
}
