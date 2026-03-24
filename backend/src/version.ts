import axios from 'axios'
import { logger } from './logger'

export const VERSION = '1.1.0'

export interface VersionInfo {
  current: string
  latest?: string
  needsUpdate: boolean
}

export interface VersionHistoryEntry {
  version: string
  releasedAt: string
  summary: string
}

export const VERSION_HISTORY: VersionHistoryEntry[] = [
  {
    version: '1.1.0',
    releasedAt: '2026-03-24',
    summary: 'Backend meter-vs-vehicle energy tracking, session efficiency persistence, and UI version panel',
  },
  {
    version: '1.0.0',
    releasedAt: '2026-03-18',
    summary: 'Stable charging engine modes, scheduler, HA integration, dashboard, and telemetry sessions',
  },
]

let latestVersionCache: string | null = null
let lastCheckMs = 0
const CHECK_INTERVAL_MS = 3600000 // 1 hour

export async function getVersionInfo(): Promise<VersionInfo> {
  const now = Date.now()
  
  if (!latestVersionCache || now - lastCheckMs > CHECK_INTERVAL_MS) {
    try {
      // Fetch latest version from GitHub API
      // We look at the package.json on main branch for simplicity
      const res = await axios.get('https://raw.githubusercontent.com/pacioc193/evload/main/package.json', { timeout: 5000 })
      if (res.data?.version) {
        latestVersionCache = res.data.version
        lastCheckMs = now
      }
    } catch (err) {
      logger.debug('Failed to check for latest version from GitHub', { err: (err as Error).message })
    }
  }

  return {
    current: VERSION,
    latest: latestVersionCache ?? undefined,
    needsUpdate: latestVersionCache ? isNewer(VERSION, latestVersionCache) : false
  }
}

function isNewer(current: string, latest: string): boolean {
  try {
    const c = current.split('.').map(Number)
    const l = latest.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if (l[i] > c[i]) return true
      if (l[i] < c[i]) return false
    }
    return false
  } catch {
    return false
  }
}
