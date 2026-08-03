import 'dotenv/config'
import express from 'express'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import {
  configuredRewardAddresses,
  PayoutIndexer,
  startPayoutIndexerScheduler,
} from './payoutIndexer.js'
import { getBlockNumber } from './nimiq-rpc.js'

const port = Number(process.env.PORT ?? 3000)
const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)
const payoutIndexer = new PayoutIndexer({
  database,
  rpcUrl: process.env.NIMIQ_RPC_URL,
  getCurrentBlock: () => getBlockNumber(process.env.NIMIQ_RPC_URL),
})
const app = createApp({ getIndexerHealth: () => payoutIndexer.getHealth() })

let payoutScheduler: { stop: () => void } | undefined
if (process.env.INDEXER_ENABLED === 'true') {
  const configuredInterval = Number(process.env.INDEXER_INTERVAL_MINUTES ?? 45)
  const intervalMinutes = Number.isFinite(configuredInterval)
    ? Math.min(60, Math.max(30, configuredInterval))
    : 45
  payoutScheduler = startPayoutIndexerScheduler(
    payoutIndexer,
    () => configuredRewardAddresses(database),
    intervalMinutes * 60_000,
  )
}

const clientDist = new URL('../../client/dist/', import.meta.url)
app.use(express.static(clientDist.pathname))
app.get(['/spike', '/spike/', '/spike/staking-methods', '/spike/staking-methods/'], (_request, response) => {
  response.sendFile(new URL('../../client/dist/index.html', import.meta.url).pathname)
})

const server = app.listen(port, () => {
  console.log(`Steakout server listening on http://localhost:${port}`)
})

function shutdown() {
  payoutScheduler?.stop()
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
