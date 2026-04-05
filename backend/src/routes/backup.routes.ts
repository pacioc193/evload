import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { logger } from '../logger'
import {
  getOAuthUrl,
  handleOAuthCallback,
  disconnectDrive,
  getBackupStatus,
  createBackup,
  listBackups,
  restoreBackup,
} from '../services/backup.service'

const router = Router()
const backupActionLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 })

/** GET /api/backup/status — connection state + last/next backup info */
router.get('/status', backupActionLimiter, requireAuth, async (_req, res) => {
  try {
    const status = await getBackupStatus()
    res.json(status)
  } catch (err) {
    logger.error('BACKUP_ROUTE: status error', { err })
    res.status(500).json({ error: 'Failed to get backup status' })
  }
})

/** GET /api/backup/oauth/start — redirect user to Google OAuth consent screen */
router.get('/oauth/start', backupActionLimiter, requireAuth, (_req, res) => {
  try {
    const url = getOAuthUrl()
    res.json({ url })
  } catch (err) {
    logger.error('BACKUP_ROUTE: oauth start error', { err })
    res.status(500).json({ error: String(err) })
  }
})

/** GET /api/backup/oauth/callback — handle Google OAuth callback code */
router.get('/oauth/callback', async (req, res) => {
  const code = req.query['code'] as string | undefined
  if (!code) {
    res.status(400).send('Missing OAuth code')
    return
  }
  try {
    await handleOAuthCallback(code)
    // Redirect back to the settings page after successful authorisation
    res.redirect('/#/settings?backupConnected=1')
  } catch (err) {
    logger.error('BACKUP_ROUTE: oauth callback error', { err })
    res.status(500).send('OAuth callback failed: ' + String(err))
  }
})

/** DELETE /api/backup/oauth — disconnect Google Drive */
router.delete('/oauth', backupActionLimiter, requireAuth, async (_req, res) => {
  try {
    await disconnectDrive()
    res.json({ success: true })
  } catch (err) {
    logger.error('BACKUP_ROUTE: disconnect error', { err })
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

/** POST /api/backup/trigger — run an immediate backup */
router.post('/trigger', backupActionLimiter, requireAuth, async (_req, res) => {
  try {
    const fileId = await createBackup()
    res.json({ success: true, fileId })
  } catch (err) {
    logger.error('BACKUP_ROUTE: trigger error', { err })
    res.status(500).json({ error: String(err) })
  }
})

/** GET /api/backup/list — list backup files on Drive */
router.get('/list', backupActionLimiter, requireAuth, async (_req, res) => {
  try {
    const files = await listBackups()
    res.json({ files })
  } catch (err) {
    logger.error('BACKUP_ROUTE: list error', { err })
    res.status(500).json({ error: String(err) })
  }
})

/** POST /api/backup/restore — restore a backup by Drive file ID */
router.post('/restore', backupActionLimiter, requireAuth, async (req, res) => {
  const { fileId } = req.body as { fileId?: string }
  if (!fileId) {
    res.status(400).json({ error: 'fileId is required' })
    return
  }
  try {
    await restoreBackup(fileId)
    res.json({ success: true })
  } catch (err) {
    logger.error('BACKUP_ROUTE: restore error', { err })
    res.status(500).json({ error: String(err) })
  }
})

export default router
