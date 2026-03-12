import { useEffect, useRef, useState } from 'react'

export function useWebSocket() {
  const [vehicleState, setVehicleState] = useState(null)
  const [chargingStatus, setChargingStatus] = useState(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)

  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'vehicleState') setVehicleState(msg.data)
          if (msg.type === 'chargingStatus') setChargingStatus(msg.data)
        } catch {}
      }
    }
    connect()
    return () => wsRef.current?.close()
  }, [])

  return { vehicleState, chargingStatus, connected }
}
