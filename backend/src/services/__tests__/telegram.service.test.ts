import { getConfig } from '../../config'
import { getTelegramPrerequisiteStatus } from '../telegram.service'

jest.mock('../../config', () => ({
  getConfig: jest.fn(),
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('telegram.service token source', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN
  const originalChat = process.env.TELEGRAM_CHAT_ID

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  })

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken
    }

    if (originalChat === undefined) {
      delete process.env.TELEGRAM_CHAT_ID
    } else {
      process.env.TELEGRAM_CHAT_ID = originalChat
    }
  })

  test('requires bot token from env and ignores legacy config token field', () => {
    mockedGetConfig.mockReturnValue({
      telegram: {
        enabled: true,
        botToken: 'legacy-config-token',
        allowedChatIds: ['12345'],
      },
    } as never)

    const status = getTelegramPrerequisiteStatus()
    expect(status.ok).toBe(false)
    expect(status.missing).toContain('bot_token_missing')
  })

  test('does not report bot token missing when env token is present', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-only-token'

    mockedGetConfig.mockReturnValue({
      telegram: {
        enabled: true,
        botToken: 'legacy-config-token',
        allowedChatIds: ['12345'],
      },
    } as never)

    const status = getTelegramPrerequisiteStatus()
    expect(status.missing).not.toContain('bot_token_missing')
  })
})
