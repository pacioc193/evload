/**
 * Google Drive Backup Service
 *
 * Handles OAuth2 authentication, backup creation (config.yaml + SQLite DB),
 * retention management, and restore from Drive.
 *
 * OAuth credentials must be stored in environment variables:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI  (default: http://<APP_URL>/api/backup/oauth/callback)
 *
 * Access/refresh tokens are persisted in appConfig table (keys: google_access_token,
 * google_refresh_token, google_token_expiry).
 */

import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { google } from 'googleapis'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { getConfig } from '../config'

const execAsync = promisify(exec)

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(__dirname, '../../config.yaml')
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') ?? path.join(__dirname, '../../data/evload.db')
const BACKUP_TMP_DIR = path.join(__dirname, '../../data/backup_tmp')
const DRIVE_FOLDER_NAME = 'evload-backups'

// ─── OAuth2 Client ──────────────────────────────────────────────────────────

function createOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.APP_URL ?? 'http://localhost:3001'}/api/backup/oauth/callback`

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment to use Google Drive backup.')
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function getOAuthUrl(): string {
  const oauth2Client = createOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent',
  })
}

export async function handleOAuthCallback(code: string): Promise<void> {
  const oauth2Client = createOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)

  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: {
      google_access_token: tokens.access_token ?? null,
      google_refresh_token: tokens.refresh_token ?? null,
      google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    create: {
      id: 1,
      google_access_token: tokens.access_token ?? null,
      google_refresh_token: tokens.refresh_token ?? null,
      google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  })
  logger.info('BACKUP_OAUTH: Google Drive tokens saved')
}

export async function disconnectDrive(): Promise<void> {
  await prisma.appConfig.update({
    where: { id: 1 },
    data: {
      google_access_token: null,
      google_refresh_token: null,
      google_token_expiry: null,
    },
  })
  logger.info('BACKUP_OAUTH: Google Drive disconnected')
}

async function getAuthenticatedClient() {
  const config = await prisma.appConfig.findUnique({ where: { id: 1 } })
  if (!config?.google_refresh_token) {
    throw new Error('Google Drive not connected. Please authorise via Settings → Backup.')
  }

  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({
    access_token: config.google_access_token ?? undefined,
    refresh_token: config.google_refresh_token,
    expiry_date: config.google_token_expiry?.getTime() ?? undefined,
  })

  // Auto-refresh token if expired
  oauth2Client.on('tokens', async (tokens) => {
    await prisma.appConfig.update({
      where: { id: 1 },
      data: {
        google_access_token: tokens.access_token ?? undefined,
        google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    })
  })

  return oauth2Client
}

// ─── Drive helpers ──────────────────────────────────────────────────────────

async function getOrCreateBackupFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
  const res = await drive.files.list({
    q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  })
  const files = res.data.files ?? []
  if (files.length > 0 && files[0].id) {
    return files[0].id
  }
  const folder = await drive.files.create({
    requestBody: {
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  })
  return folder.data.id!
}

// ─── Backup status ──────────────────────────────────────────────────────────

export interface BackupStatus {
  connected: boolean
  lastBackupAt: string | null
  nextBackupAt: string | null
  frequency: string
  time: string
  enabled: boolean
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const cfg = getConfig()
  const config = await prisma.appConfig.findUnique({ where: { id: 1 } })
  const connected = !!(config?.google_refresh_token)

  const lastBackupAt = (config as Record<string, unknown> | null)?.last_backup_at
  const nextBackupAt = computeNextBackupAt(cfg.backup.frequency, cfg.backup.time)

  return {
    connected,
    lastBackupAt: lastBackupAt ? String(lastBackupAt) : null,
    nextBackupAt,
    frequency: cfg.backup.frequency,
    time: cfg.backup.time,
    enabled: cfg.backup.enabled,
  }
}

function computeNextBackupAt(frequency: string, time: string): string | null {
  const [hh, mm] = time.split(':').map(Number)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null

  const now = new Date()
  const candidate = new Date(now)
  candidate.setHours(hh, mm, 0, 0)

  if (candidate <= now) {
    if (frequency === 'daily') {
      candidate.setDate(candidate.getDate() + 1)
    } else if (frequency === 'weekly') {
      candidate.setDate(candidate.getDate() + 7)
    } else if (frequency === 'monthly') {
      candidate.setMonth(candidate.getMonth() + 1)
    }
  }
  return candidate.toISOString()
}

// ─── Create backup ──────────────────────────────────────────────────────────

export async function createBackup(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10)
  const archiveName = `evload-backup-${dateStr}-${Date.now()}.tar.gz`
  const archivePath = path.join(BACKUP_TMP_DIR, archiveName)

  if (!fs.existsSync(BACKUP_TMP_DIR)) {
    fs.mkdirSync(BACKUP_TMP_DIR, { recursive: true })
  }

  // Collect files to archive
  const filesToArchive: string[] = []
  if (fs.existsSync(CONFIG_PATH)) filesToArchive.push(CONFIG_PATH)
  if (fs.existsSync(DB_PATH)) filesToArchive.push(DB_PATH)

  if (filesToArchive.length === 0) {
    throw new Error('No backup files found (config.yaml or evload.db)')
  }

  // Create tar.gz
  const filesArg = filesToArchive.map((f) => `"${f}"`).join(' ')
  await execAsync(`tar -czf "${archivePath}" ${filesArg}`)
  logger.info('BACKUP: Archive created', { archivePath, files: filesToArchive })

  // Upload to Drive
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })
  const folderId = await getOrCreateBackupFolder(drive)

  const uploadRes = await drive.files.create({
    requestBody: {
      name: archiveName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/gzip',
      body: fs.createReadStream(archivePath),
    },
    fields: 'id, name, createdTime',
  })
  logger.info('BACKUP: Uploaded to Google Drive', { fileId: uploadRes.data.id, name: archiveName })

  // Cleanup temp file
  fs.unlinkSync(archivePath)

  // Enforce retention
  await enforceRetention(drive, folderId)

  // Update last_backup_at in DB
  await prisma.appConfig.update({
    where: { id: 1 },
    data: { last_backup_at: new Date() },
  })

  return uploadRes.data.id!
}

async function enforceRetention(drive: ReturnType<typeof google.drive>, folderId: string): Promise<void> {
  const cfg = getConfig()
  const retention = cfg.backup.retentionCount

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'evload-backup-' and trashed=false`,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime asc',
  })
  const files = res.data.files ?? []
  if (files.length > retention) {
    const toDelete = files.slice(0, files.length - retention)
    for (const f of toDelete) {
      await drive.files.delete({ fileId: f.id! }).catch((err) =>
        logger.warn('BACKUP: Failed to delete old backup', { fileId: f.id, err })
      )
      logger.info('BACKUP: Deleted old backup', { fileId: f.id, name: f.name })
    }
  }
}

