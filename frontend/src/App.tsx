import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { getAuthStatus } from './api/auth'
import SetupPage from './pages/SetupPage'
import LoginPage from './pages/LoginPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated()) return <Navigate to="/login" replace />
  return <>{children}</>
}

function DashboardPlaceholder() {
  return (
    <div className="min-h-screen bg-evload-bg text-evload-text flex items-center justify-center">
      <h1 className="text-2xl font-bold">Dashboard (coming soon)</h1>
    </div>
  )
}

export default function App() {
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

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

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            firstLaunch ? (
              <Navigate to="/setup" replace />
            ) : isAuthenticated() ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPlaceholder />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
