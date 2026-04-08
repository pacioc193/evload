import express from 'express'
import request from 'supertest'

const mockExecFile = jest.fn()

jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}))

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

describe('garage routes', () => {
  const originalGarageMode = process.env.GARAGE_MODE

  async function createApp() {
    jest.resetModules()
    const module = await import('../garage.routes')
    const app = express()
    app.use(express.json())
    app.use('/', module.default)
    return app
  }

  beforeEach(() => {
    mockExecFile.mockReset()
  })

  afterEach(() => {
    process.env.GARAGE_MODE = originalGarageMode
  })

  test('POST /display with GARAGE_MODE=true and {on:true} calls vcgencmd and returns 200', async () => {
    process.env.GARAGE_MODE = 'true'
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, 'display_power=1', ''))
    const app = await createApp()

    const res = await request(app)
      .post('/display')
      .send({ on: true })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.on).toBe(true)
    expect(mockExecFile).toHaveBeenCalledWith(
      'vcgencmd',
      ['display_power', '1'],
      expect.any(Function)
    )
  })

  test('POST /display with GARAGE_MODE not set returns 403', async () => {
    delete process.env.GARAGE_MODE
    const app = await createApp()

    const res = await request(app)
      .post('/display')
      .send({ on: true })
      .expect(403)

    expect(res.body.error).toBeDefined()
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  test('POST /display with invalid body returns 400', async () => {
    process.env.GARAGE_MODE = 'true'
    const app = await createApp()

    const res = await request(app)
      .post('/display')
      .send({ on: 'yes' })
      .expect(400)

    expect(res.body.error).toBeDefined()
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  test('POST /display when vcgencmd returns ENOENT error returns 503', async () => {
    process.env.GARAGE_MODE = 'true'
    const enoentErr = Object.assign(new Error('not found'), { code: 'ENOENT' })
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(enoentErr, '', ''))
    const app = await createApp()

    const res = await request(app)
      .post('/display')
      .send({ on: true })
      .expect(503)

    expect(res.body.error).toMatch(/vcgencmd not found/i)
  })

  test('POST /display when vcgencmd returns other error returns 500', async () => {
    process.env.GARAGE_MODE = 'true'
    const genericErr = new Error('vcgencmd failed')
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(genericErr, '', 'some stderr'))
    const app = await createApp()

    const res = await request(app)
      .post('/display')
      .send({ on: false })
      .expect(500)

    expect(res.body.error).toBeDefined()
  })
})
