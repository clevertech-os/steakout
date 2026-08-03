import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import {
  clearIndexCursors,
  configuredRewardAddresses,
  indexerOptionsFromEnv,
  PayoutIndexer,
  startPayoutIndexerScheduler,
} from './payoutIndexer.js'
import { getBlockNumber } from './nimiq-rpc.js'
import { mountProfileShareRoutes } from './profileMeta.js'
import { startValidatorSyncScheduler } from './validatorSync.js'

const port = Number(process.env.PORT ?? 3000)
const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)

// One-shot: clear cursors so the next cycle re-walks as much history as INDEXER_MAX_PAGES allows.
// INSERT OR IGNORE keeps already-stored txs. Turn off after the deep backfill finishes.
if (process.env.INDEXER_REBACKFILL === 'true') {
  const cleared = clearIndexCursors(database)
  console.log(JSON.stringify({ indexer: 'rebackfill', clearedCursors: cleared }))
}

const indexerEnv = indexerOptionsFromEnv()
const payoutIndexer = new PayoutIndexer({
  database,
  rpcUrl: process.env.NIMIQ_RPC_URL,
  // Omit pinned URL so NIMIQ_RPC_URL_FALLBACK failover applies (P3-03).
  getCurrentBlock: () => getBlockNumber(),
  pageSize: indexerEnv.pageSize,
  maxPages: indexerEnv.maxPages,
  addressConcurrency: indexerEnv.addressConcurrency,
})
const app = createApp({
  database,
  getIndexerHealth: () => payoutIndexer.getHealth(),
})

let payoutScheduler: { stop: () => void } | undefined
if (process.env.INDEXER_ENABLED === 'true') {
  const configuredInterval = Number(process.env.INDEXER_INTERVAL_MINUTES ?? 45)
  // Allow a longer first-cycle window when deep-backfilling many addresses.
  const intervalMinutes = Number.isFinite(configuredInterval)
    ? Math.min(180, Math.max(30, configuredInterval))
    : 45
  const seeds = configuredRewardAddresses(database)
  console.log(
    JSON.stringify({
      indexer: 'enabled',
      rewardAddresses: seeds.length,
      maxPages: indexerEnv.maxPages,
      pageSize: indexerEnv.pageSize,
      addressConcurrency: indexerEnv.addressConcurrency,
      intervalMinutes,
    }),
  )
  payoutScheduler = startPayoutIndexerScheduler(
    payoutIndexer,
    () => configuredRewardAddresses(database),
    intervalMinutes * 60_000,
  )
}

// Registry sync (P1-04): hourly by default; disable with VALIDATORS_SYNC_ENABLED=false.
let validatorScheduler: { stop: () => void } | undefined
if (process.env.VALIDATORS_SYNC_ENABLED !== 'false') {
  const configuredHours = Number(process.env.VALIDATORS_SYNC_INTERVAL_HOURS ?? 1)
  const intervalMs = (Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours
    : 1) * 60 * 60_000
  validatorScheduler = startValidatorSyncScheduler(
    {
      database,
      fetchOptions: {
        apiUrl: process.env.VALIDATORS_API_URL,
        rpcUrl: process.env.NIMIQ_RPC_URL,
      },
    },
    intervalMs,
  )
}

const clientDist = new URL('../../client/dist/', import.meta.url)
const clientIndexHtml = fileURLToPath(new URL('../../client/dist/index.html', import.meta.url))

// P2-16: path-based profile URLs with OG/Twitter meta for crawlers (before static).
mountProfileShareRoutes(app, {
  database,
  indexHtmlPath: clientIndexHtml,
  publicOrigin: process.env.PUBLIC_APP_URL,
})

app.use(express.static(clientDist.pathname))
app.get(['/spike', '/spike/', '/spike/staking-methods', '/spike/staking-methods/'], (_request, response) => {
  response.sendFile(clientIndexHtml)
})

const server = app.listen(port, () => {
  console.log(`Steakout server listening on http://localhost:${port}`)
})

function shutdown() {
  payoutScheduler?.stop()
  validatorScheduler?.stop()
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
