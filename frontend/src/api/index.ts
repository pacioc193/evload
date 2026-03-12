import axios from 'axios'
import { useAuthStore } from '../store/authStore'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      useAuthStore.getState().clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export async function startCharging(targetSoc: number, targetAmps?: number) {
  const res = await api.post('/engine/start', { targetSoc, targetAmps })
  return res.data as { success: boolean }
}

export async function stopCharging() {
  const res = await api.post('/engine/stop')
  return res.data as { success: boolean }
}

export async function getSessions(page = 1, limit = 20) {
  const res = await api.get(`/sessions?page=${page}&limit=${limit}`)
  return res.data as { sessions: unknown[]; total: number; page: number; limit: number }
}

export async function getSession(id: number) {
  const res = await api.get(`/sessions/${id}`)
  return res.data
}

export async function getHaAuthorizeUrl() {
  const res = await api.get('/ha/authorize')
  return res.data as { url: string }
}

export async function getConfig() {
  const res = await api.get('/config')
  return res.data as { content: string }
}

export async function saveConfig(content: string) {
  const res = await api.post('/config', { content })
  return res.data as { success: boolean }
}

// ─── Structured Settings ─────────────────────────────────────────────────────

export interface AppSettings {
  demo: boolean
  haUrl: string
  haPowerEntityId: string
  haGridEntityId: string
  haMaxHomePowerW: number
  proxyUrl: string
  vehicleId: string
  batteryCapacityKwh: number
  defaultAmps: number
  maxAmps: number
  minAmps: number
}

export async function getSettings() {
  const res = await api.get('/settings')
  return res.data as AppSettings
}

export async function patchSettings(partial: Partial<AppSettings>) {
  const res = await api.patch('/settings', partial)
  return res.data as { success: boolean }
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export interface ScheduledCharge {
  id: number
  vehicleId: string
  scheduleType: string
  scheduledAt: string | null
  finishBy: string | null
  targetSoc: number
  targetAmps: number | null
  enabled: boolean
  createdAt: string
}

export interface ScheduledClimate {
  id: number
  vehicleId: string
  scheduledAt: string
  targetTempC: number
  enabled: boolean
  createdAt: string
}

export async function getScheduledCharges() {
  const res = await api.get('/schedule/charges')
  return res.data as ScheduledCharge[]
}

export async function createScheduledCharge(
  options:
    | { scheduleType: 'start_at'; scheduledAt: string; targetSoc: number; targetAmps?: number }
    | { scheduleType: 'finish_by'; finishBy: string; targetSoc: number; targetAmps?: number }
) {
  const res = await api.post('/schedule/charges', options)
  return res.data as ScheduledCharge
}

export async function deleteScheduledCharge(id: number) {
  const res = await api.delete(`/schedule/charges/${id}`)
  return res.data as { success: boolean }
}

export async function getScheduledClimates() {
  const res = await api.get('/schedule/climate')
  return res.data as ScheduledClimate[]
}

export async function createScheduledClimate(scheduledAt: string, targetTempC: number) {
  const res = await api.post('/schedule/climate', { scheduledAt, targetTempC })
  return res.data as ScheduledClimate
}

export async function deleteScheduledClimate(id: number) {
  const res = await api.delete(`/schedule/climate/${id}`)
  return res.data as { success: boolean }
}
