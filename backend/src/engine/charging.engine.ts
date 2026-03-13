import { PrismaClient } from '@prisma/client'
import { EventEmitter } from 'events'
import { logger } from '../logger'
import { getConfig } from '../config'
import { getVehicleState, sendProxyCommand } from '../services/proxy.service'
import { getHaState } from '../services/ha.service'
import { isFailsafeActive } from '../services/failsafe.service'
import { notificationEvents, dispatchTelegramNotificationEvent } from '../services/notification-rules.service'
import { computeBalancingAction, shouldAdjustAmps, clampAmps } from './balancing'

const prisma = new PrismaClient()

export const engineEvents = new EventEmitter()

export interface EngineStatus {
  running: boolean
  mode: 'off' | 'plan' | 'on'
  sessionId: number | null
  targetSoc: number
  targetAmps: number
  setpointAmps: number
  currentAmps: number
  balancing: boolean
  balancingStartedAt: Date | null
  phase: 'idle' | 'charging' | 'balancing' | 'complete' | 'paused'
  message: string
  haThrottled: boolean
  debugLog: string[]
}

let status: EngineStatus = {
  running: false,
  mode: 'off',
  sessionId: null,
  targetSoc: 80,
  targetAmps: 16,
  setpointAmps: 16,
  currentAmps: 0,
  balancing: false,
  balancingStartedAt: null,
  phase: 'idle',
  message: 'Engine idle',
  haThrottled: false,
  debugLog: [],
}

let engineTimer: NodeJS.Timeout | null = null
let engineLock = false
let haStoppedForLimit = false
let haResumeAfterMs: number | null = null
let lastChargeStartAttemptMs = 0
let lastRampUpMs = 0

const CHARGE_START_RETRY_MS = 10000

function getCommandVehicleId(cfg: ReturnType<typeof getConfig>): string {
  if (cfg.proxy.vehicleId) return cfg.proxy.vehicleId
  if (cfg.demo) return 'demo'
  return ''
}

