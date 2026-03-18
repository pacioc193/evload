import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'
import { logger } from './logger'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production')
  }
  logger.warn('JWT_SECRET not set – using insecure fallback (development only)')
}
const RESOLVED_JWT_SECRET = JWT_SECRET ?? 'fallback-dev-secret'
const SESSION_HOURS = 2

export async function isFirstLaunch(): Promise<boolean> {
  const rec = await prisma.appConfig.findUnique({ where: { key: 'password_hash' } })
  return rec === null
}

export async function setPassword(plaintext: string): Promise<void> {
  const hash = await bcrypt.hash(plaintext, 12)
  await prisma.appConfig.upsert({
    where: { key: 'password_hash' },
    update: { value: hash },
    create: { key: 'password_hash', value: hash },
  })
  logger.info('UI password updated')
}

export async function verifyPassword(plaintext: string): Promise<boolean> {
  const rec = await prisma.appConfig.findUnique({ where: { key: 'password_hash' } })
  if (!rec) return false
  return bcrypt.compare(plaintext, rec.value)
}

export function signToken(): string {
  return jwt.sign({}, RESOLVED_JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` })
}

export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, RESOLVED_JWT_SECRET)
    return true
  } catch {
    return false
  }
}
