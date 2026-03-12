const BASE = '/api'

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`)
  return res.json()
}

export const api = {
  getConfig: () => request('GET', '/config'),
  updateConfig: (updates) => request('PUT', '/config', updates),
  getYaml: () => fetch('/api/config/yaml').then(r => r.text()),
  setYaml: (yaml) => fetch('/api/config/yaml', {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: yaml,
  }).then(r => { if (!r.ok) throw new Error('YAML save failed'); return r.json(); }),
  getVehicleState: () => request('GET', '/vehicle/state'),
  startCharging: () => request('POST', '/vehicle/charging/start'),
  stopCharging: () => request('POST', '/vehicle/charging/stop'),
  startClimate: () => request('POST', '/vehicle/climate/start'),
  stopClimate: () => request('POST', '/vehicle/climate/stop'),
}
