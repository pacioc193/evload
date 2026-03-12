import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { requireAuth } from '../middleware/auth.middleware'
import { reloadConfig } from '../config'
import { logger } from '../logger'
import rateLimit from 'express-rate-limit'

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(process.cwd(), 'config.yaml')
const EXAMPLE_PATH = path.join(__dirname, '../../config.example.yaml')

const router = Router()
const configLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

router.get('/', configLimiter, requireAuth, (_req, res) => {
  try {
    let content: string
    if (fs.existsSync(CONFIG_PATH)) {
      content = fs.readFileSync(CONFIG_PATH, 'utf8')
    } else if (fs.existsSync(EXAMPLE_PATH)) {
      content = fs.readFileSync(EXAMPLE_PATH, 'utf8')
    } else {
      content = '# No config file found\n'
    }
    res.json({ content })
  } catch (err) {
    logger.error('Failed to read config', { err })
    res.status(500).json({ error: 'Failed to read config' })
  }
})

router.post('/', configLimiter, requireAuth, (req, res) => {
  const { content } = req.body as { content?: string }
  if (!content) {
    res.status(400).json({ error: 'Content required' })
    return
  }
  try {
    yaml.load(content)
  } catch (err) {
    res.status(400).json({ error: `Invalid YAML: ${(err as Error).message}` })
    return
  }
  try {
    fs.writeFileSync(CONFIG_PATH, content, 'utf8')
    reloadConfig()
    logger.info('Config updated via API')
    res.json({ success: true })
  } catch (err) {
    logger.error('Failed to write config', { err })
    res.status(500).json({ error: 'Failed to write config' })
  }
})

export default router
