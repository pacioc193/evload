import axios from 'axios'
import { EventEmitter } from 'events'
import { PrismaClient } from '@prisma/client'
import { logger } from '../logger'
import { getConfig } from '../config'
import { getVehicleState } from './proxy.service'

const prisma = new PrismaClient()

export interface HaState {
  connected: boolean
  powerW: number | null
  chargerW: number | null
  lastUpdated: Date | null
  error?: string
}

export const haEvents = new EventEmitter()

let haState: HaState = {
  connected: false,
  powerW: null,
  chargerW: null,
  lastUpdated: null,
}

let pollLock = false
let pollTimer: NodeJS.Timeout | null = null

async function getHaToken(): Promise<string | null> {
  const rec = await prisma.appConfig.findUnique({ where: { key: 'ha_token' } })
  return rec?.value ?? null
}

export async function saveHaToken(token: string): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key: 'ha_token' },
    update: { value: token },
    create: { key: 'ha_token', value: token },
  })
  logger.info('HA token saved')
}

export async function getHaTokenObj(): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const rec = await prisma.appConfig.findUnique({ where: { key: 'ha_token_obj' } })
  if (!rec) return null
  try {
    return JSON.parse(rec.value) as { access_token: string; refresh_token: string; expires_in: number }
  } catch {
    return null
  }
}

export async function saveHaTokenObj(obj: { access_token: string; refresh_token: string; expires_in: number }): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key: 'ha_token_obj' },
    update: { value: JSON.stringify(obj) },
    create: { key: 'ha_token_obj', value: JSON.stringify(obj) },
  })
  logger.info('HA token object saved')
}

async function pollHaOnce(): Promise<void> {
  if (pollLock) {
    logger.debug('HA poll skipped - previous poll still in progress')
    return
  }
  pollLock = true
  try {
    const cfg = getConfig()
    if (cfg.demo) {
      const v = getVehicleState()
      const carW = Math.max(0, ((v.chargerActualCurrent ?? 0) * (v.chargerVoltage ?? 0)))
      const baseHomeW = 900 + Math.round((Date.now() / 1000) % 120)
      const homePowerW = baseHomeW + carW
      haState = {
        connected: true,
        powerW: homePowerW,
        chargerW: carW,
        lastUpdated: new Date(),
      }
      haEvents.emit('state', haState)
      return
    }
    const tokenObj = await getHaTokenObj()
    const token = tokenObj?.access_token ?? (await getHaToken())
    if (!token) {
      haState = { connected: false, powerW: null, chargerW: null, lastUpdated: new Date(), error: 'No HA token' }
      haEvents.emit('state', haState)
      return
    }
    const haUrl = cfg.homeAssistant.url
    const headers = { Authorization: `Bearer ${token}` }

    const [powerRes, chargerRes] = await Promise.allSettled([
      axios.get<{ state: string }>(`${haUrl}/api/states/${cfg.homeAssistant.powerEntityId}`, { headers, timeout: 5000 }),
      cfg.homeAssistant.chargerEntityId
        ? axios.get<{ state: string }>(`${haUrl}/api/states/${cfg.homeAssistant.chargerEntityId}`, { headers, timeout: 5000 })
        : Promise.resolve(null),
    ])

    const powerW = powerRes.status === 'fulfilled' && powerRes.value
      ? parseFloat(powerRes.value.data.state) || null
      : null

    const chargerW = chargerRes.status === 'fulfilled' && chargerRes.value
      ? parseFloat((chargerRes.value as { data: { state: string } }).data.state) || null
      : null

    haState = { connected: true, powerW, chargerW, lastUpdated: new Date() }
    haEvents.emit('state', haState)
  } catch (err) {
    logger.error('HA poll error', { err })
    const prevConnected = haState.connected
    haState = { connected: false, powerW: null, chargerW: null, lastUpdated: new Date(), error: String(err) }
    if (prevConnected) {
      haEvents.emit('disconnected', haState)
    }
    haEvents.emit('state', haState)
  } finally {
    pollLock = false
  }
}

export function startHaPoll(): void {
  if (pollTimer) return
  logger.info('Starting HA polling at 1Hz')
  pollTimer = setInterval(() => {
    pollHaOnce().catch((err) => logger.error('Unhandled HA poll rejection', { err }))
  }, 1000)
}

export function stopHaPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    logger.info('HA polling stopped')
  }
}

export function getHaState(): HaState {
  return haState
}
