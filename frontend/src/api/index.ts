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
