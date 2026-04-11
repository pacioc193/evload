import { getConfig } from '../../config'
import { getTelegramPrerequisiteStatus } from '../telegram.service'

jest.mock('../../config', () => ({
  getConfig: jest.fn(),
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('telegram.service token source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('reports bot token missing when cachedBotToken is not set', () => {
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

  test('does not report chat id missing when allowed chat ids are configured', () => {
    mockedGetConfig.mockReturnValue({
      telegram: {
        enabled: true,
        botToken: 'legacy-config-token',
        allowedChatIds: ['12345'],
      },
    } as never)

    const status = getTelegramPrerequisiteStatus()
    expect(status.missing).not.toContain('chat_id_missing')
  })
})
