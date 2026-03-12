import { PrismaClient } from '@prisma/client'
import { EventEmitter } from 'events'
import { logger } from '../logger'
import { getConfig } from '../config'
import { getVehicleState, sendProxyCommand } from '../services/proxy.service'
import { isFailsafeActive } from '../services/failsafe.service'
import { sendTelegramNotification } from '../services/telegram.service'
import { computeBalancingAction, shouldAdjustAmps } from './balancing'

const prisma = new PrismaClient()

export const engineEvents = new EventEmitter()

export interface EngineStatus {
  running: boolean
  sessionId: number | null
  targetSoc: number
  targetAmps: number
  currentAmps: number
  balancing: boolean
  balancingStartedAt: Date | null
  phase: 'idle' | 'charging' | 'balancing' | 'complete' | 'paused'
  message: string
}

let status: EngineStatus = {
  running: false,
  sessionId: null,
  targetSoc: 80,
  targetAmps: 16,
  currentAmps: 0,
  balancing: false,
  balancingStartedAt: null,
  phase: 'idle',
  message: 'Engine idle',
}

let engineTimer: NodeJS.Timeout | null = null
let engineLock = false

export function getEngineStatus(): EngineStatus {
  return { ...status }
}

export async function startEngine(targetSoc: number, targetAmps?: number): Promise<void> {
  const cfg = getConfig()
  if (status.running) {
    logger.warn('Engine already running')
    return
  }
  status = {
    ...status,
    running: true,
    targetSoc,
    targetAmps: targetAmps ?? cfg.charging.defaultAmps,
    phase: 'idle',
    message: 'Engine started',
  }

  const session = await prisma.chargingSession.create({
    data: {
      vehicleId: cfg.proxy.vehicleId,
      targetSoc,
      targetAmps: targetAmps ?? cfg.charging.defaultAmps,
    },
  })
  status.sessionId = session.id
  logger.info(`Charging session started`, { sessionId: session.id, targetSoc, targetAmps })
  engineEvents.emit('started', status)
  sendTelegramNotification(
    `⚡ Charging started\nTarget: ${targetSoc}%\nAmps: ${targetAmps ?? cfg.charging.defaultAmps}A`
  ).catch(() => {})

  engineTimer = setInterval(() => {
    runEngineStep().catch((err) => logger.error('Engine step error', { err }))
  }, 1000)
}

export async function stopEngine(): Promise<void> {
  if (engineTimer) {
    clearInterval(engineTimer)
    engineTimer = null
  }
  if (status.sessionId) {
    await prisma.chargingSession.update({
      where: { id: status.sessionId },
      data: {
        endedAt: new Date(),
        totalEnergyKwh: await getTotalEnergy(status.sessionId),
      },
    })
    logger.info(`Charging session ended`, { sessionId: status.sessionId })
    sendTelegramNotification(`🛑 Charging stopped`).catch(() => {})
  }
  status = {
    ...status,
    running: false,
    sessionId: null,
    phase: 'idle',
    message: 'Engine stopped',
    balancing: false,
    balancingStartedAt: null,
  }
  engineEvents.emit('stopped', status)
}

async function getTotalEnergy(sessionId: number): Promise<number> {
  const result = await prisma.chargingTelemetry.aggregate({
    where: { sessionId },
    _sum: { energyKwh: true },
  })
  return result._sum.energyKwh ?? 0
}

async function runEngineStep(): Promise<void> {
  if (engineLock) {
    logger.debug('Engine step skipped - previous step still running')
    return
  }
  engineLock = true
  try {
    if (isFailsafeActive()) {
      await stopEngine()
      status.message = 'Stopped due to failsafe'
      return
    }

    const vState = getVehicleState()
    if (!vState.connected) {
      status.phase = 'paused'
      status.message = 'Vehicle not connected'
      return
    }

    const cfg = getConfig()
    const soc = vState.stateOfCharge ?? 0
    const actualAmps = vState.chargerActualCurrent ?? 0

    await recordTelemetry(vState)

    status.currentAmps = actualAmps

    const action = computeBalancingAction({
      soc,
      targetSoc: status.targetSoc,
      actualAmps,
      balancingState: { balancing: status.balancing, balancingStartedAt: status.balancingStartedAt },
      holdMinutes: cfg.charging.balancingHoldMinutes,
      nowMs: Date.now(),
    })

    switch (action.type) {
      case 'continue_charging':
        if (vState.charging) {
          status.phase = 'charging'
          status.message = `Charging at ${actualAmps}A, SoC: ${soc}%`
          await adjustAmps(cfg)
        } else {
          status.phase = 'paused'
          status.message = `Not charging (state: ${vState.chargingState})`
        }
        break

      case 'start_balancing':
        status.balancing = true
        status.balancingStartedAt = new Date()
        status.phase = 'balancing'
        status.message = 'Cell balancing in progress (100% hold)'
        logger.info('Cell balancing phase started - holding at 100%')
        sendTelegramNotification('🔋 Cell balancing in progress').catch(() => {})
        break

      case 'balancing_in_progress':
        status.message = action.message
        break

      case 'stop_charging':
        logger.info(action.reason)
        if (action.reason.includes('balancing complete')) {
          sendTelegramNotification('✅ Cell balancing complete').catch(() => {})
        }
        await stopEngine()
        return
    }

    engineEvents.emit('tick', status)
  } finally {
    engineLock = false
  }
}

async function adjustAmps(cfg: ReturnType<typeof getConfig>): Promise<void> {
  const vid = cfg.proxy.vehicleId
  if (!vid) return
  const desired = Math.min(status.targetAmps, cfg.charging.maxAmps)
  const actual = getVehicleState().chargerActualCurrent ?? 0
  if (shouldAdjustAmps(desired, actual)) {
    try {
      await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: desired })
      logger.debug(`Adjusted charging amps to ${desired}A`)
    } catch (err) {
      logger.error('Failed to adjust charging amps', { err })
    }
  }
}

async function recordTelemetry(vState: ReturnType<typeof getVehicleState>): Promise<void> {
  if (!status.sessionId) return
  try {
    await prisma.chargingTelemetry.create({
      data: {
        sessionId: status.sessionId,
        voltageV: vState.chargerVoltage,
        currentA: vState.chargerActualCurrent,
        powerW: vState.chargeRateKw ? vState.chargeRateKw * 1000 : null,
        energyKwh: vState.chargeRateKw ? vState.chargeRateKw / 3600 : null,
        stateOfCharge: vState.stateOfCharge,
        tempCabinC: vState.insideTempC,
        chargerPilotA: vState.chargerPilotCurrent,
        chargerActualA: vState.chargerActualCurrent,
        chargerPhases: vState.chargerPhases,
        chargerVoltage: vState.chargerVoltage,
        chargerPower: vState.chargeRateKw,
        timeToFullCharge: vState.timeToFullChargeH,
      },
    })
  } catch (err) {
    logger.error('Failed to record telemetry', { err })
  }
}
