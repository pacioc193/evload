import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  setToken: (token: string) => void
  clearToken: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      setToken: (token) => set({ token }),
      clearToken: () => set({ token: null }),
      isAuthenticated: () => {
        const token = get().token
        if (!token) return false
        const exp = getTokenExpiry(token)
        if (exp !== null && Date.now() / 1000 >= exp) {
          set({ token: null })
          return false
        }
        return true
      },
    }),
    { name: 'evload-auth' }
  )
)