// ─── List backups ───────────────────────────────────────────────────────────

export interface DriveBackupFile {
  id: string
  name: string
  createdTime: string | null
}

export async function listBackups(): Promise<DriveBackupFile[]> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })
  const folderId = await getOrCreateBackupFolder(drive)

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'evload-backup-' and trashed=false`,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime desc',
  })
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    createdTime: f.createdTime ?? null,
  }))
}

// ─── Restore from backup ────────────────────────────────────────────────────

export async function restoreBackup(fileId: string): Promise<void> {
  const auth = await getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })

  if (!fs.existsSync(BACKUP_TMP_DIR)) {
    fs.mkdirSync(BACKUP_TMP_DIR, { recursive: true })
  }
  const localPath = path.join(BACKUP_TMP_DIR, `restore-${Date.now()}.tar.gz`)

  // Download
  const dest = fs.createWriteStream(localPath)
  const dlRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dlRes.data as any).pipe(dest).on('finish', resolve).on('error', reject)
  })
  logger.info('BACKUP_RESTORE: Downloaded archive', { fileId, localPath })

  // Extract (overwrite in place)
  await execAsync(`tar -xzf "${localPath}" -C /`)
  fs.unlinkSync(localPath)
  logger.info('BACKUP_RESTORE: Extracted and restored files', { fileId })
}

// ─── Scheduled backup check ─────────────────────────────────────────────────

let lastScheduledBackupCheckMs = 0

export async function runScheduledBackupCheck(): Promise<void> {
  const now = Date.now()
  // Check at most every minute
  if (now - lastScheduledBackupCheckMs < 60_000) return
  lastScheduledBackupCheckMs = now

  const cfg = getConfig()
  if (!cfg.backup.enabled) return

  const config = await prisma.appConfig.findUnique({ where: { id: 1 } })
  if (!config?.google_refresh_token) return

  const lastBackupAt = (config as Record<string, unknown>).last_backup_at as Date | null
  if (!shouldRunBackup(cfg.backup.frequency, cfg.backup.time, lastBackupAt)) return

  logger.info('BACKUP: Scheduled backup triggered', { frequency: cfg.backup.frequency, time: cfg.backup.time })
  await createBackup().catch((err) => logger.error('BACKUP: Scheduled backup failed', { err }))
}

function shouldRunBackup(frequency: string, time: string, lastBackupAt: Date | null): boolean {
  const [hh, mm] = time.split(':').map(Number)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false

  const now = new Date()
  const windowStart = new Date(now)
  windowStart.setHours(hh, mm, 0, 0)
  const windowEnd = new Date(windowStart.getTime() + 60_000) // 1-minute window

  if (now < windowStart || now > windowEnd) return false

  if (!lastBackupAt) return true

  const msAgo = now.getTime() - lastBackupAt.getTime()
  if (frequency === 'daily' && msAgo > 23 * 3600 * 1000) return true
  if (frequency === 'weekly' && msAgo > 6 * 24 * 3600 * 1000) return true
  if (frequency === 'monthly' && msAgo > 27 * 24 * 3600 * 1000) return true
  return false
}
