import TelegramBot from 'node-telegram-bot-api'
import { logger } from '../logger'
import { getConfig } from '../config'

let bot: TelegramBot | null = null

export function initTelegram(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const cfg = getConfig()
  if (!token || !cfg.telegram.enabled) {
    logger.info('Telegram bot disabled or no token configured')
    return
  }
  bot = new TelegramBot(token, { polling: true })
  logger.info('Telegram bot started')

  bot.on('message', (msg) => {
    const chatId = String(msg.chat.id)
    const allowed = cfg.telegram.allowedChatIds
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

async function handleCommand(chatId: string, text: string): Promise<void> {
  if (!bot) return
  if (text === '/status') {
    await bot.sendMessage(chatId, 'Status: evload running ✅')
  } else if (text === '/help') {
    await bot.sendMessage(chatId, '/status - get status\n/help - this message')
  }
}

export async function sendTelegramNotification(message: string): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAT_ID
  const cfg = getConfig()
  if (!bot || !chatId || !cfg.telegram.enabled) {
    logger.debug('Telegram notification skipped - bot not running, no chat ID, or telegram disabled')
    return
  }
  try {
    await bot.sendMessage(chatId, message)
    logger.info(`Telegram notification sent: ${message}`)
  } catch (err) {
    logger.error('Failed to send Telegram notification', { err })
  }
}

export function stopTelegram(): void {
  if (bot) {
    bot.stopPolling().catch(() => {})
    bot = null
    logger.info('Telegram bot stopped')
  }
}
