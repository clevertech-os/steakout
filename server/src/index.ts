import dotenv from 'dotenv'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

// Load monorepo root `.env` (npm --prefix server runs with cwd=server/).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
dotenv.config({ path: path.join(repoRoot, '.env') })

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
import { resolveValidatorsApiUrl } from './validators-api.js'

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
  backfillDays: indexerEnv.backfillDays,
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
      backfillDays: indexerEnv.backfillDays,
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
  const validatorsApiUrl = resolveValidatorsApiUrl({
    apiUrl: process.env.VALIDATORS_API_URL,
    network: process.env.NIMIQ_NETWORK,
  })
  validatorScheduler = startValidatorSyncScheduler(
    {
      database,
      fetchOptions: {
        apiUrl: validatorsApiUrl,
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

// Hashed Vite assets: long-cache. HTML entry must revalidate so deploys pick up new hashes.
app.use(
  express.static(clientDist.pathname, {
    maxAge: '1y',
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
      }
    },
  }),
)
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
