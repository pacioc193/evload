export function VehicleCard({ vehicleState, onStartCharging, onStopCharging, onStartClimate, onStopClimate }) {
  const cs = vehicleState?.charge_state ?? {}
  const cls = vehicleState?.climate_state ?? {}
  const isCharging = cs.charging_state === 'Charging'
  const isClimateOn = cls.is_auto_conditioning_on ?? false
  const chargeLimit = cs.charge_limit_soc ?? '--'
  const batteryLevel = cs.battery_level ?? '--'
  const chargeCurrent = cs.charge_current_request ?? '--'
  const insideTemp = cls.inside_temp != null ? `${cls.inside_temp.toFixed(1)}°C` : '--'
  const outsideTemp = cls.outside_temp != null ? `${cls.outside_temp.toFixed(1)}°C` : '--'

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h2 className="text-lg font-semibold mb-4 text-gray-100">Vehicle Status</h2>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400">Battery Level</p>
          <p className="text-2xl font-bold text-green-400">{batteryLevel}%</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400">Charge Limit</p>
          <p className="text-2xl font-bold text-blue-400">{chargeLimit}%</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400">Charge Current</p>
          <p className="text-2xl font-bold text-yellow-400">{chargeCurrent}A</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400">Inside Temp</p>
          <p className="text-2xl font-bold text-purple-400">{insideTemp}</p>
        </div>
      </div>
      <div className="text-xs text-gray-500 mb-4">Outside: {outsideTemp}</div>
      <div className="flex gap-3 flex-wrap">
        {isCharging ? (
          <button onClick={onStopCharging} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Stop Charging
          </button>
        ) : (
          <button onClick={onStartCharging} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Start Charging
          </button>
        )}
        {isClimateOn ? (
          <button onClick={onStopClimate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Stop Climate
          </button>
        ) : (
          <button onClick={onStartClimate} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Start Climate
          </button>
        )}
      </div>
    </div>
  )
}
