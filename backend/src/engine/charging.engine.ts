import { EventEmitter } from 'events'
import { logger } from '../logger'
import { getConfig } from '../config'
import { prisma } from '../prisma'
import { getVehicleState, sendProxyCommand, requestWakeMode } from '../services/proxy.service'
import { getHaState } from '../services/ha.service'
import { isFailsafeActive } from '../services/failsafe.service'
import { notificationEvents, dispatchTelegramNotificationEvent } from '../services/notification-rules.service'
import { computeBalancingAction, shouldAdjustAmps, clampAmps } from './balancing'

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
let lastSetpointSentMs = 0
let sessionEnergyPriceEurPerKwh = 0
let planArmed = false

interface PersistedEngineRestoreState {
  restorePlan: boolean
  targetSoc?: number
  targetAmps?: number
}

async function persistEngineRestoreState(): Promise<void> {
  const payload: PersistedEngineRestoreState = planArmed
    ? {
        restorePlan: true,
        targetSoc: status.targetSoc,
        targetAmps: status.targetAmps,
      }
    : {
        restorePlan: false,
      }

  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: { engine_restore_state: JSON.stringify(payload) },
    create: { id: 1, engine_restore_state: JSON.stringify(payload) },
  })
}

export async function initializeEngineState(): Promise<void> {
  const persisted = await prisma.appConfig.findUnique({ where: { id: 1 } })
  if (!persisted?.engine_restore_state) {
    planArmed = false
    return
  }

  try {
    const parsed = JSON.parse(persisted.engine_restore_state) as PersistedEngineRestoreState
    if (!parsed.restorePlan) {
      planArmed = false
      return
    }

    const cfg = getConfig()
    const restoredTargetSoc = Number.isFinite(parsed.targetSoc) ? Math.max(1, Math.min(100, Number(parsed.targetSoc))) : status.targetSoc
    const restoredTargetAmps = Number.isFinite(parsed.targetAmps)
      ? Math.max(cfg.charging.minAmps, Math.min(cfg.charging.maxAmps, Number(parsed.targetAmps)))
      : cfg.charging.defaultAmps

    planArmed = true
    status = {
      ...status,
      running: false,
      mode: 'plan',
      sessionId: null,
      targetSoc: restoredTargetSoc,
      targetAmps: restoredTargetAmps,
      setpointAmps: restoredTargetAmps,
      currentAmps: 0,
      balancing: false,
      balancingStartedAt: null,
      phase: 'idle',
      message: 'Plan restored after restart',
      haThrottled: false,
      debugLog: [],
    }
  } catch {
    planArmed = false
    await persistEngineRestoreState()
  }
}

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
  planArmed = true
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
  persistEngineRestoreState().catch((err) => logger.error('Failed to persist engine restore state', { err }))
}

