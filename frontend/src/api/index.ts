import axios from 'axios'
import { useAuthStore } from '../store/authStore'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      useAuthStore.getState().clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export async function startCharging(targetSoc: number, targetAmps?: number) {
  const res = await api.post('/engine/start', { targetSoc, targetAmps })
  return res.data as { success: boolean }
}

export async function setPlanMode(targetSoc: number) {
  const res = await api.post('/engine/mode', { mode: 'plan', targetSoc })
  return res.data as { success: boolean }
}

export async function stopCharging() {
  const res = await api.post('/engine/stop')
  return res.data as { success: boolean }
}

export async function wakeVehicle() {
  const res = await api.post('/engine/wake')
  return res.data as { success: boolean }
}

export interface EngineTargetSocPreferences {
  on: number
  off: number
}

export async function getEngineTargetSocPreferences() {
  const res = await api.get('/engine/targets')
  return res.data as { success: boolean; targets: EngineTargetSocPreferences }
}

export async function patchEngineTargetSocPreference(input: {
  mode: 'on' | 'off'
  targetSoc: number
  applyToRunningOnSession?: boolean
}) {
  const res = await api.patch('/engine/targets', input)
  return res.data as { success: boolean; targets: EngineTargetSocPreferences }
}

export async function getSessions(page = 1, limit = 20) {
  const res = await api.get(`/sessions?page=${page}&limit=${limit}`)
  return res.data as { sessions: unknown[]; total: number; page: number; limit: number }
}

export async function getSession(id: number) {
  const res = await api.get(`/sessions/${id}`)
  return res.data
}

export async function deleteSession(id: number) {
  const res = await api.delete(`/sessions/${id}`)
  return res.data as { success: boolean; id: number }
}

export async function triggerTestEvent(event: string, payload: Record<string, unknown>) {
  const res = await api.post('/engine/test-event', { event, payload })
  return res.data as { success: boolean; delivered: number; matchedRules: string[]; messages: string[] }
}

export interface NotificationEventSchema {
  required: string[]
  fields: Record<string, 'string' | 'number' | 'boolean'>
}

export async function getHaAuthorizeUrl(returnTo?: string) {
  const res = await api.get('/ha/authorize', {
    params: returnTo ? { returnTo } : undefined,
  })
  return res.data as { url: string }
}

export interface HaEntityOption {
  entityId: string
  friendlyName: string
  unit: string | null
}

export async function getHaEntities(domain = 'sensor') {
  const res = await api.get('/ha/entities', { params: { domain } })
  return res.data as { domain: string; entities: HaEntityOption[] }
}

export interface HaTokenStatus {
  hasToken: boolean
  issuedAt: string | null
  expiresAt: string | null
  expiresInSec: number | null
  secondsRemaining: number | null
  isExpired: boolean
  refreshWindowSec: number
}

export async function getHaTokenStatus() {
  const res = await api.get('/ha/token-status')
  return res.data as HaTokenStatus
}

export interface VersionHistoryEntry {
  version: string
  releasedAt: string
  summary: string
}

export interface VersionInfoResponse {
  current: string
  latest?: string
  needsUpdate: boolean
  history: VersionHistoryEntry[]
}

export async function getVersionInfo() {
  const res = await api.get('/version')
  return res.data as VersionInfoResponse
}

export async function getConfig() {
  const res = await api.get('/config')
  return res.data as { content: string }
}

export async function saveConfig(content: string) {
  const res = await api.post('/config', { content })
  return res.data as { success: boolean }
}

// ─── Structured Settings ─────────────────────────────────────────────────────

export interface AppSettings {
  demo: boolean
  logLevel: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'
  haUrl: string
  haPowerEntityId: string
  haChargerEntityId: string
  haMaxHomePowerW: number
  resumeDelaySec: number
  proxyUrl: string
  vehicleId: string
  vehicleName: string
  chargingPollIntervalMs: number
  windowPollIntervalMs: number
  bodyPollIntervalMs: number
  vehicleDataWindowMs: number
  scheduleLeadTimeSec: number
  rejectUnauthorized: boolean
  batteryCapacityKwh: number
  energyPriceEurPerKwh: number
  defaultAmps: number
  startAmps: number
  maxAmps: number
  minAmps: number
  stopChargeOnManualStart: boolean
  rampIntervalSec: number
  chargeStartRetryMs: number
  telegramEnabled: boolean
  telegramBotToken?: string
  telegramAllowedChatIds: string[]
  telegramRules: TelegramNotificationRule[]
}

