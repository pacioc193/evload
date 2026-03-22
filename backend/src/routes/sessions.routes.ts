import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middleware/auth.middleware'
import { prisma } from '../prisma'

const router = Router()

const sessionsLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

router.get('/', sessionsLimiter, requireAuth, async (req, res) => {
  const page = parseInt(String(req.query['page'] ?? '1'), 10)
  const limit = parseInt(String(req.query['limit'] ?? '20'), 10)
  const sessions = await prisma.chargingSession.findMany({
    orderBy: { startedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: { _count: { select: { telemetry: true } } },
  })
  const total = await prisma.chargingSession.count()
  res.json({ sessions, total, page, limit })
})

router.get('/:id', sessionsLimiter, requireAuth, async (req, res) => {
  const id = parseInt(String(req.params['id'] ?? ''), 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid session ID' })
    return
  }
  const session = await prisma.chargingSession.findUnique({
    where: { id },
    include: {
      telemetry: {
        orderBy: { recordedAt: 'asc' },
        take: 3600,
      },
    },
  })
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  res.json(session)
})

router.delete('/:id', sessionsLimiter, requireAuth, async (req, res) => {
  const id = parseInt(String(req.params['id'] ?? ''), 10)
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid session ID' })
    return
  }

  const existingSession = await prisma.chargingSession.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!existingSession) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  await prisma.chargingSession.delete({ where: { id } })
  res.json({ success: true, id })
})

export default router
