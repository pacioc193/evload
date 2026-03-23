import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'
import { logger } from './logger'

// JWT secret is initialized at boot in database
// Fallback to env variable for backward compatibility
let cachedJwtSecret: string | null = null

async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) {
    return cachedJwtSecret
  }

  try {
    const config = await prisma.appConfig.findUnique({ where: { id: 1 } })
    if (config?.jwt_secret) {
      cachedJwtSecret = config.jwt_secret
      return cachedJwtSecret
    }
  } catch (err) {
    logger.error('Failed to load JWT secret from database', { err })
  }

  // Fallback to environment variable
  const envSecret = process.env.JWT_SECRET
  if (envSecret) {
    cachedJwtSecret = envSecret
    return cachedJwtSecret
  }

  // Last resort fallback (development only)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET not found in database or environment; app cannot start')
  }
  logger.warn('JWT_SECRET not set — using insecure fallback (development only)')
  cachedJwtSecret = 'fallback-dev-secret'
  return cachedJwtSecret
}

const SESSION_HOURS = (() => {
  const val = parseInt(process.env.SESSION_HOURS ?? '', 10)
  return val > 0 ? val : 24
})()

export async function isFirstLaunch(): Promise<boolean> {
  const rec = await prisma.appConfig.findUnique({ where: { id: 1 } })
  return !rec?.password_hash
}

export async function setPassword(plaintext: string): Promise<void> {
  const hash = await bcrypt.hash(plaintext, 12)
  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: { password_hash: hash },
    create: { id: 1, password_hash: hash },
  })
  logger.info('UI password updated')
}

export async function verifyPassword(plaintext: string): Promise<boolean> {
  const rec = await prisma.appConfig.findUnique({ where: { id: 1 } })
  if (!rec?.password_hash) return false
  return bcrypt.compare(plaintext, rec.password_hash)
}

export async function signToken(): Promise<string> {
  const jwtSecret = await getJwtSecret()
  return jwt.sign({}, jwtSecret, { expiresIn: `${SESSION_HOURS}h` })
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const jwtSecret = await getJwtSecret()
    jwt.verify(token, jwtSecret)
    return true
  } catch {
    return false
  }
}
