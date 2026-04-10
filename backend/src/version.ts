import axios from 'axios'
import { logger } from './logger'

export const VERSION = '1.5.9'

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
    version: '1.5.9',
    releasedAt: '2026-04-10',
    summary: 'Fix notification test regression: settings.routes.test.ts now mocks ../../auth and ../../prisma so jest.resetModules() does not break the Prisma client import chain. Added 6 new regression tests for the /telegram/test endpoint (400 on bad event/payload/prereq, 200 on success, 500 on throw). Added 6 new unit tests in notification-rules.service.test.ts: every event has a preset, every event has a schema, every preset passes validateNotificationPayload (the key guard against "Test failed: invalid payload JSON or backend error"), template rendering, sendTelegramNotificationTest renders and injects timestamps. Fixed frontend catch block in NotificationsPage to show the actual backend error message for unhandled Axios errors instead of the generic fallback.',
  },
  {
    version: '1.5.8',
    releasedAt: '2026-04-10',
    summary: 'Robust charge start: new chargeStartGraceSec parameter (default 120s). During the grace window after engine start, temporary vehicle block states (not connected, BLE wake delay, chargingState=Disconnected) are tolerated and charge_start retries continue. Only after the grace window expires with no charging does the engine declare chargeStartBlocked and send the Telegram notification. Exposed in Settings → Charging → Current Limits.',
  },
  {
    version: '1.5.7',
    releasedAt: '2026-04-10',
    summary: 'Plan pre-wake: new planWakeBeforeMinutes config parameter wakes the vehicle X minutes before a scheduled charge in Plan mode (exposed in Settings → Charging → Plan Mode). New {{timestamp_time}} (HH:MM) and {{timestamp_date}} (full date) placeholders for notification templates; default templates updated to use {{timestamp_time}}. New plan_wake notification event. Fixed engine_started template (removed stale {{reason}} placeholder). All example notification templates updated with emojis and meaningful Italian messages.',
  },
  {
    version: '1.5.6',
    releasedAt: '2026-04-10',
    summary: 'Mobile UX improvements for Notifications panel: responsive header with stacked buttons, compact 3-column action grid, separated enable/disable toggle from expand/collapse (fixes invalid nested button), consistent toggle sizes across Event Widget and Rules Builder. Bug fixes: ha_paused event and targetSoc field added to notification catalogs.',
  },
  {
    version: '1.5.5',
    releasedAt: '2026-04-09',
    summary: 'Dashboard reliability and UX update: OFF mode now retries charge_stop on temporary proxy failures, Evload average power uses rolling-window energy slope, Statistics charts use real datetime on X axis, and selected session can be exported as CSV',
  },
  {
    version: '1.5.4',
    releasedAt: '2026-04-08',
    summary: 'Garage commands + charging engine: all proxy commands now use ?wait=true so the proxy waits for BLE completion and auto-wakes the vehicle if asleep (90 s timeout). Fix false proxy-offline: proxyPost/updateProxyDataRequest no longer call markProxyError when the proxy responded with an HTTP error (vehicle issue, not proxy issue). Statistics charts show full session. OTA update panel.',
  },
  {
    version: '1.5.3',
    releasedAt: '2026-04-08',
    summary: 'OTA Update panel in Settings/Versioning: branch selector, local vs remote commit cards with "N commits available" badge, auto git-fetch every 60 s, Start Update button, live scrollable build log, JWT-protected /api/update/* endpoints',
  },
  {
    version: '1.5.2',
    releasedAt: '2026-04-08',
    summary: 'Fix manual charge mode: startEngine(fromPlan=false) resets planArmed so manual sessions report mode=on and return to off after completion; plan sessions stay on plan. Slider now shows engine.targetSoc while charging; slider locked (readonly) during active session; diagnostic flog entries for targetSoc seed/drag/send path',
  },
  {
    version: '1.5.1',
    releasedAt: '2026-04-08',
    summary: 'Fix inflated evload average power after proxy retry/navigation: use authoritative sessionStartedAt (DB timestamp) instead of component-local state; nowTsMs uses wall-clock Date.now()',
  },
  {
    version: '1.5.0',
    releasedAt: '2026-04-07',
    summary: 'Proxy resilience: 3 retry attempts with 30 s timeout before declaring lost communication; ETA guard — stale chargeRateKw/machineHours zeroed when proxy disconnected; Statistics page auto-reloads on session end',
  },
  {
    version: '1.4.0',
    releasedAt: '2026-04-07',
    summary: 'Settings overhaul: "?" tooltip overlays for all parameters, proxy panel split into HTTP/TLS|VIN|Finestra dati|Polling ricarica|Body Controller|Scheduler sub-groups, sleepPollIntervalMs removed (bodyPollIntervalMs used for both awake and asleep body-only polling), vehicle data window countdown in proxy status',
  },
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
