import axios from 'axios'
import { logger } from './logger'

export const VERSION = '1.3.0'

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
    version: '1.3.0',
    releasedAt: '2026-04-07',
    summary: 'Smart vehicle_data window polling (body-only after wake window), 5 configurable poll intervals, garage dashboard split into "Opzioni Auto" / "Opzioni Schermo", settings UX improvements',
  },
  {
    version: '1.2.0',
    releasedAt: '2026-04-01',
    summary: 'Adaptive polling (normal vs idle), vehicle wake on manual start, and improved average power responsiveness',
  },
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
      // Use GitHub Releases API for latest release tag.
      // If GITHUB_TOKEN is set it will work for private repos too.
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      const token = process.env.GITHUB_TOKEN
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await axios.get('https://api.github.com/repos/pacioc193/evload/releases/latest', {
        timeout: 5000,
        headers,
      })
      const tag: string = res.data?.tag_name ?? ''
      // Strip leading 'v' if present (e.g. 'v1.3.0' → '1.3.0')
      const version = tag.replace(/^v/, '')
      if (version) {
        latestVersionCache = version
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
