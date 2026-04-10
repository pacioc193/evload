import { EventEmitter } from 'events'
import { logger } from '../logger'
import { getConfig } from '../config'
import { prisma } from '../prisma'
import { getVehicleState, sendProxyCommand, requestWakeMode, vehicleEvents, proxyEvents } from '../services/proxy.service'
import { getHaState } from '../services/ha.service'
import { isFailsafeActive, getFailsafeType } from '../services/failsafe.service'
import { notificationEvents, dispatchTelegramNotificationEvent } from '../services/notification-rules.service'
import { computeBalancingAction, shouldAdjustAmps, clampAmps } from './balancing'

export const engineEvents = new EventEmitter()

export interface EngineStatus {
  running: boolean
  mode: 'off' | 'plan' | 'on'
  sessionId: number | null
  /** ISO timestamp of when the current charging session started, null when no session is active. */
  sessionStartedAt: string | null
  targetSoc: number
  targetAmps: number
  setpointAmps: number
  currentAmps: number
  balancing: boolean
  balancingStartedAt: Date | null
  phase: 'idle' | 'charging' | 'balancing' | 'complete' | 'paused'
  message: string
  chargeStartBlocked: boolean
  chargeStartBlockReason: string | null
  haThrottled: boolean
  accumulatedSessionEnergyKwh: number
  vehicleBatteryEnergyKwh: number
  vehicleBatteryEnergyRawKwh: number
  chargingEfficiencyPct: number | null
  debugLog: string[]
}

let status: EngineStatus = {
  running: false,
  mode: 'off',
  sessionId: null,
  sessionStartedAt: null,
  targetSoc: 80,
  targetAmps: 16,
  setpointAmps: 16,
  currentAmps: 0,
  balancing: false,
  balancingStartedAt: null,
  phase: 'idle',
  message: 'Engine idle',
  chargeStartBlocked: false,
  chargeStartBlockReason: null,
  haThrottled: false,
  accumulatedSessionEnergyKwh: 0,
  vehicleBatteryEnergyKwh: 0,
  vehicleBatteryEnergyRawKwh: 0,
  chargingEfficiencyPct: null,
  debugLog: [],
}

let engineTimer: NodeJS.Timeout | null = null
let engineLock = false
let haStoppedForLimit = false
let haResumeAfterMs: number | null = null
let lastChargeStartAttemptMs = 0
let lastRampUpMs = 0
let lastSetpointSentMs = 0
let lastSetpointResyncAttemptMs = 0
let sessionEnergyPriceEurPerKwh = 0
let planArmed = false
let lastEnergySampleAtMs: number | null = null
let lastEngineHealthSnapshotAtMs = 0
let vehicleBatteryEnergyBaselineKwh: number | null = null
let chargeStartBlockedNotified = false
let pendingForceStopVehicleId: string | null = null
let pendingForceStopRetries = 0
let pendingForceStopTimer: NodeJS.Timeout | null = null

const FORCE_STOP_RETRY_MS = 15000
const FORCE_STOP_MAX_RETRIES = 20

/**
 * Suspended state saved when a soft failsafe (proxy disconnect) pauses an active charge session.
 * On proxy reconnect the engine uses this to automatically resume the session.
 */
interface SuspendedChargeState {
  targetSoc: number
  targetAmps: number
  reason: 'proxy_lost'
}
let suspendedState: SuspendedChargeState | null = null

interface PersistedEngineRestoreState {
  restorePlan: boolean
  targetSoc?: number
  targetAmps?: number
}

const DEFAULT_TARGET_SOC = 80

function clampTargetSoc(value: number, fallback = DEFAULT_TARGET_SOC): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(100, Math.round(value)))
}

let persistedTargetSoc = DEFAULT_TARGET_SOC

async function persistEngineRestoreState(): Promise<void> {
  const payload: PersistedEngineRestoreState = planArmed
    ? {
        restorePlan: true,
        targetSoc: status.targetSoc,
        targetAmps: status.targetAmps,
      }
    : {
        restorePlan: false,
        targetSoc: persistedTargetSoc,
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
    persistedTargetSoc = DEFAULT_TARGET_SOC
    status = {
      ...status,
      targetSoc: DEFAULT_TARGET_SOC,
    }
    return
  }

  try {
    const parsed = JSON.parse(persisted.engine_restore_state) as PersistedEngineRestoreState
    persistedTargetSoc = clampTargetSoc(Number(parsed.targetSoc ?? DEFAULT_TARGET_SOC))

    if (!parsed.restorePlan) {
      planArmed = false
      status = {
        ...status,
        running: false,
        mode: 'off',
        targetSoc: persistedTargetSoc,
      }
      return
    }

    const cfg = getConfig()
    const restoredTargetSoc = Number.isFinite(parsed.targetSoc)
      ? clampTargetSoc(Number(parsed.targetSoc), persistedTargetSoc)
      : persistedTargetSoc
    const restoredTargetAmps = Number.isFinite(parsed.targetAmps)
      ? Math.max(cfg.charging.minAmps, Math.min(cfg.charging.maxAmps, Number(parsed.targetAmps)))
      : cfg.charging.defaultAmps

    planArmed = true
    status = {
      ...status,
      running: false,
      mode: 'plan',
      sessionId: null,
      sessionStartedAt: null,
      targetSoc: restoredTargetSoc,
      targetAmps: restoredTargetAmps,
      setpointAmps: restoredTargetAmps,
      currentAmps: 0,
      balancing: false,
      balancingStartedAt: null,
      phase: 'idle',
      message: 'Plan restored after restart',
      chargeStartBlocked: false,
      chargeStartBlockReason: null,
      haThrottled: false,
      accumulatedSessionEnergyKwh: 0,
      vehicleBatteryEnergyKwh: 0,
      chargingEfficiencyPct: null,
      debugLog: [],
    }
  } catch {
    planArmed = false
    persistedTargetSoc = DEFAULT_TARGET_SOC
    status = {
      ...status,
      running: false,
      mode: 'off',
      targetSoc: persistedTargetSoc,
    }
    await persistEngineRestoreState()
  }
}

function getCommandVehicleId(cfg: ReturnType<typeof getConfig>): string {
  if (cfg.proxy.vehicleId) return cfg.proxy.vehicleId
  if (cfg.demo) return 'demo'
  return ''
}

