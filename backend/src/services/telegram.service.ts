import TelegramBot from 'node-telegram-bot-api'
import { logger } from '../logger'
import { getConfig } from '../config'
import { prisma } from '../prisma'

let bot: TelegramBot | null = null

// In-memory cache for the bot token, populated from DB at startup
let cachedBotToken: string | undefined = undefined

type CommandHandler = (chatId: string, args: string[]) => Promise<string>
const commandHandlers = new Map<string, CommandHandler>()

export interface TelegramPrerequisiteStatus {
  ok: boolean
  missing: string[]
}

export function registerTelegramCommand(command: string, handler: CommandHandler): void {
  commandHandlers.set(command, handler)
}

/**
 * Load the bot token from the database into the in-memory cache.
 */
export async function loadBotTokenFromDB(): Promise<void> {
  try {
    const config = await prisma.appConfig.findUnique({ where: { id: 1 } })
    if (config?.telegram_bot_token) {
      cachedBotToken = config.telegram_bot_token
      logger.debug('Telegram bot token loaded from database')
    }
  } catch (err) {
    logger.error('Failed to load Telegram bot token from database', { err })
  }
}

/**
 * Persist a new bot token to the database and refresh the in-memory cache.
 */
export async function setBotToken(token: string): Promise<void> {
  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: { telegram_bot_token: token },
    create: { id: 1, telegram_bot_token: token },
  })
  cachedBotToken = token
}

/**
 * Return whether a bot token is currently configured.
 */
export function hasBotToken(): boolean {
  return Boolean(cachedBotToken)
}

function getBotToken(): string | undefined {
  return cachedBotToken
}

function getNotificationChatIds(): string[] {
  const cfg = getConfig()
  return (cfg.telegram.allowedChatIds ?? []).map((chatId) => String(chatId).trim()).filter(Boolean)
}

export function initTelegram(): void {
  const token = getBotToken()
  const cfg = getConfig()
  if (!token || !cfg.telegram.enabled) {
    logger.info('Telegram bot disabled or no token configured')
    return
  }

  if (bot && cachedBotToken !== token) {
    logger.info('Telegram bot token changed, re-initializing...')
    bot.stopPolling().catch(() => {})
    bot = null
  }

  if (!bot) {
    bot = new TelegramBot(token, { polling: true })
    logger.info('Telegram bot started')

    bot.on('message', (msg) => {
      const chatId = String(msg.chat.id)
      const currentCfg = getConfig()
      const allowed = currentCfg.telegram.allowedChatIds
      if (allowed.length > 0 && !allowed.includes(chatId)) {
        logger.warn(`Telegram message from unauthorized chat ${chatId}`)
        bot?.sendMessage(chatId, 'Unauthorized').catch(() => {})
        return
      }
      const text = msg.text ?? ''
      logger.info(`Telegram command: ${text}`, { chatId })
      handleCommand(chatId, text).catch((err) => logger.error('Telegram command error', { err }))
    })

    bot.on('error', (err) => {
      logger.error('Telegram bot error', { err })
    })

    bot.on('polling_error', (err) => {
      logger.error('Telegram polling error', { err })
    })
  }
}

async function handleCommand(chatId: string, text: string): Promise<void> {
  if (!bot) return
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0]?.replace('/', '') ?? ''
  const args = parts.slice(1)

  const handler = commandHandlers.get(cmd)
  if (handler) {
    try {
      const reply = await handler(chatId, args)
      await bot.sendMessage(chatId, reply)
    } catch (err) {
      logger.error(`Telegram handler for /${cmd} failed`, { err })
      await bot.sendMessage(chatId, `❌ Command failed: ${String(err)}`)
    }
    return
  }

  if (cmd === 'status') {
    await bot.sendMessage(chatId, 'Status: evload running ✅')
  } else if (cmd === 'help') {
    await bot.sendMessage(
      chatId,
      '/status — get status\n/start [soc] [amps] — start charging\n/stop — stop charging\n/help — this message'
    )
  } else {
    await bot.sendMessage(chatId, `Unknown command: ${text}\nType /help for available commands`)
  }
}

export async function sendTelegramNotification(message: string): Promise<boolean> {
  const token = getBotToken()
  const cfg = getConfig()
  const chatIds = getNotificationChatIds()

  if (!bot && token && cfg.telegram.enabled) {
    initTelegram()
  }

  if (!bot || chatIds.length === 0 || !cfg.telegram.enabled) {
    logger.debug('Telegram notification skipped - bot not running, no chat ID, or telegram disabled')
    return false
  }
  try {
    let delivered = 0
    for (const chatId of chatIds) {
      await bot.sendMessage(chatId, message)
      delivered += 1
    }
    logger.info(`Telegram notification sent: ${message}`)
    return delivered > 0
  } catch (err) {
    logger.error('Failed to send Telegram notification', { err })
    return false
  }
}

export function isTelegramReady(): boolean {
  const cfg = getConfig()
  return Boolean(bot && getNotificationChatIds().length > 0 && cfg.telegram.enabled)
}

export function getTelegramPrerequisiteStatus(): TelegramPrerequisiteStatus {
  const cfg = getConfig()
  const missing: string[] = []
  if (!cfg.telegram.enabled) missing.push('telegram_disabled')
  if (!getBotToken()) missing.push('bot_token_missing')
  if (!cfg.telegram.allowedChatIds || cfg.telegram.allowedChatIds.length === 0) {
    missing.push('chat_id_missing')
  }
  return { ok: missing.length === 0, missing }
}

export function stopTelegram(): void {
  if (bot) {
    bot.stopPolling().catch(() => {})
    bot = null
    logger.info('Telegram bot stopped')
  }
}
