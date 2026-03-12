import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { z } from 'zod'
import { logger } from './logger'

const ConfigSchema = z.object({
  demo: z.boolean().default(false),
  charging: z.object({
    defaultTargetSoc: z.number().min(1).max(100).default(80),
    defaultAmps: z.number().min(1).max(48).default(16),
    maxAmps: z.number().min(1).max(48).default(32),
    minAmps: z.number().min(1).max(48).default(5),
    balancingHoldMinutes: z.number().default(10),
    batteryCapacityKwh: z.number().min(1).default(75),
  }).default({}),
  climate: z.object({
    defaultTempC: z.number().default(21),
  }).default({}),
  homeAssistant: z.object({
    url: z.string().default('http://homeassistant.local:8123'),
    powerEntityId: z.string().default('sensor.home_power'),
    gridEntityId: z.string().optional(),
    maxHomePowerW: z.number().default(7000),
  }).default({}),
  telegram: z.object({
    enabled: z.boolean().default(false),
    allowedChatIds: z.array(z.string()).default([]),
  }).default({}),
  proxy: z.object({
    url: z.string().default('http://localhost:8080'),
    vehicleId: z.string().default(''),
    pollIntervalMs: z.number().default(1000),
  }).default({}),
})

export type AppConfig = z.infer<typeof ConfigSchema>

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(__dirname, '../config.yaml')

let cachedConfig: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      logger.warn(`Config file not found at ${CONFIG_PATH}, using defaults`)
      cachedConfig = ConfigSchema.parse({})
      return cachedConfig
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = yaml.load(raw)
    cachedConfig = ConfigSchema.parse(parsed)
    logger.info(`Config loaded from ${CONFIG_PATH}`)
    return cachedConfig
  } catch (err) {
    logger.error('Failed to load config, using defaults', { err })
    cachedConfig = ConfigSchema.parse({})
    return cachedConfig
  }
}

export function reloadConfig(): AppConfig {
  cachedConfig = null
  return loadConfig()
}

export function getConfig(): AppConfig {
  if (!cachedConfig) return loadConfig()
  return cachedConfig
}