export async function startEngine(targetSoc: number, targetAmps?: number): Promise<void> {
  const cfg = getConfig()
  if (status.running) {
    logger.warn('Engine already running')
    pushEngineLog('start ignored: engine already running')
    return
  }

  await requestWakeMode(false)

  const requestedAmps = targetAmps ?? cfg.charging.maxAmps

  // Keep last 20 lines from previous session so charge_stop / session-end entries stay visible
  const prevSessionTail = status.debugLog.slice(-20)
  status = {
    ...status,
    running: true,
    mode: planArmed ? 'plan' : 'on',
    targetSoc,
    targetAmps: requestedAmps,
    setpointAmps: requestedAmps,
    phase: 'idle',
    message: planArmed ? 'Planned session started' : 'Engine started',
    debugLog: prevSessionTail.length > 0 ? [...prevSessionTail, '--- new session ---'] : [],
  }
  sessionEnergyPriceEurPerKwh = cfg.charging.energyPriceEurPerKwh
  haStoppedForLimit = false
  haResumeAfterMs = null
  lastChargeStartAttemptMs = 0
  lastRampUpMs = Date.now()

  const session = await prisma.chargingSession.create({
    data: {
      vehicleId: cfg.proxy.vehicleId,
      targetSoc,
      targetAmps: requestedAmps,
      energyPriceEurPerKwh: cfg.charging.energyPriceEurPerKwh,
    },
  })
  status.sessionId = session.id
  logger.info(`Charging session started`, { sessionId: session.id, targetSoc, targetAmps: requestedAmps })
  pushEngineLog(`session ${session.id} started: targetSoc=${targetSoc}% targetAmps=${requestedAmps}A`)
  engineEvents.emit('started', status)
  await persistEngineRestoreState().catch((err) => logger.error('Failed to persist engine restore state', { err }))
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

export async function stopEngine(options?: { forceOff?: boolean }): Promise<void> {
  const forceOff = options?.forceOff ?? false
  if (forceOff) {
    planArmed = false
  }
  const cfg = getConfig()
  const vid = getCommandVehicleId(cfg)
  const vState = getVehicleState()
  if (vid) {
    if (vState.connected) {
      await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
        logger.error('charge_stop failed during stopEngine', { err })
      )
      pushEngineLog('charge_stop sent by stopEngine')
    } else {
      logger.info('Skipping charge_stop: vehicle not connected (sleeping or unreachable)')
      pushEngineLog('charge_stop skipped: vehicle not connected')
    }
  }

  if (engineTimer) {
    clearInterval(engineTimer)
    engineTimer = null
  }
  if (status.sessionId) {
    const totalEnergyKwh = await getTotalEnergy(status.sessionId)
    const totalCostEur = Number((totalEnergyKwh * sessionEnergyPriceEurPerKwh).toFixed(4))
    await prisma.chargingSession.update({
      where: { id: status.sessionId },
      data: {
        endedAt: new Date(),
        totalEnergyKwh,
        totalCostEur,
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
    mode: planArmed ? 'plan' : 'off',
    sessionId: null,
    phase: 'idle',
    message: planArmed ? 'Plan armed — waiting for scheduled start' : 'Engine stopped',
    balancing: false,
    balancingStartedAt: null,
    haThrottled: false,
    setpointAmps: status.targetAmps,
  }
  haStoppedForLimit = false
  haResumeAfterMs = null
  lastChargeStartAttemptMs = 0
  lastRampUpMs = 0
  lastSetpointSentMs = 0
  sessionEnergyPriceEurPerKwh = 0
  await persistEngineRestoreState().catch((err) => logger.error('Failed to persist engine restore state', { err }))
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

    const haThrottleAmps = computeHaAllowedAmps(cfg, vState)

    // If HA is offline, reset all HA throttle state and continue charging normally
    if (haThrottleAmps === null) {
      if (haStoppedForLimit || status.haThrottled) {
        logger.info('HA offline detected: resuming charging (HA state reset)')
        pushEngineLog('HA offline: throttle state cleared, charging resumes')
      }
      haStoppedForLimit = false
      haResumeAfterMs = null
      status.haThrottled = false
      // Continue with normal charging logic below
    }

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
        // SendProxyCommand only once when first hitting the hard limit
        if (!haStoppedForLimit) {
          const vid = getCommandVehicleId(cfg)
          if (vid) {
            await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
              logger.error('HA stop charge_stop failed', { err })
            )
            pushEngineLog('HA hard limit: charge_stop sent')
          }
          haStoppedForLimit = true
        }
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
      actualAmps: status.currentAmps,
      balancingState: { balancing: status.balancing, balancingStartedAt: status.balancingStartedAt },
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
          const retryMs = cfg.charging.chargeStartRetryMs
          const retryAllowed = vState.pluggedIn && (now - lastChargeStartAttemptMs >= retryMs)

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
            const nextInMs = Math.max(0, retryMs - (now - lastChargeStartAttemptMs))
            status.phase = 'paused'
            status.message = `Not charging (state: ${vState.chargingState}), retry in ${Math.ceil(nextInMs / 1000)}s`
            pushEngineLog(`paused: vehicle state=${vState.chargingState}, next charge_start retry in ${Math.ceil(nextInMs / 1000)}s`)
          }
        }
        break

      case 'balancing_in_progress':
        status.message = action.message
        pushEngineLog(`balancing: ${action.message}`)
        break

      case 'stop_charging':
        logger.info(action.reason)
        pushEngineLog(`stop requested: ${action.reason}`)
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
  const chargerPowerW = haS.chargerW ?? ((vState.chargeRateKw ?? 0) * 1000)
  const houseOnlyW = haS.powerW - chargerPowerW
  const availableW = cfg.homeAssistant.maxHomePowerW - houseOnlyW
  const voltage = vState.chargerVoltage ?? 230
  pushEngineLog(`HA window: homeTotal=${haS.powerW ?? 0}W charger=${Math.round(chargerPowerW)}W homeWithoutCharger=${Math.round(houseOnlyW)}W available=${Math.round(availableW)}W voltage=${voltage}V`)
  return Math.floor(availableW / voltage)
}

