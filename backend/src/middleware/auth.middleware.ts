import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../auth'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization']
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}
