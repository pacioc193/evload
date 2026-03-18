import { Router } from 'express'
import axios from 'axios'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { saveHaTokenObj, getHaState, getHaTokenObj } from '../services/ha.service'
import { getConfig } from '../config'
import { logger } from '../logger'

const router = Router()

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })

const HA_URL = () => getConfig().homeAssistant.url
const CLIENT_ID = () => process.env.HA_CLIENT_ID ?? ''
const CLIENT_SECRET = () => process.env.HA_CLIENT_SECRET ?? ''
const DEFAULT_REDIRECT_URI = 'http://localhost:3001/api/ha/callback'

function getAppUrl(): string {
  const raw = process.env.APP_URL?.trim() ?? ''
  return raw.replace(/\/+$/, '')
}

const REDIRECT_URI = () => {
  const appUrl = getAppUrl()
  return appUrl ? `${appUrl}/api/ha/callback` : DEFAULT_REDIRECT_URI
}

function getOauthClientId(): string {
  const configuredClientId = CLIENT_ID().trim()
  if (configuredClientId) {
    return configuredClientId
  }

  const appUrl = getAppUrl()
  if (appUrl) {
    return appUrl
  }

  try {
    return new URL(REDIRECT_URI()).origin
  } catch {
    return ''
  }
}

function getOauthClientSecret(): string {
  return CLIENT_SECRET().trim()
}

function getOauthConfigurationError(): string | null {
  if (!getOauthClientId()) {
    return 'Home Assistant OAuth is not configured: set APP_URL or HA_CLIENT_ID in backend/.env before connecting.'
  }
  return null
}

router.get('/authorize', limiter, requireAuth, (_req, res) => {
  const configError = getOauthConfigurationError()
  if (configError) {
    res.status(500).json({ error: configError })
    return
  }

  const params = new URLSearchParams({
    client_id: getOauthClientId(),
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

  const configError = getOauthConfigurationError()
  if (configError) {
    res.status(500).send(configError)
    return
  }

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: getOauthClientId(),
      redirect_uri: REDIRECT_URI(),
    })
    const clientSecret = getOauthClientSecret()
    if (clientSecret) {
      tokenParams.set('client_secret', clientSecret)
    }

    const tokenRes = await axios.post<{ access_token: string; refresh_token: string; expires_in: number }>(
      `${HA_URL()}/auth/token`,
      tokenParams,
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

type HaEntityState = {
  entity_id: string
  state: string
  attributes?: {
    friendly_name?: string
    unit_of_measurement?: string
  }
}

router.get('/entities', limiter, requireAuth, async (req, res) => {
  try {
    const tokenObj = await getHaTokenObj()
    const token = tokenObj?.access_token
    if (!token) {
      res.status(400).json({ error: 'Home Assistant is not connected yet' })
      return
    }

    const domainRaw = typeof req.query.domain === 'string' ? req.query.domain.trim() : ''
    const domain = (domainRaw || 'sensor').toLowerCase()

    const statesRes = await axios.get<HaEntityState[]>(`${HA_URL()}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    })

    const entities = (statesRes.data ?? [])
      .filter((e) => typeof e.entity_id === 'string' && e.entity_id.startsWith(`${domain}.`))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .map((e) => ({
        entityId: e.entity_id,
        friendlyName: e.attributes?.friendly_name ?? e.entity_id,
        unit: e.attributes?.unit_of_measurement ?? null,
      }))

    res.json({ domain, entities })
  } catch (err) {
    logger.error('Failed to fetch Home Assistant entities', { err })
    res.status(502).json({ error: 'Unable to load Home Assistant entities' })
  }
})

export default router
