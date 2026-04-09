import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/auth.middleware'
import { prisma } from '../prisma'

const router = Router()

const sessionsLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 })

// Maximum telemetry points returned per session.
// Long sessions (e.g. 10 h × 3600 pts/h = 36 000 rows) are downsampled so the
// HTTP response stays small while still showing the full charging curve.
const MAX_CHART_POINTS = 1000

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
  const session = await prisma.chargingSession.findUnique({ where: { id } })
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  const totalPoints = await prisma.chargingTelemetry.count({ where: { sessionId: id } })
  let telemetry: unknown[]

  if (totalPoints <= MAX_CHART_POINTS) {
    // Session fits within the limit — return everything
    telemetry = await prisma.chargingTelemetry.findMany({
      where: { sessionId: id },
      orderBy: { recordedAt: 'asc' },
    })
  } else {
    // Session is too long — downsample to MAX_CHART_POINTS using a SQLite
    // window function.  Every `step`-th row is kept, plus the final row so
    // the end-of-charge SOC/power is always visible.
    const step = Math.max(1, Math.floor(totalPoints / MAX_CHART_POINTS))
    telemetry = await prisma.$queryRaw<unknown[]>(
      Prisma.sql`
        WITH numbered AS (
          SELECT id, sessionId, recordedAt,
                 voltageV, currentA, powerW, energyKwh,
                 stateOfCharge, tempBatteryC, tempCabinC,
                 chargerPilotA, chargerActualA, chargerPhases,
                 chargerVoltage, chargerPower, timeToFullCharge,
                 ROW_NUMBER() OVER (ORDER BY recordedAt ASC) AS rn
          FROM "ChargingTelemetry"
          WHERE sessionId = ${id}
        )
        SELECT id, sessionId, recordedAt,
               voltageV, currentA, powerW, energyKwh,
               stateOfCharge, tempBatteryC, tempCabinC,
               chargerPilotA, chargerActualA, chargerPhases,
               chargerVoltage, chargerPower, timeToFullCharge
        FROM numbered
        WHERE rn % ${step} = 1 OR rn = ${totalPoints}
        ORDER BY recordedAt ASC
      `
    )
  }

  res.json({ ...session, telemetry, totalTelemetryPoints: totalPoints })
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
