import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { getBlockNumber } from './nimiq-rpc.js'

export function createApp() {
  const app = express()
  const configuredOrigins = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim())

  app.use(helmet())
  app.use(
    cors({
      credentials: true,
      origin: configuredOrigins?.length ? configuredOrigins : true,
    }),
  )
  app.use(express.json())

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true })
  })

  app.get('/api/spike/block-number', async (_request, response) => {
    try {
      const blockNumber = await getBlockNumber()

      response.json({
        updatedAt: new Date().toISOString(),
        source: 'rpc',
        status: 'ok',
        dataFreshness: { ageSeconds: 0 },
        data: { blockNumber },
      })
    } catch {
      response.status(503).json({
        error: {
          code: 'RPC_UNAVAILABLE',
          message: 'The Nimiq block-number probe is unavailable.',
        },
      })
    }
  })

  return app
}
