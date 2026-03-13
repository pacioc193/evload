import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { getAuthStatus } from './api/auth'
import { useWebSocket } from './hooks/useWebSocket'
import SetupPage from './pages/SetupPage'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ClimatePage from './pages/ClimatePage'
import StatisticsPage from './pages/StatisticsPage'
import SettingsPage from './pages/SettingsPage'
import SchedulePage from './pages/SchedulePage'
import NotificationsPage from './pages/NotificationsPage'
import Layout from './components/Layout'

const THEME_STORAGE_KEY = 'evload.theme'

function AppContent() {
  useWebSocket()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return (saved as 'light' | 'dark') || 'dark'
  })

  useEffect(() => {
    const root = window.document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      {isAuthenticated() ? (
        <>
          <Route path="/dashboard" element={<Layout theme={theme} onToggleTheme={toggleTheme}><DashboardPage /></Layout>} />
          <Route path="/climate" element={<Layout theme={theme} onToggleTheme={toggleTheme}><ClimatePage /></Layout>} />
          <Route path="/statistics" element={<Layout theme={theme} onToggleTheme={toggleTheme}><StatisticsPage /></Layout>} />
          <Route path="/schedule" element={<Layout theme={theme} onToggleTheme={toggleTheme}><SchedulePage /></Layout>} />
          <Route path="/notifications" element={<Layout theme={theme} onToggleTheme={toggleTheme}><NotificationsPage /></Layout>} />
          <Route path="/settings" element={<Layout theme={theme} onToggleTheme={toggleTheme}><SettingsPage /></Layout>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  )
}

export default function App() {
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null)

  useEffect(() => {
    getAuthStatus()
      .then((s) => setFirstLaunch(s.firstLaunch))
      .catch(() => setFirstLaunch(false))
  }, [])

  if (firstLaunch === null) {
    return (
      <div className="min-h-screen bg-evload-bg flex items-center justify-center">
        <div className="text-evload-muted">Loading...</div>
      </div>
    )
  }

  if (firstLaunch) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<SetupPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}
