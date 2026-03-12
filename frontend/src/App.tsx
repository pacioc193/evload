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
import Layout from './components/Layout'

function AppContent() {
  useWebSocket()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      {isAuthenticated() ? (
        <>
          <Route path="/dashboard" element={<Layout><DashboardPage /></Layout>} />
          <Route path="/climate" element={<Layout><ClimatePage /></Layout>} />
          <Route path="/statistics" element={<Layout><StatisticsPage /></Layout>} />
          <Route path="/schedule" element={<Layout><SchedulePage /></Layout>} />
          <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
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
