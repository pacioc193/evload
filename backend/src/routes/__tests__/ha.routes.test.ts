import express from 'express'
import request from 'supertest'

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    homeAssistant: {
      url: 'http://ha.local:8123',
    },
  })),
}))

jest.mock('../../services/ha.service', () => ({
  saveHaTokenObj: jest.fn(async () => undefined),
  getHaState: jest.fn(() => ({ connected: false, powerW: null, chargerW: null })),
}))

describe('ha routes oauth configuration', () => {
  const originalClientId = process.env.HA_CLIENT_ID
  const originalAppUrl = process.env.APP_URL

  async function createApp() {
    jest.resetModules()
    const module = await import('../ha.routes')
    const app = express()
    app.use(express.json())
    app.use('/', module.default)
    return app
  }

  beforeEach(() => {
    delete process.env.HA_CLIENT_ID
    delete process.env.APP_URL
  })

  afterAll(() => {
    if (originalClientId === undefined) {
      delete process.env.HA_CLIENT_ID
    } else {
      process.env.HA_CLIENT_ID = originalClientId
    }

    if (originalAppUrl === undefined) {
      delete process.env.APP_URL
    } else {
      process.env.APP_URL = originalAppUrl
    }
  })

  test('GET /authorize falls back to localhost when HA_CLIENT_ID is missing', async () => {
    const app = await createApp()

    const res = await request(app)
      .get('/authorize')
      .expect(200)

    expect(res.body.url).toContain('client_id=http%3A%2F%2Flocalhost%3A3001')
  })

  test('GET /authorize returns a valid HA authorize URL when HA_CLIENT_ID is configured', async () => {
    process.env.HA_CLIENT_ID = 'https://evload.local'
    const app = await createApp()

    const res = await request(app)
      .get('/authorize')
      .expect(200)

    expect(res.body.url).toContain('client_id=https%3A%2F%2Fevload.local')
    expect(res.body.url).toContain('/auth/authorize?')
  })

  test('GET /authorize uses APP_URL when HA_CLIENT_ID is not configured', async () => {
    process.env.APP_URL = 'https://evload.example.test/'
    const app = await createApp()

    const res = await request(app)
      .get('/authorize')
      .expect(200)

    expect(res.body.url).toContain('client_id=https%3A%2F%2Fevload.example.test')
    expect(res.body.url).toContain('redirect_uri=https%3A%2F%2Fevload.example.test%2Fapi%2Fha%2Fcallback')
  })
})