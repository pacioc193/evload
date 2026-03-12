import React from 'react'
import { NavLink } from 'react-router-dom'
import { Zap, Car, Thermometer, BarChart2, Settings, Wifi, WifiOff } from 'lucide-react'
import { useWsStore } from '../store/wsStore'
import { clsx } from 'clsx'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const wsConnected = useWsStore((s) => s.connected)
  const failsafe = useWsStore((s) => s.failsafe)

  return (
    <div className="min-h-screen bg-evload-bg text-evload-text flex flex-col">
      {failsafe?.active && (
        <div className="bg-evload-error text-white px-4 py-2 text-sm text-center font-medium">
          ⚠️ FAILSAFE ACTIVE: {failsafe.reason} — Use Tesla app manually
        </div>
      )}
      <header className="border-b border-evload-border bg-evload-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="text-evload-accent" size={24} />
          <span className="text-xl font-bold">evload</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {wsConnected ? (
            <><Wifi size={16} className="text-evload-success" /><span className="text-evload-success">Live</span></>
          ) : (
            <><WifiOff size={16} className="text-evload-error" /><span className="text-evload-error">Offline</span></>
          )}
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="w-16 lg:w-56 border-r border-evload-border bg-evload-surface flex flex-col py-4 gap-1">
          {[
            { to: '/dashboard', icon: Car, label: 'Dashboard' },
            { to: '/climate', icon: Thermometer, label: 'Climate' },
            { to: '/statistics', icon: BarChart2, label: 'Statistics' },
            { to: '/settings', icon: Settings, label: 'Settings' },
          ].map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors',
                  isActive
                    ? 'bg-evload-accent text-white'
                    : 'text-evload-muted hover:text-evload-text hover:bg-evload-border'
                )
              }
            >
              <Icon size={20} />
              <span className="hidden lg:block text-sm font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