async function adjustAmps(cfg: ReturnType<typeof getConfig>): Promise<void> {
  const vid = getCommandVehicleId(cfg)
  if (!vid) return
  const vState = getVehicleState()
  const haS = getHaState()
  const now = Date.now()
  const rampIntervalMs = (cfg.charging.rampIntervalSec ?? 10) * 1000
  const haAllowed = computeHaAllowedAmps(cfg, vState)
  const maxPossible = haAllowed !== null
    ? Math.min(status.targetAmps, haAllowed, cfg.charging.maxAmps)
    : Math.min(status.targetAmps, cfg.charging.maxAmps)

  const DEFAULT_VEHICLE_VOLTAGE_V = 230
  const homeTotalPowerW = (haS.connected && haS.powerW !== null) ? haS.powerW : null
  const chargerPowerW = haS.chargerW ?? ((vState.chargeRateKw ?? 0) * 1000)
  const vehicleVoltageV = vState.chargerVoltage ?? DEFAULT_VEHICLE_VOLTAGE_V

  let desired = status.setpointAmps

  if (desired > maxPossible) {
    desired = maxPossible
    lastRampUpMs = now
  } else if (homeTotalPowerW !== null && now - lastRampUpMs >= rampIntervalMs) {
    // Only ramp if the vehicle has had time to respond to the last setpoint change
    const settleMs = Math.max(rampIntervalMs, 3000)
    if (now - lastSetpointSentMs >= settleMs) {
      const residualPowerW = homeTotalPowerW - chargerPowerW
      const deltaAmps = residualPowerW / vehicleVoltageV
      const actualAmps = vState.chargerActualCurrent ?? 0
      desired = Math.round(actualAmps + deltaAmps)
      lastRampUpMs = now
      pushEngineLog(`ramp: homeTotalPowerW=${homeTotalPowerW}W chargerPowerW=${Math.round(chargerPowerW)}W residualPowerW=${Math.round(residualPowerW)}W deltaAmps=${deltaAmps.toFixed(2)} candidate=${desired}A`)
    } else {
      pushEngineLog(`ramp skipped: waiting settle (${Math.ceil((settleMs - (now - lastSetpointSentMs)) / 1000)}s)`)
    }
  }

  desired = clampAmps(desired, cfg.charging.minAmps, cfg.charging.maxAmps)

  // Only send set_charging_amps when the intended setpoint actually changes — prevents oscillation
  if (desired !== status.setpointAmps) {
      const previousSetpoint = status.setpointAmps
      status.setpointAmps = desired
      try {
        await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: desired })
        lastSetpointSentMs = now
        logger.debug(`Adjusted charging amps to ${desired}A`)
        pushEngineLog(`setpoint changed: ${previousSetpoint}A -> ${desired}A`)
    } catch (err) {
      logger.error('Failed to adjust charging amps', { err })
      pushEngineLog(`setpoint command failed: desired=${desired}A`)
    }
  } else {
    pushEngineLog(`setpoint stable: ${desired}A`)
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
