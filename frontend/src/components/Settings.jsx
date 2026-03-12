export function Settings({ config, onUpdate }) {
  const vehicle = config?.vehicle ?? {}
  const proxy = vehicle.proxy ?? {}
  const polling = config?.polling ?? {}
  const balancing = config?.charging?.balancing ?? {}

  function updateVehicle(patch) {
    onUpdate({ vehicle: { ...vehicle, ...patch } })
  }
  function updateProxy(patch) {
    onUpdate({ vehicle: { ...vehicle, proxy: { ...proxy, ...patch } } })
  }
  function updatePolling(patch) {
    onUpdate({ polling: { ...polling, ...patch } })
  }
  function updateBalancing(patch) {
    onUpdate({ charging: { ...config?.charging, balancing: { ...balancing, ...patch } } })
  }

  const inputClass = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-green-400"
  const labelClass = "block text-xs text-gray-400 mb-1"

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h2 className="text-lg font-semibold mb-4 text-gray-100">Settings</h2>
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Vehicle</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>VIN</label>
              <input className={inputClass} value={vehicle.vin ?? ''} onChange={e => updateVehicle({ vin: e.target.value })} placeholder="5YJ3E1EA..." />
            </div>
            <div>
              <label className={labelClass}>Name</label>
              <input className={inputClass} value={vehicle.name ?? ''} onChange={e => updateVehicle({ name: e.target.value })} placeholder="My Tesla" />
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">TeslaBLE Proxy</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Host</label>
              <input className={inputClass} value={proxy.host ?? ''} onChange={e => updateProxy({ host: e.target.value })} placeholder="192.168.1.100" />
            </div>
            <div>
              <label className={labelClass}>Port</label>
              <input className={inputClass} type="number" value={proxy.port ?? ''} onChange={e => updateProxy({ port: parseInt(e.target.value) })} placeholder="8080" />
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Polling</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Interval (s)</label>
              <input className={inputClass} type="number" value={polling.intervalSeconds ?? ''} onChange={e => updatePolling({ intervalSeconds: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className={labelClass}>Sleep Check (s)</label>
              <input className={inputClass} type="number" value={polling.sleepCheckIntervalSeconds ?? ''} onChange={e => updatePolling({ sleepCheckIntervalSeconds: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className={labelClass}>Timeout (s)</label>
              <input className={inputClass} type="number" value={polling.timeoutSeconds ?? ''} onChange={e => updatePolling({ timeoutSeconds: parseInt(e.target.value) })} />
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Balancing</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Hold Duration (min)</label>
              <input className={inputClass} type="number" value={balancing.holdDurationMinutes ?? ''} onChange={e => updateBalancing({ holdDurationMinutes: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className={labelClass}>Min Current (A)</label>
              <input className={inputClass} type="number" value={balancing.minCurrentAmps ?? ''} onChange={e => updateBalancing({ minCurrentAmps: parseFloat(e.target.value) })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
