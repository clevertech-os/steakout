import cors from 'cors'
import express from 'express'
import helmet from 'helmet'

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

  return app
}
