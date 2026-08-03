import 'dotenv/config'
import express from 'express'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const port = Number(process.env.PORT ?? 3000)
const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)
const app = createApp()

const clientDist = new URL('../../client/dist/', import.meta.url)
app.use(express.static(clientDist.pathname))
app.get(['/spike', '/spike/'], (_request, response) => {
  response.sendFile(new URL('../../client/dist/index.html', import.meta.url).pathname)
})

const server = app.listen(port, () => {
  console.log(`Steakout server listening on http://localhost:${port}`)
})

function shutdown() {
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
