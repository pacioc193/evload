import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth.middleware'
import { getConfig } from '../config'
import { logger } from '../logger'
import { resolveNextPlannedCharge } from '../services/scheduler.service'

const prisma = new PrismaClient()
const router = Router()
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

router.get('/next-charge', limiter, requireAuth, async (_req, res) => {
  try {
    const next = await resolveNextPlannedCharge()
    res.json(next ?? null)
  } catch (err) {
    logger.error('Failed to resolve next planned charge', { err })
    res.status(500).json({ error: 'Failed to resolve next planned charge' })
  }
})

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
  const { scheduledAt, finishBy, scheduleType, targetSoc, targetAmps } = req.body as {
    scheduledAt?: string
    finishBy?: string
    scheduleType?: string
    targetSoc?: number
    targetAmps?: number
  }
  const type = scheduleType ?? 'start_at'
  if (type !== 'start_at' && type !== 'finish_by' && type !== 'start_end' && type !== 'weekly') {
    res.status(400).json({ error: 'scheduleType must be start_at, finish_by, start_end or weekly' })
    return
  }
  if ((type === 'start_at' || type === 'weekly') && !scheduledAt) {
    res.status(400).json({ error: 'scheduledAt is required for start_at/weekly schedules' })
    return
  }
  if (type === 'finish_by' && !finishBy) {
    res.status(400).json({ error: 'finishBy is required for finish_by schedules' })
    return
  }
  if (type === 'start_end' && (!scheduledAt || !finishBy)) {
    res.status(400).json({ error: 'scheduledAt and finishBy are required for start_end schedules' })
    return
  }
  if (targetSoc == null) {
    res.status(400).json({ error: 'targetSoc is required' })
    return
  }
  const soc = Number(targetSoc)
  if (soc < 1 || soc > 100) {
    res.status(400).json({ error: 'targetSoc must be 1-100' })
    return
  }
  const scheduledAtDate = scheduledAt ? new Date(scheduledAt) : undefined
  if (scheduledAtDate && isNaN(scheduledAtDate.getTime())) {
    res.status(400).json({ error: 'Invalid scheduledAt date' })
    return
  }
  const finishByDate = finishBy ? new Date(finishBy) : undefined
  if (finishByDate && isNaN(finishByDate.getTime())) {
    res.status(400).json({ error: 'Invalid finishBy date' })
    return
  }
  if (type === 'start_end' && scheduledAtDate && finishByDate && finishByDate.getTime() <= scheduledAtDate.getTime()) {
    res.status(400).json({ error: 'finishBy must be after scheduledAt for start_end schedules' })
    return
  }
  try {
    const cfg = getConfig()
    const item = await prisma.scheduledCharge.create({
      data: {
        vehicleId: cfg.proxy.vehicleId,
        scheduleType: type,
        scheduledAt: scheduledAtDate ?? null,
        finishBy: finishByDate ?? null,
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
    const items = await prisma.scheduledClimate.findMany({ orderBy: { createdAt: 'asc' } })
    res.json(items)
  } catch (err) {
    logger.error('Failed to list scheduled climate', { err })
    res.status(500).json({ error: 'Failed to list scheduled climate' })
  }
})

router.post('/climate', limiter, requireAuth, async (req, res) => {
  const { scheduleType, scheduledAt, finishBy, targetTempC } = req.body as {
    scheduleType?: string
    scheduledAt?: string
    finishBy?: string
    targetTempC?: number
  }
  const type = scheduleType ?? 'start_at'
  if (type !== 'start_at' && type !== 'start_end' && type !== 'weekly') {
    res.status(400).json({ error: 'scheduleType must be start_at, start_end or weekly' })
    return
  }
  if (!scheduledAt || targetTempC == null) {
    res.status(400).json({ error: 'scheduledAt and targetTempC are required' })
    return
  }
  if (type === 'start_end' && !finishBy) {
    res.status(400).json({ error: 'finishBy is required for start_end climate schedules' })
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
  const finishByDate = finishBy ? new Date(finishBy) : undefined
  if (finishByDate && isNaN(finishByDate.getTime())) {
    res.status(400).json({ error: 'Invalid finishBy date' })
    return
  }
  if (type === 'start_end' && finishByDate && finishByDate.getTime() <= date.getTime()) {
    res.status(400).json({ error: 'finishBy must be after scheduledAt for start_end climate schedules' })
    return
  }
  try {
    const cfg = getConfig()
    const item = await prisma.scheduledClimate.create({
      data: {
        vehicleId: cfg.proxy.vehicleId,
        scheduleType: type,
        scheduledAt: date,
        finishBy: finishByDate ?? null,
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