export interface TelegramNotificationCondition {
  field: string
  operator:
    | 'exists'
    | 'equals'
    | 'not_equals'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'changed'
    | 'increased_by'
    | 'decreased_by'
    | 'mod_step'
  value?: string | number | boolean
}

export interface TelegramNotificationRule {
  id: string
  name: string
  enabled: boolean
  event: string
  template: string
  condition?: TelegramNotificationCondition
}

export async function getSettings() {
  const res = await api.get('/settings')
  return res.data as AppSettings
}

export async function patchSettings(partial: Partial<AppSettings>) {
  const res = await api.patch('/settings', partial)
  return res.data as { success: boolean }
}

export async function sendTelegramTestNotification(input: {
  event: string
  template: string
  payload?: Record<string, unknown>
}) {
  const res = await api.post('/settings/telegram/test', input)
  return res.data as { success: boolean; rendered: string; delivered: boolean; missingPlaceholders?: string[] }
}

export interface TelegramPlaceholdersResponse {
  messageSource?: 'user_rules_only' | string
  events: string[]
  placeholders: {
    all: string[]
    byEvent: Record<string, string[]>
    descriptions: Record<string, string>
    presets: Record<string, Record<string, unknown>>
    schemas: Record<string, NotificationEventSchema>
  }
}