function resolveChargeStartBlockReason(vState: ReturnType<typeof getVehicleState>): string | null {
  const chargingState = String(vState.chargingState ?? '').toLowerCase()
  const reason = String(vState.reason ?? '').toLowerCase()

  if (!vState.connected) return 'Vehicle not connected to proxy'
  if (!vState.pluggedIn) return 'Charge cable not connected'
  if (chargingState.includes('disconnected')) return 'Vehicle charging state is disconnected'
  if (reason.includes('disconnected') || reason.includes('not in range')) return 'Vehicle reports disconnected while starting charge'
  return null
}

function pushEngineLog(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`
  status.debugLog = [...status.debugLog.slice(-119), line]
}

function setEnginePhase(nextPhase: EngineStatus['phase'], reason: string): void {
  const previous = status.phase
  status.phase = nextPhase
  if (previous !== nextPhase) {
    logger.info('ENGINE_PHASE_TRANSITION', {
      sessionId: status.sessionId,
      from: previous,
      to: nextPhase,
      reason,
      running: status.running,
      mode: status.mode,
    })
    pushEngineLog(`phase: ${previous} -> ${nextPhase} (${reason})`)
  }
}

function emitEngineHealthSnapshot(vState: ReturnType<typeof getVehicleState>, meterPowerW: number): void {
  const now = Date.now()
  if (lastEngineHealthSnapshotAtMs !== 0 && now - lastEngineHealthSnapshotAtMs < 30000) {
    return
  }
  lastEngineHealthSnapshotAtMs = now
  logger.info('ENGINE_HEALTH_SNAPSHOT', {
    sessionId: status.sessionId,
    phase: status.phase,
    mode: status.mode,
    soc: vState.stateOfCharge,
    chargingState: vState.chargingState,
    pluggedIn: vState.pluggedIn,
    connected: vState.connected,
    actualAmps: vState.chargerActualCurrent,
    setpointAmps: status.setpointAmps,
    targetAmps: status.targetAmps,
    meterPowerW,
    accumulatedSessionEnergyKwh: status.accumulatedSessionEnergyKwh,
    vehicleBatteryEnergyKwh: status.vehicleBatteryEnergyKwh,
    chargingEfficiencyPct: status.chargingEfficiencyPct,
    haConnected: getHaState().connected,
    haPowerW: getHaState().powerW,
    haChargerW: getHaState().chargerW,
    haThrottled: status.haThrottled,
    haStoppedForLimit,
    failsafeActive: isFailsafeActive(),
  })
}

export function getEngineStatus(): EngineStatus {
  return { ...status }
}

function clearPendingForceStop(): void {
  if (pendingForceStopTimer) {
    clearTimeout(pendingForceStopTimer)
    pendingForceStopTimer = null
  }
  pendingForceStopVehicleId = null
  pendingForceStopRetries = 0
}

async function trySendChargeStop(vehicleId: string, reason: 'user_requested_stop' | 'engine_stop' | 'force_stop_retry', sessionId: number | null): Promise<boolean> {
  const vState = getVehicleState()
  logger.info('🛑 [CHARGE_STOP] Sending charge_stop command to vehicle', {
    vehicleId,
    reason,
    sessionId,
    currentSoc: vState.stateOfCharge,
    currentAmps: vState.chargerActualCurrent,
    chargingState: vState.chargingState,
    vehicleConnected: vState.connected,
  })
  try {
    await sendProxyCommand(vehicleId, 'charge_stop', {})
    pushEngineLog(`charge_stop sent: reason=${reason}`)
    return true
  } catch (err) {
    logger.error('🚨 [CHARGE_STOP] charge_stop command failed', {
      err,
      vehicleId,
      sessionId,
      reason,
    })
    pushEngineLog(`charge_stop failed: reason=${reason}`)
    return false
  }
}

function schedulePendingForceStop(vehicleId: string, sessionId: number | null): void {
  pendingForceStopVehicleId = vehicleId
  if (pendingForceStopTimer) return

  pendingForceStopTimer = setTimeout(() => {
    pendingForceStopTimer = null
    void retryPendingForceStop(sessionId)
  }, FORCE_STOP_RETRY_MS)
}

async function retryPendingForceStop(sessionId: number | null): Promise<void> {
  const vehicleId = pendingForceStopVehicleId
  if (!vehicleId) return
  if (pendingForceStopRetries >= FORCE_STOP_MAX_RETRIES) {
    logger.error('🚨 [CHARGE_STOP] Force-stop retry limit reached', {
      vehicleId,
      sessionId,
      retries: pendingForceStopRetries,
      retryIntervalMs: FORCE_STOP_RETRY_MS,
    })
    pushEngineLog(`force-stop retries exhausted after ${pendingForceStopRetries} attempts`)
    clearPendingForceStop()
    return
  }

  pendingForceStopRetries += 1
  logger.warn('🔁 [CHARGE_STOP] Retrying forced stop command', {
    vehicleId,
    sessionId,
    retryAttempt: pendingForceStopRetries,
    retryLimit: FORCE_STOP_MAX_RETRIES,
  })

  const sent = await trySendChargeStop(vehicleId, 'force_stop_retry', sessionId)
  if (sent) {
    clearPendingForceStop()
    return
  }

  schedulePendingForceStop(vehicleId, sessionId)
}

export function setPlanMode(targetSoc: number): void {
  const prevSoc = status.targetSoc
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
  logger.info('🗓️  [PLAN_MODE] Charge plan armed', {
    targetSoc,
    previousTargetSoc: prevSoc,
    planArmed: true,
  })
  engineEvents.emit('mode_changed', status)
  persistEngineRestoreState().catch((err) => logger.error('Failed to persist engine restore state', { err }))
}

export function getTargetSocPreferences(): { value: number } {
  return {
    value: persistedTargetSoc,
  }
}

export async function setTargetSocPreference(
  targetSoc: number,
  options?: { applyToRunningSession?: boolean }
): Promise<void> {
  const safeSoc = clampTargetSoc(targetSoc)
  persistedTargetSoc = safeSoc

  const applyToRunningSession = options?.applyToRunningSession ?? false
  const shouldApplyToCurrentTarget = applyToRunningSession && status.running

  status = {
    ...status,
    targetSoc: shouldApplyToCurrentTarget ? safeSoc : status.targetSoc,
    message: shouldApplyToCurrentTarget ? 'Target updated while charging' : status.message,
  }

  logger.info('ENGINE_TARGET_SOC_PREFERENCE_UPDATED', {
    targetSoc: safeSoc,
    applyToRunningSession,
    running: status.running,
    appliedToCurrentTarget: shouldApplyToCurrentTarget,
  })
  pushEngineLog(`target preference updated: soc=${safeSoc}% applied=${shouldApplyToCurrentTarget}`)

  await persistEngineRestoreState()
  engineEvents.emit('target_soc_updated', status)
}

export async function startEngine(targetSoc: number, targetAmps?: number, fromPlan = false): Promise<void> {
  const cfg = getConfig()
  if (status.running) {
    logger.warn('⚠️  [START_ENGINE] Engine already running — ignoring start request', {
      currentSessionId: status.sessionId,
      currentTargetSoc: status.targetSoc,
      requestedTargetSoc: targetSoc,
    })
    pushEngineLog('start ignored: engine already running')
    return
  }

  // A manual start (fromPlan=false) must disarm any pending plan so that mode is 'on'
  // and after charge completion the engine returns to 'off', not 'plan'.
  if (!fromPlan) {
    if (planArmed) {
      logger.info('🗓️  [START_ENGINE] Manual start requested while plan was armed — disarming plan', {
        previousTargetSoc: status.targetSoc,
        requestedTargetSoc: targetSoc,
      })
      pushEngineLog('plan disarmed: manual start requested')
    }
    planArmed = false
  }

  await requestWakeMode(true)

  // ── External charge detection ─────────────────────────────────────────────
  // If the vehicle is already charging (detected via polling) but evload did not
  // start that session, apply the stopChargeOnManualStart policy:
  //   flag=ON  → stop the external charge immediately and take full control
  //   flag=OFF → leave the charge running; only perform HA power management
  //              (amp adjustments / hard-limit stop) to protect the home breaker
  const currentVState = getVehicleState()
  const vid = getCommandVehicleId(cfg)
  if (currentVState.charging) {
    if (cfg.charging.stopChargeOnManualStart) {
      logger.warn('⚡ [START_ENGINE] External charge detected — stopChargeOnManualStart=true, stopping before evload takeover', {
        vehicleId: vid,
        chargingState: currentVState.chargingState,
        soc: currentVState.stateOfCharge,
        chargerActualCurrent: currentVState.chargerActualCurrent,
      })
      if (vid) {
        await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
          logger.error('🚨 [START_ENGINE] charge_stop for external charge takeover failed', { err, vehicleId: vid })
        )
      }
      pushEngineLog('external charge stopped: stopChargeOnManualStart=true, evload taking over')
    } else {
      logger.info('ℹ️  [START_ENGINE] External charge detected — stopChargeOnManualStart=false, power management only', {
        vehicleId: vid,
        chargingState: currentVState.chargingState,
        soc: currentVState.stateOfCharge,
        chargerActualCurrent: currentVState.chargerActualCurrent,
      })
      pushEngineLog('external charge detected: stopChargeOnManualStart=false, managing amps only to protect breaker')
    }
  }

  const requestedAmps = targetAmps ?? cfg.charging.maxAmps
  const safeTargetSoc = clampTargetSoc(targetSoc, persistedTargetSoc)
  persistedTargetSoc = safeTargetSoc

  // Keep last 20 lines from previous session so charge_stop / session-end entries stay visible
  const prevSessionTail = status.debugLog.slice(-20)
  status = {
    ...status,
    running: true,
    mode: planArmed ? 'plan' : 'on',
    targetSoc: safeTargetSoc,
    targetAmps: requestedAmps,
    setpointAmps: 0,  // will be sent as startAmps on the first adjustAmps call
    phase: 'idle',
    message: planArmed ? 'Planned session started' : 'Engine started',
    chargeStartBlocked: false,
    chargeStartBlockReason: null,
    accumulatedSessionEnergyKwh: 0,
    vehicleBatteryEnergyKwh: 0,
    vehicleBatteryEnergyRawKwh: 0,
    chargingEfficiencyPct: null,
    debugLog: prevSessionTail.length > 0 ? [...prevSessionTail, '--- new session ---'] : [],
  }
  sessionEnergyPriceEurPerKwh = cfg.charging.energyPriceEurPerKwh
  lastEnergySampleAtMs = Date.now()
  vehicleBatteryEnergyBaselineKwh = null
  chargeStartBlockedNotified = false
  haStoppedForLimit = false
  haResumeAfterMs = null
  lastChargeStartAttemptMs = 0
  lastRampUpMs = Date.now()
  lastSetpointSentMs = 0
  lastSetpointResyncAttemptMs = 0

  const session = await prisma.chargingSession.create({
    data: {
      vehicleId: cfg.proxy.vehicleId,
      targetSoc: safeTargetSoc,
      targetAmps: requestedAmps,
      energyPriceEurPerKwh: cfg.charging.energyPriceEurPerKwh,
    },
  })
  status.sessionId = session.id
  status.sessionStartedAt = session.startedAt.toISOString()
  logger.info('🚀 [START_ENGINE] Charging session started', {
    sessionId: session.id,
    targetSoc: safeTargetSoc,
    targetAmps: requestedAmps,
    mode: planArmed ? 'plan' : 'manual',
    vehicleId: cfg.proxy.vehicleId,
    vehicleName: cfg.proxy.vehicleName || undefined,
    energyPriceEurPerKwh: cfg.charging.energyPriceEurPerKwh,
    minAmps: cfg.charging.minAmps,
    maxAmps: cfg.charging.maxAmps,
  })
  pushEngineLog(`session ${session.id} started: targetSoc=${safeTargetSoc}% targetAmps=${requestedAmps}A mode=${planArmed ? 'plan' : 'manual'}`)
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
  const vStateForStop = getVehicleState()
  const stoppedSessionId = status.sessionId
  if (vid) {
    const shouldSendCommand = forceOff || vStateForStop.connected
    if (shouldSendCommand) {
      const sent = await trySendChargeStop(vid, forceOff ? 'user_requested_stop' : 'engine_stop', stoppedSessionId)
      if (forceOff) {
        if (sent) {
          clearPendingForceStop()
        } else {
          schedulePendingForceStop(vid, stoppedSessionId)
        }
      }
    } else {
      logger.info('⏭️  [CHARGE_STOP] Skipping charge_stop: vehicle not connected (sleeping or unreachable)', {
        vehicleId: vid,
        sessionId: stoppedSessionId,
      })
      pushEngineLog('charge_stop skipped: vehicle not connected')
    }
  }

  if (engineTimer) {
    clearInterval(engineTimer)
    engineTimer = null
  }
  if (status.sessionId) {
    const meterEnergyKwh = Number(status.accumulatedSessionEnergyKwh.toFixed(6))
    const vehicleEnergyKwh = Number(status.vehicleBatteryEnergyKwh.toFixed(6))
    const chargingEfficiencyPct = meterEnergyKwh > 0
      ? Number(((vehicleEnergyKwh / meterEnergyKwh) * 100).toFixed(2))
      : null
    const totalCostEur = Number((meterEnergyKwh * sessionEnergyPriceEurPerKwh).toFixed(4))
    await prisma.chargingSession.update({
      where: { id: status.sessionId },
      data: {
        endedAt: new Date(),
        totalEnergyKwh: meterEnergyKwh,
        meterEnergyKwh,
        vehicleEnergyKwh,
        chargingEfficiencyPct,
        totalCostEur,
      },
    })
    logger.info('🏁 [STOP_ENGINE] Charging session ended', {
      sessionId: status.sessionId,
      totalEnergyKwh: meterEnergyKwh,
      meterEnergyKwh,
      vehicleEnergyKwh,
      chargingEfficiencyPct,
      totalCostEur,
      energyPriceEurPerKwh: sessionEnergyPriceEurPerKwh,
      finalSoc: vStateForStop.stateOfCharge,
      forceOff,
    })
    pushEngineLog(`session ${status.sessionId} ended: energy=${meterEnergyKwh.toFixed(3)}kWh cost=${totalCostEur}€ forceOff=${forceOff}`)
    dispatchTelegramNotificationEvent('stop_charging', { reason: 'user_or_scheduler' }).catch(() => {})
    dispatchTelegramNotificationEvent('engine_stopped', { sessionId: status.sessionId }).catch(() => {})
  }
  status = {
    ...status,
    running: false,
    mode: planArmed ? 'plan' : 'off',
    sessionId: null,
    sessionStartedAt: null,
    targetSoc: planArmed ? status.targetSoc : persistedTargetSoc,
    phase: 'idle',
    message: planArmed ? 'Plan armed — waiting for scheduled start' : 'Engine stopped',
    chargeStartBlocked: false,
    chargeStartBlockReason: null,
    balancing: false,
    balancingStartedAt: null,
    haThrottled: false,
    setpointAmps: status.targetAmps,
    accumulatedSessionEnergyKwh: 0,
    vehicleBatteryEnergyKwh: 0,
    vehicleBatteryEnergyRawKwh: 0,
    chargingEfficiencyPct: null,
  }
  haStoppedForLimit = false
  haResumeAfterMs = null
  lastChargeStartAttemptMs = 0
  lastRampUpMs = 0
  lastSetpointSentMs = 0
  lastSetpointResyncAttemptMs = 0
  sessionEnergyPriceEurPerKwh = 0
  lastEnergySampleAtMs = null
  lastEngineHealthSnapshotAtMs = 0
  vehicleBatteryEnergyBaselineKwh = null
  chargeStartBlockedNotified = false
  suspendedState = null
  await persistEngineRestoreState().catch((err) => logger.error('Failed to persist engine restore state', { err }))
  engineEvents.emit('stopped', status)
}

function parseVehicleBatteryEnergyKwh(vState: ReturnType<typeof getVehicleState>): number | null {
  const raw = vState.rawChargeState?.['charge_energy_added']
  const value = typeof raw === 'number'
    ? raw
    : (typeof raw === 'string' ? Number(raw) : NaN)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

function resolveMeterPowerW(vState: ReturnType<typeof getVehicleState>): number {
  const haChargerW = getHaState().chargerW
  if (typeof haChargerW === 'number' && Number.isFinite(haChargerW) && haChargerW > 0) {
    return haChargerW
  }
  if (typeof vState.chargeRateKw === 'number' && Number.isFinite(vState.chargeRateKw) && vState.chargeRateKw > 0) {
    return vState.chargeRateKw * 1000
  }
  return 0
}

function updateSessionEnergyCounters(vState: ReturnType<typeof getVehicleState>): { meterDeltaKwh: number; meterPowerW: number } {
  const nowMs = Date.now()
  const meterPowerW = resolveMeterPowerW(vState)
  let meterDeltaKwh = 0

  if (lastEnergySampleAtMs != null && nowMs > lastEnergySampleAtMs && meterPowerW > 0) {
    const deltaHours = (nowMs - lastEnergySampleAtMs) / 3600000
    if (deltaHours > 0 && deltaHours < 1) {
      meterDeltaKwh = (meterPowerW / 1000) * deltaHours
      status.accumulatedSessionEnergyKwh = Number((status.accumulatedSessionEnergyKwh + meterDeltaKwh).toFixed(6))
    }
  }
  lastEnergySampleAtMs = nowMs

  const vehicleBatteryEnergyKwh = parseVehicleBatteryEnergyKwh(vState)
  if (vehicleBatteryEnergyKwh != null) {
    // On first reading, capture current value as baseline — Tesla sometimes does not reset
    // charge_energy_added to zero at the start of a new session.
    if (vehicleBatteryEnergyBaselineKwh === null) {
      vehicleBatteryEnergyBaselineKwh = vehicleBatteryEnergyKwh
      logger.info('ENGINE_VEHICLE_ENERGY_BASELINE_CAPTURED', {
        sessionId: status.sessionId,
        baselineKwh: vehicleBatteryEnergyKwh,
        note: vehicleBatteryEnergyKwh > 0
          ? 'non-zero baseline detected — using as zero-point for this session'
          : 'zero baseline — no offset needed',
      })
      pushEngineLog(`vehicle energy baseline: ${vehicleBatteryEnergyKwh.toFixed(3)} kWh (zero-point)`)
    }
    // Expose raw proxy value (informational — may include energy from before this evload session)
    status.vehicleBatteryEnergyRawKwh = vehicleBatteryEnergyKwh
    // Compute session energy relative to baseline, clamped to >= 0
    const sessionEnergyKwh = Math.max(0, vehicleBatteryEnergyKwh - vehicleBatteryEnergyBaselineKwh)
    // Keep highest observed value to guard against transient Tesla API counter dips
    status.vehicleBatteryEnergyKwh = Math.max(status.vehicleBatteryEnergyKwh, sessionEnergyKwh)
  }

  status.chargingEfficiencyPct =
    status.accumulatedSessionEnergyKwh > 0 && status.vehicleBatteryEnergyKwh > 0
      ? Number(((status.vehicleBatteryEnergyKwh / status.accumulatedSessionEnergyKwh) * 100).toFixed(2))
      : null

  return { meterDeltaKwh, meterPowerW }
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
      const fsType = getFailsafeType()
      if (fsType === 'soft') {
        // Soft failsafe (proxy disconnected): suspend the session without stopping it.
        // The engine timer keeps running; we just pause and wait for reconnect.
        if (status.running && !suspendedState) {
          suspendedState = {
            targetSoc: status.targetSoc,
            targetAmps: status.targetAmps,
            reason: 'proxy_lost',
          }
          logger.warn('🔌 [CHARGE_SUSPEND] Proxy disconnected — charge session suspended, will auto-resume on reconnect', {
            sessionId: status.sessionId,
            targetSoc: suspendedState.targetSoc,
            targetAmps: suspendedState.targetAmps,
          })
          pushEngineLog(`charge suspended: proxy lost (targetSoc=${suspendedState.targetSoc}% targetAmps=${suspendedState.targetAmps}A)`)
          dispatchTelegramNotificationEvent('charging_paused', { reason: 'proxy_disconnected' }).catch(() => {})
        }
        setEnginePhase('paused', 'soft_failsafe_proxy_lost')
        status.message = 'Proxy disconnected — charge suspended, waiting for reconnect'
        engineEvents.emit('tick', status)
        return
      }
      // Hard failsafe → stop the engine immediately
      logger.warn('🚨 [FAILSAFE] Hard failsafe is active — stopping engine immediately', {
        sessionId: status.sessionId,
        phase: status.phase,
        currentSoc: getVehicleState().stateOfCharge,
      })
      await stopEngine()
      status.message = 'Stopped due to failsafe'
      pushEngineLog('stopped by failsafe')
      return
    }

    const vState = getVehicleState()
    if (!vState.connected) {
      const blockReason = resolveChargeStartBlockReason(vState) ?? 'Vehicle not connected to proxy'
      const changed = !status.chargeStartBlocked || status.chargeStartBlockReason !== blockReason
      status.chargeStartBlocked = true
      status.chargeStartBlockReason = blockReason
      lastChargeStartAttemptMs = 0
      setEnginePhase('paused', 'vehicle_not_connected')
      status.message = `${blockReason}. Waiting for cable/connection before retrying`
      if (changed) {
        pushEngineLog(`paused: ${blockReason}`)
      }
      if (!chargeStartBlockedNotified) {
        chargeStartBlockedNotified = true
        dispatchTelegramNotificationEvent('charge_start_blocked', {
          sessionId: status.sessionId ?? undefined,
          reason: blockReason,
          chargingState: vState.chargingState ?? 'unknown',
          pluggedIn: vState.pluggedIn,
          vehicleConnected: vState.connected,
          soc: vState.stateOfCharge ?? 0,
        }).catch(() => {})
      }
      return
    }

    const cfg = getConfig()
    const soc = vState.stateOfCharge ?? 0
    const actualAmps = vState.chargerActualCurrent ?? 0

    const energySample = updateSessionEnergyCounters(vState)
    await recordTelemetry(vState, energySample)
    emitEngineHealthSnapshot(vState, energySample.meterPowerW)

    status.currentAmps = actualAmps
    pushEngineLog(`tick: soc=${soc}% actual=${actualAmps}A state=${vState.chargingState ?? 'unknown'} home=${getHaState().powerW ?? 0}W`)

    logger.verbose('⚙️[ENGINE_TICK] cycle tick', {
      enginePhase: status.phase,
      running: status.running,
      soc,
      actualAmps,
      targetAmps: status.targetAmps,
      targetSoc: status.targetSoc,
      chargingState: vState.chargingState,
      homePowerW: getHaState().powerW ?? 0,
      vehicleSleepStatus: vState.vehicleSleepStatus,
    })

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
        setEnginePhase('paused', 'ha_cooldown_wait')
        status.message = `Paused by HA limit, retry in ${remaining}s`
        status.setpointAmps = 0
        pushEngineLog(`HA cooldown active: ${remaining}s before restart attempt`)
        engineEvents.emit('tick', status)
        return
      }

      if (haThrottleAmps === null || haThrottleAmps < cfg.charging.minAmps) {
        setEnginePhase('paused', 'ha_restart_blocked')
        status.message = 'Paused by HA limit, waiting power margin'
        status.setpointAmps = 0
        pushEngineLog(`HA restart blocked: allowed=${haThrottleAmps ?? 'n/a'}A min=${cfg.charging.minAmps}A`)
        engineEvents.emit('tick', status)
        return
      }

      const vid = getCommandVehicleId(cfg)
      if (vid) {
        logger.info('🔄 [CHARGE_START] HA cooldown passed — resuming charge', {
          vehicleId: vid,
          sessionId: status.sessionId,
          allowedAmps: haThrottleAmps,
          minAmps: cfg.charging.minAmps,
        })
        await sendProxyCommand(vid, 'charge_start', {}).catch((err) =>
          logger.error('🚨 [CHARGE_START] HA resume charge_start failed', { err, vehicleId: vid })
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
            const haS = getHaState()
            logger.warn('⛔ [CHARGE_STOP] HA hard power limit exceeded — stopping charge', {
              vehicleId: vid,
              sessionId: status.sessionId,
              homePowerW: haS.powerW,
              maxHomePowerW: cfg.homeAssistant.maxHomePowerW,
              haThrottleAmps,
              minAmps: cfg.charging.minAmps,
              resumeDelaySec: cfg.homeAssistant.resumeDelaySec,
            })
            await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
              logger.error('🚨 [CHARGE_STOP] HA stop charge_stop failed', { err, vehicleId: vid })
            )
            pushEngineLog('HA hard limit: charge_stop sent')
          }
          haStoppedForLimit = true
        }
        haResumeAfterMs = Date.now() + Math.max(0, cfg.homeAssistant.resumeDelaySec) * 1000
        if (!status.haThrottled) {
          status.haThrottled = true
          const haS = getHaState()
          logger.warn('⚡ [HA_THROTTLE] Home power exceeds limit — pausing charge', {
            sessionId: status.sessionId,
            homePowerW: haS.powerW,
            maxHomePowerW: cfg.homeAssistant.maxHomePowerW,
            resumeDelaySec: cfg.homeAssistant.resumeDelaySec,
          })
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
        setEnginePhase('paused', 'ha_hard_limit')
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
              logger.error('🚨 [SET_AMP] HA throttle set_charging_amps failed', { err, vehicleId: vid, throttled })
            )
            logger.info('⚡ [SET_AMP] HA throttle: adjusting charging current', {
              vehicleId: vid,
              sessionId: status.sessionId,
              reason: 'ha_power_throttle',
              previousAmps: actualAmps,
              newAmps: throttled,
              targetAmps: status.targetAmps,
              homePowerW: getHaState().powerW,
              maxHomePowerW: cfg.homeAssistant.maxHomePowerW,
            })
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
        logger.info('✅ [HA_THROTTLE] HA throttle cleared — home power within limit', {
          sessionId: status.sessionId,
          homePowerW: getHaState().powerW,
          maxHomePowerW: cfg.homeAssistant.maxHomePowerW,
        })
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
          if (status.chargeStartBlocked || status.chargeStartBlockReason) {
            logger.info('✅ [CHARGE_START_UNBLOCKED] Vehicle charging detected — clearing charge_start block', {
              sessionId: status.sessionId,
              previousReason: status.chargeStartBlockReason,
            })
            pushEngineLog('charge_start block cleared: vehicle entered charging state')
          }
          status.chargeStartBlocked = false
          status.chargeStartBlockReason = null
          chargeStartBlockedNotified = false

          // If evload never sent charge_start in this session (lastChargeStartAttemptMs === 0)
          // the charge was already in progress when the engine started (external charge).
          // Log once on the first tick where we hit this path to make it observable in logs.
          if (lastChargeStartAttemptMs === 0 && status.phase !== 'charging') {
            const cfg2 = getConfig()
            logger.info('ℹ️  [ENGINE_TICK] Vehicle found charging without evload charge_start — external charge in progress', {
              sessionId: status.sessionId,
              vehicleId: cfg.proxy.vehicleId,
              chargingState: vState.chargingState,
              soc,
              actualAmps,
              stopChargeOnManualStart: cfg2.charging.stopChargeOnManualStart,
              note: cfg2.charging.stopChargeOnManualStart
                ? 'external charge was stopped at session start per stopChargeOnManualStart=true'
                : 'managing amps only — stopChargeOnManualStart=false',
            })
            pushEngineLog(`ext-charge observed on first tick: state=${vState.chargingState} actual=${actualAmps}A stopOnManual=${cfg2.charging.stopChargeOnManualStart}`)
          }
          lastChargeStartAttemptMs = 0
          setEnginePhase('charging', 'vehicle_is_charging')
          status.message = `Charging ${actualAmps}A (setpoint ${status.setpointAmps}A), SoC: ${soc}%${status.haThrottled ? ' (HA throttled)' : ''}`
          await adjustAmps(cfg)
        } else {
          const blockReason = resolveChargeStartBlockReason(vState)
          if (blockReason) {
            const changed = !status.chargeStartBlocked || status.chargeStartBlockReason !== blockReason
            status.chargeStartBlocked = true
            status.chargeStartBlockReason = blockReason
            lastChargeStartAttemptMs = 0
            setEnginePhase('paused', 'charge_start_blocked_vehicle_state')
            status.message = `${blockReason}. Waiting for cable/connection before retrying`

            if (changed) {
              logger.warn('⛔ [CHARGE_START_BLOCKED] Charge start retries suspended', {
                sessionId: status.sessionId,
                reason: blockReason,
                chargingState: vState.chargingState,
                pluggedIn: vState.pluggedIn,
                vehicleConnected: vState.connected,
                soc,
              })
              pushEngineLog(`charge_start blocked: ${blockReason}`)
            }

            if (!chargeStartBlockedNotified) {
              chargeStartBlockedNotified = true
              dispatchTelegramNotificationEvent('charge_start_blocked', {
                sessionId: status.sessionId ?? undefined,
                reason: blockReason,
                chargingState: vState.chargingState ?? 'unknown',
                pluggedIn: vState.pluggedIn,
                vehicleConnected: vState.connected,
                soc,
              }).catch(() => {})
            }

            engineEvents.emit('tick', status)
            return
          }

          if (status.chargeStartBlocked || status.chargeStartBlockReason) {
            logger.info('🔓 [CHARGE_START_UNBLOCKED] Vehicle state recovered — charge_start retries re-enabled', {
              sessionId: status.sessionId,
              previousReason: status.chargeStartBlockReason,
            })
            pushEngineLog('charge_start block cleared: vehicle state recovered')
            status.chargeStartBlocked = false
            status.chargeStartBlockReason = null
            chargeStartBlockedNotified = false
          }

          const now = Date.now()
          const retryMs = cfg.charging.chargeStartRetryMs
          const retryAllowed = vState.pluggedIn && (now - lastChargeStartAttemptMs >= retryMs)

          if (retryAllowed) {
            const vid = getCommandVehicleId(cfg)
            if (vid) {
              // ── Pre-set current BEFORE charge_start to avoid a current spike ──
              // If no setpoint has been sent yet this session, set the safe start current
              // now so that Tesla begins drawing at startAmps the moment charge_start fires.
              if (lastSetpointSentMs === 0) {
                const safeAmps = cfg.charging.startAmps
                logger.info('⚡ [SET_AMP] Pre-setting start current before charge_start', {
                  vehicleId: vid,
                  sessionId: status.sessionId,
                  startAmps: safeAmps,
                })
                try {
                  await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: safeAmps })
                  status.setpointAmps = safeAmps
                  lastSetpointSentMs = now
                  pushEngineLog(`pre-set current: ${safeAmps}A before charge_start`)
                } catch (err) {
                  logger.error('🚨 [SET_AMP] Pre-set current before charge_start failed', { err, vehicleId: vid })
                  pushEngineLog('pre-set current failed — proceeding with charge_start anyway')
                }
              }

              logger.info('🔌 [CHARGE_START] Vehicle plugged but not charging — sending charge_start', {
                vehicleId: vid,
                sessionId: status.sessionId,
                chargingState: vState.chargingState,
                soc,
                pluggedIn: vState.pluggedIn,
                retryIntervalMs: retryMs,
              })
              await sendProxyCommand(vid, 'charge_start', {}).catch((err) =>
                logger.error('🚨 [CHARGE_START] charge_start failed', { err, vehicleId: vid, sessionId: status.sessionId })
              )
              lastChargeStartAttemptMs = now
              status.chargeStartBlocked = false
              status.chargeStartBlockReason = null
              setEnginePhase('paused', 'charge_start_pending_state_update')
              status.message = 'Sent charge_start, waiting vehicle state update'
              pushEngineLog(`charge_start sent: state=${vState.chargingState} soc=${soc}%`)
            } else {
              setEnginePhase('paused', 'missing_vehicle_id')
              status.message = 'Vehicle ID not configured'
              pushEngineLog('cannot send charge_start: no vehicleId configured')
            }
          } else {
            const nextInMs = Math.max(0, retryMs - (now - lastChargeStartAttemptMs))
            setEnginePhase('paused', 'charge_start_retry_backoff')
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
        logger.info('🏁 [STOP_ENGINE] Balancing/SoC target reached — stopping charging', {
          reason: action.reason,
          sessionId: status.sessionId,
          soc,
          targetSoc: status.targetSoc,
        })
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
  if (!haS.connected || haS.smoothedPowerW === null || cfg.homeAssistant.maxHomePowerW <= 0) return null

  // If charger sensor is currently faulty (chargerW < 0), skip HA-based adjustment
  // for this tick and preserve the current setpoint to avoid reacting to bad data.
  if (haS.chargerFault) {
    pushEngineLog(`[HA_POWER_CALC] charger sensor fault — skipping HA amp adjustment this tick`)
    return null
  }

  // Prefer smoothed values for stability; fall back to vehicle telemetry when charger entity unavailable.
  const smoothedPowerW = haS.smoothedPowerW
  const smoothedChargerW = haS.smoothedChargerW ?? ((vState.chargeRateKw ?? 0) * 1000)

  // powerW ≤ 0 means solar is exporting to the grid — house load is effectively zero,
  // all headroom is available.  Clamp houseOnlyW to [0, maxHomePowerW] to avoid negative
  // available headroom from corrupting the setpoint calculation.
  const houseOnlyW = Math.max(0, Math.min(
    smoothedPowerW - smoothedChargerW,
    cfg.homeAssistant.maxHomePowerW
  ))
  const availableW = cfg.homeAssistant.maxHomePowerW - houseOnlyW
  const voltage = vState.chargerVoltage ?? 230

  pushEngineLog(
    `[HA_POWER_CALC] raw=${haS.powerW ?? 0}W(charger=${haS.chargerW ?? 'n/a'}W)` +
    ` smoothed=${Math.round(smoothedPowerW)}W(charger=${Math.round(smoothedChargerW)}W)` +
    ` houseOnly=${Math.round(houseOnlyW)}W available=${Math.round(availableW)}W voltage=${voltage}V`
  )
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

  // The initial startAmps setpoint is always sent before charge_start (see CHARGE_START block above).
  // isFirstCommand is kept as a safety fallback in case set_charging_amps before charge_start failed.
  const isFirstCommand = lastSetpointSentMs === 0 && status.setpointAmps === 0
  let desired = status.setpointAmps

  if (isFirstCommand) {
    desired = cfg.charging.startAmps
    pushEngineLog(`first command: startAmps=${cfg.charging.startAmps}A`)
  } else if (desired > maxPossible) {
    desired = maxPossible
    lastRampUpMs = now
  } else if (homeTotalPowerW !== null && now - lastRampUpMs >= rampIntervalMs) {
    // Only ramp if the vehicle has had time to respond to the last setpoint change
    const settleMs = Math.max(rampIntervalMs, 3000)
    if (now - lastSetpointSentMs >= settleMs) {
      // Use setpointAmps (last commanded value) as ramp base — not actualAmps —
      // so ramp always continues from the commanded setpoint even when the vehicle lags
      const step = 1 // 1 Amp per interval
      desired = Math.min(status.setpointAmps + step, maxPossible)
      lastRampUpMs = now
      pushEngineLog(`ramp: homeTotalPowerW=${homeTotalPowerW}W chargerPowerW=${Math.round(chargerPowerW)}W base=${status.setpointAmps}A maxPossible=${maxPossible}A candidate=${desired}A`)
    } else {
      pushEngineLog(`ramp skipped: waiting settle (${Math.ceil((settleMs - (now - lastSetpointSentMs)) / 1000)}s)`)
    }
  }

  desired = clampAmps(desired, cfg.charging.minAmps, cfg.charging.maxAmps)
  const teslaRequestedAmps = vState.chargeCurrentRequest
  const setpointMismatchDetected =
    teslaRequestedAmps != null &&
    Number.isFinite(teslaRequestedAmps) &&
    Math.abs(teslaRequestedAmps - desired) >= 1
  const setpointResyncCooldownMs = Math.max(rampIntervalMs, 5000)
  const canAttemptSetpointResync =
    setpointMismatchDetected &&
    now - lastSetpointSentMs >= setpointResyncCooldownMs &&
    now - lastSetpointResyncAttemptMs >= setpointResyncCooldownMs

  // Only send set_charging_amps when the intended setpoint actually changes — prevents oscillation
  if (desired !== status.setpointAmps) {
      const previousSetpoint = status.setpointAmps
      status.setpointAmps = desired
      const direction = desired > previousSetpoint ? 'ramp_up' : 'ramp_down'
      try {
        await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: desired })
        lastSetpointSentMs = now
        lastSetpointResyncAttemptMs = 0
        logger.info('⚡ [SET_AMP] Charging current adjusted', {
          vehicleId: vid,
          sessionId: status.sessionId,
          reason: direction,
          previousAmps: previousSetpoint,
          newAmps: desired,
          targetAmps: status.targetAmps,
          minAmps: cfg.charging.minAmps,
          maxAmps: cfg.charging.maxAmps,
          homePowerW: homeTotalPowerW,
          haConnected: haS.connected,
        })
        pushEngineLog(`setpoint changed: ${previousSetpoint}A -> ${desired}A (${direction})`)
    } catch (err) {
      logger.error('🚨 [SET_AMP] Failed to adjust charging amps', { err, vehicleId: vid, desired, previousSetpoint })
      pushEngineLog(`setpoint command failed: desired=${desired}A`)
    }
  } else if (canAttemptSetpointResync) {
    lastSetpointResyncAttemptMs = now
    try {
      await sendProxyCommand(vid, 'set_charging_amps', { charging_amps: desired })
      lastSetpointSentMs = now
      logger.warn('⚠️ [SET_AMP_RESYNC] Tesla requested amps differ from setpoint — resending set_charging_amps', {
        vehicleId: vid,
        sessionId: status.sessionId,
        setpointAmps: desired,
        teslaRequestedAmps,
        rampIntervalMs,
      })
      pushEngineLog(`setpoint resync: tesla=${teslaRequestedAmps}A expected=${desired}A`) 
    } catch (err) {
      logger.error('🚨 [SET_AMP_RESYNC] Failed to resync charging amps', {
        err,
        vehicleId: vid,
        expectedAmps: desired,
        teslaRequestedAmps,
      })
      pushEngineLog(`setpoint resync failed: tesla=${teslaRequestedAmps}A expected=${desired}A`)
    }
  } else {
    pushEngineLog(`setpoint stable: ${desired}A`)
  }
}

async function recordTelemetry(
  vState: ReturnType<typeof getVehicleState>,
  energySample: { meterDeltaKwh: number; meterPowerW: number }
): Promise<void> {
  if (!status.sessionId) return
  try {
    await prisma.chargingTelemetry.create({
      data: {
        sessionId: status.sessionId,
        voltageV: vState.chargerVoltage,
        currentA: vState.chargerActualCurrent,
        powerW: energySample.meterPowerW > 0 ? energySample.meterPowerW : null,
        energyKwh: energySample.meterDeltaKwh > 0 ? energySample.meterDeltaKwh : null,
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

export function initExternalChargeGuard(): void {
  vehicleEvents.on('charging_started', async (data: {
    vehicleId: string
    chargingState: string
    soc: number | null
    chargerActualCurrent: number | null
    chargerVoltage: number | null
  }) => {
    if (status.running) {
      logger.debug('EXTERNAL_CHARGE_GUARD: charging started — engine is running, evload is in control, no action', {
        vehicleId: data.vehicleId,
        chargingState: data.chargingState,
        sessionId: status.sessionId,
      })
      return
    }

    const cfg = getConfig()
    if (!cfg.charging.stopChargeOnManualStart) {
      logger.info('\u2139\ufe0f  [EXTERNAL_CHARGE_GUARD] External charge detected while engine idle — stopChargeOnManualStart=false, managing power only', {
        vehicleId: data.vehicleId,
        chargingState: data.chargingState,
        soc: data.soc,
        chargerActualCurrent: data.chargerActualCurrent,
      })
      return
    }

    const vid = getCommandVehicleId(cfg)
    if (!vid) {
      logger.warn('EXTERNAL_CHARGE_GUARD: External charge detected but no vehicleId configured — cannot stop', {
        vehicleId: data.vehicleId,
      })
      return
    }

    logger.warn('\u26a1 [EXTERNAL_CHARGE_GUARD] External charge detected while engine is idle — stopChargeOnManualStart=true, sending charge_stop', {
      vehicleId: vid,
      chargingState: data.chargingState,
      soc: data.soc,
      chargerActualCurrent: data.chargerActualCurrent,
      chargerVoltage: data.chargerVoltage,
      engineMode: status.mode,
    })
    pushEngineLog(`ext-charge guard: charge_stop sent (engine idle, stopChargeOnManualStart=true, state=${data.chargingState})`)

    await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
      logger.error('\ud83d\udea8 [EXTERNAL_CHARGE_GUARD] charge_stop failed', { err, vehicleId: vid })
    )
  })

  // On proxy reconnect: auto-resume a suspended charge session or stop autonomous charge
  proxyEvents.on('connected', async () => {
    const cfg = getConfig()

    if (pendingForceStopVehicleId) {
      logger.info('🔁 [CHARGE_STOP] Proxy reconnected while force-stop pending — attempting immediate retry', {
        vehicleId: pendingForceStopVehicleId,
        pendingRetries: pendingForceStopRetries,
      })
      await retryPendingForceStop(null)
    }

    if (suspendedState) {
      // We had an active session when the proxy went away — resume it
      const saved = suspendedState
      suspendedState = null
      logger.info('🔄 [CHARGE_RESUME] Proxy reconnected — resuming suspended charge session', {
        targetSoc: saved.targetSoc,
        targetAmps: saved.targetAmps,
        previousSessionId: status.sessionId,
      })
      pushEngineLog(`proxy reconnected: resuming charge (targetSoc=${saved.targetSoc}% targetAmps=${saved.targetAmps}A)`)
      dispatchTelegramNotificationEvent('charging_resumed', { reason: 'proxy_reconnected' }).catch(() => {})
      // Brief delay to allow fresh vehicle data after reconnect
      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      await startEngine(saved.targetSoc, saved.targetAmps).catch((err) =>
        logger.error('🚨 [CHARGE_RESUME] Failed to resume charge after proxy reconnect', { err })
      )
      return
    }

    // No suspended session — check for autonomous charge that started while proxy was offline
    if (!status.running && cfg.proxy.stopAutonomousCharge) {
      // Give proxy a moment to deliver fresh vehicle data
      await new Promise<void>((resolve) => setTimeout(resolve, 3000))
      const vState = getVehicleState()
      if (vState.charging) {
        const vid = getCommandVehicleId(cfg)
        if (vid) {
          logger.warn('🚦 [AUTONOMOUS_CHARGE_GUARD] Proxy reconnected: vehicle charging autonomously — stopAutonomousCharge=true, sending charge_stop', {
            vehicleId: vid,
            chargingState: vState.chargingState,
            soc: vState.stateOfCharge,
            chargerActualCurrent: vState.chargerActualCurrent,
          })
          pushEngineLog(`autonomous charge guard: charge_stop sent (proxy reconnect, stopAutonomousCharge=true)`)
          await sendProxyCommand(vid, 'charge_stop', {}).catch((err) =>
            logger.error('🚨 [AUTONOMOUS_CHARGE_GUARD] charge_stop failed', { err, vehicleId: vid })
          )
        }
      }
    }
  })

  logger.info('External charge guard initialized (stopChargeOnManualStart listener active)')
}
