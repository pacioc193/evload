import { Router } from 'express'
import axios from 'axios'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { saveHaTokenObj, getHaState } from '../services/ha.service'
import { logger } from '../logger'

const router = Router()

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })

const HA_URL = () => process.env.HA_URL ?? 'http://homeassistant.local:8123'
const CLIENT_ID = () => process.env.HA_CLIENT_ID ?? ''
const CLIENT_SECRET = () => process.env.HA_CLIENT_SECRET ?? ''
const REDIRECT_URI = () => process.env.APP_URL ? `${process.env.APP_URL}/api/ha/callback` : `http://localhost:3001/api/ha/callback`

router.get('/authorize', limiter, requireAuth, (_req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: REDIRECT_URI(),
    response_type: 'code',
  })
  const authUrl = `${HA_URL()}/auth/authorize?${params.toString()}`
  res.json({ url: authUrl })
})

router.get('/callback', limiter, async (req, res) => {
  const { code } = req.query as { code?: string }
  if (!code) {
    res.status(400).send('Missing authorization code')
    return
  }
  try {
    const tokenRes = await axios.post<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${HA_URL()}/auth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        redirect_uri: REDIRECT_URI(),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    await saveHaTokenObj(tokenRes.data)
    res.redirect('/?ha=connected')
  } catch (err) {
    logger.error('HA OAuth callback error', { err })
    res.redirect('/?ha=error')
  }
})

router.get('/state', limiter, requireAuth, (_req, res) => {
  res.json(getHaState())
})

export default router