export async function getTelegramPlaceholders() {
  const res = await api.get('/settings/telegram/placeholders')
  return res.data as TelegramPlaceholdersResponse
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

/**
 * Download the backend combined or error log as a file.
 * Triggers a browser file download.
 */
export async function downloadBackendLog(type: 'combined' | 'error' = 'combined', since?: string): Promise<void> {
  const res = await api.get(`/settings/logs/backend`, {
    params: { type, format: 'pretty', ...(since ? { since } : {}) },
    responseType: 'blob',
  })
  const blob = new Blob([res.data as BlobPart], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const filename = type === 'error' ? 'evload-backend-error.log' : 'evload-backend-combined.log'
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Download the persisted frontend log from the backend.
 * Triggers a browser file download.
 */
export async function downloadFrontendLogFromBackend(): Promise<void> {
  const res = await api.get('/settings/logs/frontend', { responseType: 'blob' })
  const blob = new Blob([res.data as BlobPart], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'evload-frontend.log'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Upload the current frontend log buffer to the backend for server-side persistence.
 */
export async function uploadFrontendLogs(logs: string): Promise<{ success: boolean }> {
  const res = await api.post('/settings/logs/frontend', { logs })
  return res.data as { success: boolean }
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export interface ScheduledCharge {
  id: number
  vehicleId: string
  scheduleType: string
  scheduledAt: string | null
  finishBy: string | null
  startedAt?: string | null
  targetSoc: number
  targetAmps: number | null
  enabled: boolean
  createdAt: string
}

export interface ScheduledClimate {
  id: number
  vehicleId: string
  scheduleType: string
  scheduledAt: string | null
  finishBy: string | null
  startedAt?: string | null
  targetTempC: number
  enabled: boolean
  createdAt: string
}

export interface NextPlannedCharge {
  id: number
  scheduleType: string
  targetSoc: number
  targetAmps: number | null
  computedStartAt: string
  finishBy: string | null
}

export async function getNextPlannedCharge() {
  const res = await api.get('/schedule/next-charge')
  return res.data as NextPlannedCharge | null
}

export async function getScheduledCharges() {
  const res = await api.get('/schedule/charges')
  return res.data as ScheduledCharge[]
}

export async function createScheduledCharge(
  options:
    | { scheduleType: 'start_at'; scheduledAt: string; targetSoc: number; targetAmps?: number }
    | { scheduleType: 'finish_by'; finishBy: string; targetSoc: number; targetAmps?: number }
    | { scheduleType: 'start_end'; scheduledAt: string; finishBy: string; targetSoc: number; targetAmps?: number }
    | { scheduleType: 'weekly'; scheduledAt: string; targetSoc: number; targetAmps?: number }
) {
  const res = await api.post('/schedule/charges', options)
  return res.data as ScheduledCharge
}

export async function deleteScheduledCharge(id: number) {
  const res = await api.delete(`/schedule/charges/${id}`)
  return res.data as { success: boolean }
}

export async function getScheduledClimates() {
  const res = await api.get('/schedule/climate')
  return res.data as ScheduledClimate[]
}

export async function createScheduledClimate(
  options:
    | { scheduleType: 'start_at'; scheduledAt: string; targetTempC: number }
    | { scheduleType: 'start_end'; scheduledAt: string; finishBy: string; targetTempC: number }
    | { scheduleType: 'weekly'; scheduledAt: string; targetTempC: number }
) {
  const res = await api.post('/schedule/climate', options)
  return res.data as ScheduledClimate
}

export async function deleteScheduledClimate(id: number) {
  const res = await api.delete(`/schedule/climate/${id}`)
  return res.data as { success: boolean }
}

export async function sendVehicleCommand(cmd: string, body?: Record<string, unknown>) {
  const res = await api.post(`/vehicle/command/${encodeURIComponent(cmd)}`, body ?? {})
  return res.data as { success: boolean; result: unknown }
}

export async function updateVehicleDataRequest(
  section: 'charge_state' | 'climate_state',
  payload: Record<string, unknown>
) {
  const res = await api.put(`/vehicle/data-request/${section}`, payload)
  return res.data as { success: boolean; result: unknown }
}

// ─── Garage ───────────────────────────────────────────────────────────────────

/**
 * Control the RPi physical display (requires GARAGE_MODE=true on backend).
 */
export async function setGarageDisplay(on: boolean) {
  const res = await api.post('/garage/display', { on })
  return res.data as { success: boolean; on: boolean }
}

// ─── Backup (Google Drive) ────────────────────────────────────────────────────

export interface BackupStatus {
  connected: boolean
  lastBackupAt: string | null
  nextBackupAt: string | null
  frequency: string
  time: string
  enabled: boolean
  driveFolderPath: string
}

export interface DriveBackupFile {
  id: string
  name: string
  createdTime: string | null
}

export interface DriveFolderInfo {
  id: string
  name: string
  path: string
}

export async function getBackupStatus() {
  const res = await api.get('/backup/status')
  return res.data as BackupStatus
}

export async function startBackupOAuth() {
  const res = await api.get('/backup/oauth/start')
  return res.data as { url: string }
}

export async function disconnectBackupOAuth() {
  const res = await api.delete('/backup/oauth')
  return res.data as { success: boolean }
}

export async function triggerBackup() {
  const res = await api.post('/backup/trigger')
  return res.data as { success: boolean; fileId: string }
}

export async function listBackupFiles() {
  const res = await api.get('/backup/list')
  return res.data as { files: DriveBackupFile[] }
}

export async function listDriveFolders() {
  const res = await api.get('/backup/folders')
  return res.data as { folders: DriveFolderInfo[] }
}

export async function restoreBackup(fileId: string) {
  const res = await api.post('/backup/restore', { fileId })
  return res.data as { success: boolean }
}

// ─── OTA Update ───────────────────────────────────────────────────────────────

export interface CommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

export interface UpdateStatusResponse {
  state: 'idle' | 'running' | 'success' | 'error'
  branch: string | null
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
  logSizeBytes: number
  currentBranch: string
  branches: string[]
  localCommit: CommitInfo | null
  remoteCommit: CommitInfo | null
  behindCount: number
}

export async function getUpdateStatus(branch?: string) {
  const res = await api.get('/update/status', branch ? { params: { branch } } : {})
  return res.data as UpdateStatusResponse
}

export async function triggerFetch(branch?: string) {
  const res = await api.post('/update/fetch', branch ? { branch } : {})
  return res.data as { success: boolean; localCommit: CommitInfo | null; remoteCommit: CommitInfo | null; behindCount: number }
}

export async function startOtaUpdate(branch: string) {
  const res = await api.post('/update/start', { branch })
  return res.data as { success: boolean; branch: string }
}

export async function getOtaLogs(from = 0) {
  const res = await api.get(`/update/logs?from=${from}`)
  return res.data as { content: string; totalBytes: number }
}