function pushEngineLog(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`
  status.debugLog = [...status.debugLog.slice(-119), line]
}

export function getEngineStatus(): EngineStatus {
  return { ...status }
}

export function setPlanMode(targetSoc: number): void {
  status = {
    ...status,
    running: false,
    mode: 'plan',
    targetSoc,
    phase: 'idle',
    message: 'Charge planned — waiting for scheduled start',
    debugLog: [],
  }
  engineEvents.emit('mode_changed', status)
}

export async function startEngine(targetSoc: number, targetAmps?: number): Promise<void> {
  const cfg = getConfig()
  if (status.running) {
    logger.warn('Engine already running')
    pushEngineLog('start ignored: engine already running')
    return
  }

  // If no explicit target is provided, use max amps and let HA/failsafe/balancing shape runtime setpoint.
  const requestedAmps = targetAmps ?? cfg.charging.maxAmps

  status = {
    ...status,
    running: true,
    mode: 'on',
    targetSoc,
    targetAmps: requestedAmps,
    setpointAmps: requestedAmps,
    phase: 'idle',
    message: 'Engine started',
    debugLog: [],
  }
  haStoppedForLimit = false
  haResumeAfterMs = null
  lastChargeStartAttemptMs = 0
  lastRampUpMs = Date.now()

  const session = await prisma.chargingSession.create({
    data: {
      vehicleId: cfg.proxy.vehicleId,
      targetSoc,
      targetAmps: requestedAmps,
    },
  })
  status.sessionId = session.id
  logger.info(`Charging session started`, { sessionId: session.id, targetSoc, targetAmps: requestedAmps })
  pushEngineLog(`session ${session.id} started: targetSoc=${targetSoc}% targetAmps=${requestedAmps}A`)
  engineEvents.emit('started', status)
  dispatchTelegramNotificationEvent('start_charging', { reason: 'user_or_scheduler' }).catch(() => {})
  dispatchTelegramNotificationEvent(
    'engine_started',
    {
      targetSoc,
      targetAmps: requestedAmps,
      vehicleId: cfg.proxy.vehicleId,
      sessionId: session.id,
    }
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
    pushEngineLog(`session ${status.sessionId} ended`)
    dispatchTelegramNotificationEvent('stop_charging', { reason: 'user_or_scheduler' }).catch(() => {})
    dispatchTelegramNotificationEvent('engine_stopped', { sessionId: status.sessionId }).catch(() => {})
  }
  status = {
    ...status,
    running: false,
    mode: 'off',
    sessionId: null,
    phase: 'idle',
    message: 'Engine stopped',
    balancing: false,
    balancingStartedAt: null,
    haThrottled: false,
    setpointAmps: status.targetAmps,
  }
  haStoppedForLimit = false
  haResumeAfterMs = null
  lastChargeStartAttemptMs = 0
  lastRampUpMs = 0
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
    pushEngineLog('tick skipped: previous tick still running')
    return
  }
  engineLock = true
  try {
    if (isFailsafeActive()) {
      await stopEngine()
      status.message = 'Stopped due to failsafe'
      pushEngineLog('stopped by failsafe')
      return
    }

    const vState = getVehicleState()
    if (!vState.connected) {
      status.phase = 'paused'
      status.message = 'Vehicle not connected'
      pushEngineLog('paused: vehicle not connected')
      return
    }

    const cfg = getConfig()
    const soc = vState.stateOfCharge ?? 0
    const actualAmps = vState.chargerActualCurrent ?? 0

    await recordTelemetry(vState)

    status.currentAmps = actualAmps
    pushEngineLog(`tick: soc=${soc}% actual=${actualAmps}A state=${vState.chargingState ?? 'unknown'} home=${getHaState().powerW ?? 0}W`)

    // HA LIMITS ALWAYS WIN
    const haThrottleAmps = computeHaAllowedAmps(cfg, vState)

    // If previously stopped by HA limit, wait X seconds then auto-resume when margin is available.
    if (haStoppedForLimit) {
      const nowMs = Date.now()
      const resumeDelayMs = Math.max(0, cfg.homeAssistant.resumeDelaySec) * 1000
      const waitUntil = haResumeAfterMs ?? (nowMs + resumeDelayMs)
      haResumeAfterMs = waitUntil

      if (nowMs < waitUntil) {
        const remaining = Math.ceil((waitUntil - nowMs) / 1000)
        status.phase = 'paused'
        status.message = `Paused by HA limit, retry in ${remaining}s`
        status.setpointAmps = 0
        pushEngineLog(`HA cooldown active: ${remaining}s before restart attempt`)
        engineEvents.emit('tick', status)
        return
      }

      if (haThrottleAmps === null || haThrottleAmps < cfg.charging.minAmps) {
        status.phase = 'paused'
        status.message = 'Paused by HA limit, waiting power margin'
        status.setpointAmps = 0
        pushEngineLog(`HA restart blocked: allowed=${haThrottleAmps ?? 'n/a'}A min=${cfg.charging.minAmps}A`)
        engineEvents.emit('tick', status)
        return
      }

      const vid = getCommandVehicleId(cfg)
      if (vid) {
        await sendProxyCommand(vid, 'charge_start', {}).catch((err) =>
          logger.error('HA resume charge_start failed', { err })
        )
        pushEngineLog('HA resume: charge_start sent')
      }

      haStoppedForLimit = false
      haResumeAfterMs = null
      status.haThrottled = false
      status.message = 'Charging resumed after HA cooldown'
      dispatchTelegramNotificationEvent('home_power_limit_restored', {
        homePowerW: getHaState().powerW ?? 0,
        limitW: cfg.homeAssistant.maxHomePowerW,
      }).catch(() => {})
      dispatchTelegramNotificationEvent('charging_resumed', { reason: 'ha_cooldown_passed' }).catch(() => {})
    }

    if (haThrottleAmps !== null) {
      if (haThrottleAmps < cfg.charging.minAmps) {
        const vid = getCommandVehicleId(cfg)
        if (vid) {
          await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
            logger.error('HA stop charge_stop failed', { err })
          )
          pushEngineLog('HA hard limit: charge_stop sent')
        }
        haStoppedForLimit = true
        haResumeAfterMs = Date.now() + Math.max(0, cfg.homeAssistant.resumeDelaySec) * 1000
        if (!status.haThrottled) {
          status.haThrottled = true
          const haS = getHaState()
          logger.warn(`HA pause: home power ${haS.powerW}W exceeds limit ${cfg.homeAssistant.maxHomePowerW}W`)
          pushEngineLog(`HA pause: home=${haS.powerW ?? 0}W limit=${cfg.homeAssistant.maxHomePowerW}W`)
          dispatchTelegramNotificationEvent('home_power_limit_exceeded', {
            homePowerW: haS.powerW ?? 0,
            limitW: cfg.homeAssistant.maxHomePowerW,
          }).catch(() => {})
          dispatchTelegramNotificationEvent('charging_paused', { reason: 'ha_power_limit' }).catch(() => {})
          dispatchTelegramNotificationEvent(
            'ha_paused',
            {
              homePowerW: haS.powerW ?? 0,
              maxHomePowerW: cfg.homeAssistant.maxHomePowerW,
              retrySec: cfg.homeAssistant.resumeDelaySec,
            }
          ).catch(() => {})
        }
        status.phase = 'paused'
        status.message = `Paused by HA: home power ${getHaState().powerW?.toFixed(0)}W, retry in ${cfg.homeAssistant.resumeDelaySec}s`
        status.setpointAmps = 0
        engineEvents.emit('tick', status)
        return
      }
      if (haThrottleAmps < status.targetAmps) {
        const vid = cfg.proxy.vehicleId
        if (vid) {
          const throttled = clampAmps(haThrottleAmps, cfg.charging.minAmps, status.targetAmps)
          status.setpointAmps = throttled
          if (shouldAdjustAmps(throttled, actualAmps, 1)) {
            await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: throttled }).catch((err) =>
              logger.error('HA throttle set_charging_amps failed', { err })
            )
            logger.info(`HA throttle: set charging to ${throttled}A (home power ${getHaState().powerW?.toFixed(0)}W)`)
            pushEngineLog(`HA throttle setpoint=${throttled}A (actual=${actualAmps}A)`) 
            if (!status.haThrottled) {
              status.haThrottled = true
              dispatchTelegramNotificationEvent(
                'ha_throttled',
                {
                  throttledAmps: throttled,
                  homePowerW: getHaState().powerW ?? 0,
                  maxHomePowerW: cfg.homeAssistant.maxHomePowerW,
                }
              ).catch(() => {})
            }
          }
        }
      } else if (status.haThrottled) {
        status.haThrottled = false
        pushEngineLog('HA throttle cleared')
      }
    } else if (status.haThrottled) {
      status.haThrottled = false
      pushEngineLog('HA throttle cleared (HA unavailable)')
    }

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
          lastChargeStartAttemptMs = 0
          status.phase = 'charging'
          status.message = `Charging ${actualAmps}A (setpoint ${status.setpointAmps}A), SoC: ${soc}%${status.haThrottled ? ' (HA throttled)' : ''}`
          await adjustAmps(cfg)
        } else {
          const now = Date.now()
          const retryAllowed = vState.pluggedIn && (now - lastChargeStartAttemptMs >= CHARGE_START_RETRY_MS)

          if (retryAllowed) {
            const vid = getCommandVehicleId(cfg)
            if (vid) {
              await sendProxyCommand(vid, 'charge_start', {}).catch((err) =>
                logger.error('charge_start failed', { err })
              )
              lastChargeStartAttemptMs = now
              status.phase = 'paused'
              status.message = 'Sent charge_start, waiting vehicle state update'
              pushEngineLog('vehicle connected but not charging: charge_start sent')
            } else {
              status.phase = 'paused'
              status.message = 'Vehicle ID not configured'
              pushEngineLog('cannot send charge_start: no vehicleId configured')
            }
          } else {
            const nextInMs = Math.max(0, CHARGE_START_RETRY_MS - (now - lastChargeStartAttemptMs))
            status.phase = 'paused'
            status.message = `Not charging (state: ${vState.chargingState}), retry in ${Math.ceil(nextInMs / 1000)}s`
            pushEngineLog(`paused: vehicle state=${vState.chargingState}, next charge_start retry in ${Math.ceil(nextInMs / 1000)}s`)
          }
        }
        break

      case 'start_balancing':
        status.balancing = true
        status.balancingStartedAt = new Date()
        status.phase = 'balancing'
        status.message = 'Cell balancing in progress (100% hold)'
        logger.info('Cell balancing phase started - holding at 100%')
        pushEngineLog('balancing started')
        dispatchTelegramNotificationEvent('balancing_started', { targetSoc: status.targetSoc }).catch(() => {})
        break

      case 'balancing_in_progress':
        status.message = action.message
        pushEngineLog(`balancing: ${action.message}`)
        break

      case 'stop_charging':
        logger.info(action.reason)
        pushEngineLog(`stop requested: ${action.reason}`)
        if (action.reason.includes('balancing complete')) {
          dispatchTelegramNotificationEvent('balancing_complete', { reason: action.reason }).catch(() => {})
        }
        await stopEngine()
        return
    }

    engineEvents.emit('tick', status)
  } finally {
    engineLock = false
  }
}

function computeHaAllowedAmps(
  cfg: ReturnType<typeof getConfig>,
  vState: ReturnType<typeof getVehicleState>
): number | null {
  const haS = getHaState()
  if (!haS.connected || haS.powerW === null || cfg.homeAssistant.maxHomePowerW <= 0) return null
  const carChargeW = (vState.chargeRateKw ?? 0) * 1000
  const houseOnlyW = haS.powerW - carChargeW
  const availableW = cfg.homeAssistant.maxHomePowerW - houseOnlyW
  const voltage = vState.chargerVoltage ?? 230
  pushEngineLog(`HA window: home=${haS.powerW ?? 0}W houseOnly=${Math.round(houseOnlyW)}W available=${Math.round(availableW)}W voltage=${voltage}V`)
  return Math.floor(availableW / voltage)
}

async function adjustAmps(cfg: ReturnType<typeof getConfig>): Promise<void> {
  const vid = getCommandVehicleId(cfg)
  if (!vid) return
  const vState = getVehicleState()
  const haAllowed = computeHaAllowedAmps(cfg, vState)
  
  // F-19 & F-22: Ramp Up Logic (configurable interval)
  const now = Date.now()
  const rampIntervalMs = (cfg.charging.rampIntervalSec ?? 10) * 1000
  const maxPossible = haAllowed !== null ? Math.min(status.targetAmps, haAllowed, cfg.charging.maxAmps) : Math.min(status.targetAmps, cfg.charging.maxAmps)
  
  let desired = status.setpointAmps

  if (desired > maxPossible) {
    // Immediate throttle (safety first)
    desired = maxPossible
    lastRampUpMs = now // Reset ramp timer on throttle
  } else if (desired < maxPossible) {
    // Try to ramp up
    if (now - lastRampUpMs >= rampIntervalMs) {
      desired = Math.min(desired + 1, maxPossible)
      lastRampUpMs = now
      if (desired < maxPossible) {
        pushEngineLog(`ramping up: ${desired}A (target ${maxPossible}A)`)
      }
    }
  } else {
    lastRampUpMs = now // Stable, keep timer fresh
  }

  desired = clampAmps(desired, cfg.charging.minAmps, cfg.charging.maxAmps)
  status.setpointAmps = desired
  const actual = vState.chargerActualCurrent ?? 0
  
  if (shouldAdjustAmps(desired, actual, 1)) {
    try {
      await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: desired })
      logger.debug(`Adjusted charging amps to ${desired}A`)
      pushEngineLog(`setpoint changed: ${actual}A -> ${desired}A`) 
    } catch (err) {
      logger.error('Failed to adjust charging amps', { err })
      pushEngineLog(`setpoint command failed: desired=${desired}A`) 
    }
  } else {
    pushEngineLog(`setpoint unchanged: desired=${desired}A actual=${actual}A`) 
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
