/**
 * Frontend logger — circular in-memory buffer + localStorage persistence.
 *
 * Usage:
 *   import { flog } from '../utils/frontendLogger'
 *   flog.info('SESSION', 'Charge started', { targetSoc: 80, targetAmps: 16 })
 *   flog.warn('HA', 'Token will expire soon')
 *   flog.error('API', 'Request failed', { status: 500 })
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface FrontendLogEntry {
  ts: string        // ISO timestamp
  level: LogLevel
  tag: string       // uppercase category tag e.g. "SESSION", "HA", "SETTINGS"
  msg: string
  meta?: Record<string, unknown>
}

const MAX_ENTRIES = 2000
const STORAGE_KEY = 'evload.frontendLogs'
const STORAGE_MAX_BYTES = 512 * 1024 // 512 KB cap for localStorage

let buffer: FrontendLogEntry[] = []

function loadFromStorage(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as FrontendLogEntry[]
    if (Array.isArray(parsed)) {
      buffer = parsed.slice(-MAX_ENTRIES)
    }
  } catch {
    buffer = []
  }
}

function saveToStorage(): void {
  try {
    const serialized = JSON.stringify(buffer)
    if (serialized.length > STORAGE_MAX_BYTES) {
      // Drop oldest entries until within budget
      const trimmed = [...buffer]
      while (trimmed.length > 0) {
        trimmed.shift()
        const s = JSON.stringify(trimmed)
        if (s.length <= STORAGE_MAX_BYTES) {
          buffer = trimmed
          window.localStorage.setItem(STORAGE_KEY, s)
          return
        }
      }
    } else {
      window.localStorage.setItem(STORAGE_KEY, serialized)
    }
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}

// Bootstrap: load persisted entries once
try {
  loadFromStorage()
} catch {
  // Ignore SSR / test environments without window
}

function push(level: LogLevel, tag: string, msg: string, meta?: Record<string, unknown>): void {
  const entry: FrontendLogEntry = {
    ts: new Date().toISOString(),
    level,
    tag: tag.toUpperCase(),
    msg,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  }
  buffer = [...buffer.slice(-(MAX_ENTRIES - 1)), entry]
  saveToStorage()
}

/** Return all log entries (newest last). */
export function getLogEntries(): FrontendLogEntry[] {
  return [...buffer]
}

/** Clear all frontend log entries from memory and storage. */
export function clearLogs(): void {
  buffer = []
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore
  }
}

/** Download all frontend logs as a plain-text file. */
export function downloadFrontendLogs(): void {
  const lines = buffer.map((e) => {
    const meta = e.meta ? ' ' + JSON.stringify(e.meta) : ''
    return `${e.ts} [${e.level.toUpperCase()}] [${e.tag}] ${e.msg}${meta}`
  })
  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `evload-frontend-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Serialize all log entries for upload to the backend. */
export function serializeLogsForUpload(): string {
  return buffer
    .map((e) => {
      const meta = e.meta ? ' ' + JSON.stringify(e.meta) : ''
      return `${e.ts} [${e.level.toUpperCase()}] [${e.tag}] ${e.msg}${meta}`
    })
    .join('\n')
}

export const flog = {
  debug: (tag: string, msg: string, meta?: Record<string, unknown>) => push('debug', tag, msg, meta),
  info:  (tag: string, msg: string, meta?: Record<string, unknown>) => push('info',  tag, msg, meta),
  warn:  (tag: string, msg: string, meta?: Record<string, unknown>) => push('warn',  tag, msg, meta),
  error: (tag: string, msg: string, meta?: Record<string, unknown>) => push('error', tag, msg, meta),
}
