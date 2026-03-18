import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../auth'

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers['authorization']
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    const valid = await verifyToken(token)
    if (!valid) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
}
