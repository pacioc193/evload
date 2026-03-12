import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth.middleware'
import { getConfig } from '../config'
import { logger } from '../logger'

const prisma = new PrismaClient()
const router = Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

// ─── Scheduled Charges ───────────────────────────────────────────────────────

router.get('/charges', limiter, requireAuth, async (_req, res) => {
  try {
    const items = await prisma.scheduledCharge.findMany({ orderBy: { scheduledAt: 'asc' } })
    res.json(items)
  } catch (err) {
    logger.error('Failed to list scheduled charges', { err })
    res.status(500).json({ error: 'Failed to list scheduled charges' })
  }
})

router.post('/charges', limiter, requireAuth, async (req, res) => {
  const { scheduledAt, targetSoc, targetAmps } = req.body as {
    scheduledAt?: string
    targetSoc?: number
    targetAmps?: number
  }
  if (!scheduledAt || targetSoc == null) {
    res.status(400).json({ error: 'scheduledAt and targetSoc are required' })
    return
  }
  const soc = Number(targetSoc)
  if (soc < 1 || soc > 100) {
    res.status(400).json({ error: 'targetSoc must be 1-100' })
    return
  }
  const date = new Date(scheduledAt)
  if (isNaN(date.getTime())) {
    res.status(400).json({ error: 'Invalid scheduledAt date' })
    return
  }
  try {
    const cfg = getConfig()
    const item = await prisma.scheduledCharge.create({
      data: {
        vehicleId: cfg.proxy.vehicleId,
        scheduledAt: date,
        targetSoc: soc,
        targetAmps: targetAmps != null ? Number(targetAmps) : null,
      },
    })
    res.json(item)
  } catch (err) {
    logger.error('Failed to create scheduled charge', { err })
    res.status(500).json({ error: 'Failed to create scheduled charge' })
  }
})

router.delete('/charges/:id', limiter, requireAuth, async (req, res) => {
  const id = parseInt(String(req.params['id']), 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid ID' })
    return
  }
  try {
    await prisma.scheduledCharge.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete scheduled charge', { err })
    res.status(500).json({ error: 'Failed to delete scheduled charge' })
  }
})

// ─── Scheduled Climate ────────────────────────────────────────────────────────

router.get('/climate', limiter, requireAuth, async (_req, res) => {
  try {
    const items = await prisma.scheduledClimate.findMany({ orderBy: { scheduledAt: 'asc' } })
    res.json(items)
  } catch (err) {
    logger.error('Failed to list scheduled climate', { err })
    res.status(500).json({ error: 'Failed to list scheduled climate' })
  }
})

router.post('/climate', limiter, requireAuth, async (req, res) => {
  const { scheduledAt, targetTempC } = req.body as {
    scheduledAt?: string
    targetTempC?: number
  }
  if (!scheduledAt || targetTempC == null) {
    res.status(400).json({ error: 'scheduledAt and targetTempC are required' })
    return
  }
  const temp = Number(targetTempC)
  if (temp < 15 || temp > 30) {
    res.status(400).json({ error: 'targetTempC must be 15-30' })
    return
  }
  const date = new Date(scheduledAt)
  if (isNaN(date.getTime())) {
    res.status(400).json({ error: 'Invalid scheduledAt date' })
    return
  }
  try {
    const cfg = getConfig()
    const item = await prisma.scheduledClimate.create({
      data: {
        vehicleId: cfg.proxy.vehicleId,
        scheduledAt: date,
        targetTempC: temp,
      },
    })
    res.json(item)
  } catch (err) {
    logger.error('Failed to create scheduled climate', { err })
    res.status(500).json({ error: 'Failed to create scheduled climate' })
  }
})

router.delete('/climate/:id', limiter, requireAuth, async (req, res) => {
  const id = parseInt(String(req.params['id']), 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid ID' })
    return
  }
  try {
    await prisma.scheduledClimate.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to delete scheduled climate', { err })
    res.status(500).json({ error: 'Failed to delete scheduled climate' })
  }
})

export default router
