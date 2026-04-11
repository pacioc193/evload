import winston from 'winston'
import path from 'path'

const LOG_DIR = path.join(process.cwd(), 'logs')

const REDACT_KEYS = new Set([
  'authorization',
  'token',
  'password',
  'apikey',
  'api_key',
  'cookie',
  'set-cookie',
])

function redactString(value: string): string {
  if (/^bearer\s+/i.test(value)) return 'Bearer ***'
  if (value.length > 0) return '***'
  return value
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase()
      if (REDACT_KEYS.has(key)) {
        out[k] = typeof v === 'string' ? redactString(v) : '***'
      } else {
        out[k] = redactValue(v)
      }
    }
    return out
  }
  return value
}

export function sanitizeForLog(value: unknown, maxSerializedLength = 8 * 1024): unknown {
  const redacted = redactValue(value)
  try {
    const serialized = JSON.stringify(redacted)
    if (serialized.length <= maxSerializedLength) {
      return redacted
    }
    return {
      truncated: true,
      originalLength: serialized.length,
      preview: serialized.slice(0, maxSerializedLength),
    }
  } catch {
    return '[unserializable]'
  }
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    // Serialize Error objects nested inside metadata (e.g. `logger.error('msg', { err })`)
    // so they appear as { message, name, stack } instead of {}
    winston.format((info) => {
      const serializeErrors = (value: unknown): unknown => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            // Include any extra enumerable properties on the error object
            ...Object.fromEntries(Object.entries(value as unknown as Record<string, unknown>)),
          }
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serializeErrors(v)])
          )
        }
        if (Array.isArray(value)) {
          return value.map(serializeErrors)
        }
        return value
      }
      const { message, level, timestamp, [Symbol.for('level') as unknown as string]: _lvl, ...meta } = info as Record<string, unknown>
      const serializedMeta = serializeErrors(meta) as Record<string, unknown>
      return { ...info, ...serializedMeta }
    })(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 50 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    } as winston.transports.FileTransportOptions),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    } as winston.transports.FileTransportOptions),
  ],
})

export function setLoggerLevel(level: 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly'): void {
  logger.level = level
  for (const transport of logger.transports) {
    transport.level = level
  }
}
