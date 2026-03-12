import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export async function getAuthStatus(): Promise<{ firstLaunch: boolean }> {
  const res = await api.get<{ firstLaunch: boolean }>('/auth/status')
  return res.data
}

export async function setupPassword(password: string): Promise<{ token: string }> {
  const res = await api.post<{ token: string }>('/auth/setup', { password })
  return res.data
}

export async function login(password: string): Promise<{ token: string }> {
  const res = await api.post<{ token: string }>('/auth/login', { password })
  return res.data
}
