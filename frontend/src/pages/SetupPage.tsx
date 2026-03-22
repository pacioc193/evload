import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { setupPassword } from '../api/auth'
import { useAuthStore } from '../store/authStore'

interface SetupPageProps {
  onSetupComplete?: () => void
}

export default function SetupPage({ onSetupComplete }: SetupPageProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const { token } = await setupPassword(password)
      setToken(token)
      onSetupComplete?.()
      navigate('/dashboard')
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error)
      } else {
        setError('Setup failed. Please check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-evload-bg text-evload-text flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-evload-surface border border-evload-border rounded-xl p-8">
        <h1 className="text-3xl font-bold mb-2">evload</h1>
        <p className="text-evload-muted mb-8">Set up your UI password to get started</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-evload-bg border border-evload-border rounded-lg px-4 py-2 text-evload-text focus:outline-none focus:border-evload-accent"
              placeholder="Minimum 8 characters"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-evload-bg border border-evload-border rounded-lg px-4 py-2 text-evload-text focus:outline-none focus:border-evload-accent"
              placeholder="Repeat password"
              required
            />
          </div>
          {error && <p className="text-evload-error text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-evload-accent hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Setting up...' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
