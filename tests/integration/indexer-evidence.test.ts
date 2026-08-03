/**
 * P2-15 — Integration: indexer pagination/retry/restart, dupes, observations contract, explorer links.
 * Offline only: mockRpc / injected fetch; no live network.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/src/app.js'
import { openDatabase } from '../../server/src/db.js'
import {
  buildNimiqExplorerUrl,
  buildNimiqAddressExplorerUrl,
  resolveExplorerNetwork,
} from '../../server/src/explorer.js'
import { classifyObservationsForRewardAddress } from '../../server/src/observationScoring.js'
import { PayoutIndexer } from '../../server/src/payoutIndexer.js'
import { clearRateLimitBuckets } from '../../server/src/rate-limit.js'
import { clearPublicResponseCache } from '../../server/src/responseCache.js'
import type { NimiqTransaction } from '../../server/src/nimiq-rpc.js'
import { createMockRpc } from '../helpers/mockRpc.js'

const REWARD = 'NQ00 0000 0000 0000 0000 0000 0000 0000 000A'
const VALIDATOR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 000B'
const RECIPIENT = 'NQ00 0000 0000 0000 0000 0000 0000 0000 000C'

const databases: Array<{ close: () => void }> = []
const temporaryDirectories: string[] = []
const servers: Server[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  clearRateLimitBuckets()
  clearPublicResponseCache()
  for (const server of servers.splice(0)) {
    server.close()
  }
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tx(
  hash: string,
  blockNumber: number,
  overrides: Partial<NimiqTransaction> = {},
): NimiqTransaction {
  return {
    hash,
    blockNumber,
    timestamp: 1_700_000_000_000 + blockNumber * 1000,
    from: REWARD,
    to: RECIPIENT,
    value: 1_000_000,
    fee: 0,
    executionResult: true,
    ...overrides,
  }
}

function insertValidator(
  database: ReturnType<typeof openDatabase>,
  address = VALIDATOR,
  reward = REWARD,
): void {
  database
    .prepare(
      `INSERT INTO validators (
        address, name, reward_address, is_listed,
        payout_type_declared, payout_schedule_declared, schedule_every_hours,
        registry_updated_at
      ) VALUES (?, ?, ?, 1, 'direct', 'Every 12 hours', 12, datetime('now'))`,
    )
    .run(address, 'Integration Validator', reward)
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('expected TCP listen address')
  return { baseUrl: `http://127.0.0.1:${addr.port}`, server }
}

function openTempDb(): ReturnType<typeof openDatabase> {
  const directory = mkdtempSync(join(tmpdir(), 'steakout-p2-15-'))
  temporaryDirectories.push(directory)
  const database = openDatabase(join(directory, 'test.sqlite'))
  databases.push(database)
  return database
}

// ---------------------------------------------------------------------------
// Indexer: multi-page, retry, restart, duplicates
// ---------------------------------------------------------------------------

describe('P2-15 integration — indexer', () => {
  it('paginates newest-first, advances cursor, and resumes without refetch overlap after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'steakout-p2-15-restart-'))
    temporaryDirectories.push(directory)
    const filename = join(directory, 'indexer.sqlite')

    const page1 = [tx('a'.repeat(64), 300), tx('b'.repeat(64), 299)]
    const page2 = [tx('c'.repeat(64), 200), tx('d'.repeat(64), 199)]
    // After restart: newer tip + previously known tip (must not re-insert)
    const afterRestart = [
      tx('e'.repeat(64), 400),
      tx('a'.repeat(64), 300), // already stored; cursor boundary
    ]

    const firstDb = openDatabase(filename)
    databases.push(firstDb)
    insertValidator(firstDb)

    let fetchCalls = 0
    const firstIndexer = new PayoutIndexer({
      backfillDays: 0,
      database: firstDb,
      pageSize: 2,
      maxPages: 10,
      maxAttempts: 1,
      fetchTransactions: async (_address, _max, startAt) => {
        fetchCalls += 1
        if (startAt === null) return page1
        if (startAt === page1[page1.length - 1]!.hash) return page2
        return []
      },
      getCurrentBlock: async () => 500,
    })

    const [firstResult] = await firstIndexer.runCycle([REWARD])
    expect(firstResult?.errors).toEqual([])
    expect(firstResult?.inserted).toBe(4)
    expect(firstResult?.cursorAdvanced).toBe(true)
    expect(firstDb.prepare('SELECT COUNT(*) AS c FROM transactions').get()).toEqual({ c: 4 })
    const cursorAfterFirst = firstDb
      .prepare('SELECT last_block, last_tx_hash FROM index_cursors WHERE address = ?')
      .get(REWARD) as { last_block: number; last_tx_hash: string }
    expect(cursorAfterFirst).toEqual({ last_block: 300, last_tx_hash: 'a'.repeat(64) })

    firstDb.close()
    databases.splice(databases.indexOf(firstDb), 1)

    // Process restart: reopen same file
    const secondDb = openDatabase(filename)
    databases.push(secondDb)
    let resumeCalls = 0
    const secondIndexer = new PayoutIndexer({
      backfillDays: 0,
      database: secondDb,
      pageSize: 2,
      maxPages: 10,
      maxAttempts: 1,
      fetchTransactions: async (_address, _max, startAt) => {
        resumeCalls += 1
        if (startAt === null) return afterRestart
        return []
      },
      getCurrentBlock: async () => 500,
    })

    const [resumeResult] = await secondIndexer.runCycle([REWARD])
    expect(resumeResult?.errors).toEqual([])
    // Only the new tip row inserts; boundary tx already present
    expect(resumeResult?.inserted).toBe(1)
    expect(secondDb.prepare('SELECT COUNT(*) AS c FROM transactions').get()).toEqual({ c: 5 })
    const cursorAfterResume = secondDb
      .prepare('SELECT last_block, last_tx_hash FROM index_cursors WHERE address = ?')
      .get(REWARD) as { last_block: number; last_tx_hash: string }
    expect(cursorAfterResume.last_block).toBe(400)
    expect(cursorAfterResume.last_tx_hash).toBe('e'.repeat(64))
    expect(fetchCalls).toBeGreaterThanOrEqual(2)
    expect(resumeCalls).toBe(1)
  })

  it('retries a transient first-page failure then succeeds (mockRpc error injection)', async () => {
    const database = openTempDb()
    insertValidator(database)

    const page = [tx('f'.repeat(64), 50), tx('g'.repeat(64), 49)]
    let attempts = 0
    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      pageSize: 2,
      maxPages: 1,
      maxAttempts: 3,
      retryBaseMs: 1,
      retryMaxMs: 5,
      retryJitter: 0,
      sleep: async () => {},
      fetchTransactions: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('temporary RPC blip')
        return page
      },
    })

    const [result] = await indexer.runCycle([REWARD])
    expect(attempts).toBe(3)
    expect(result?.errors).toEqual([])
    expect(result?.inserted).toBe(2)
    expect(database.prepare('SELECT COUNT(*) AS c FROM transactions').get()).toEqual({ c: 2 })
  })

  it('inserts zero new rows when the same RPC page is ingested twice', async () => {
    const database = openTempDb()
    insertValidator(database)

    const rpc = createMockRpc({
      fixtures: {
        getTransactionsByAddress: 'rpc/p0-04-transactions-by-address-page-1-mainnet.json',
      },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    // Fixture uses its own from-addresses; still valid for dedupe by hash
    const fixtureAddress = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
    insertValidator(database, 'NQ00 0000 0000 0000 0000 0000 0000 0000 0099', fixtureAddress)

    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      rpcUrl: 'https://rpc.example.test',
      pageSize: 3,
      maxPages: 1,
    })

    await indexer.runCycle([fixtureAddress])
    const countAfterFirst = (
      database.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }
    ).c
    expect(countAfterFirst).toBeGreaterThan(0)

    await indexer.runCycle([fixtureAddress])
    const countAfterSecond = (
      database.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }
    ).c
    expect(countAfterSecond).toBe(countAfterFirst)
    expect(rpc.getCallCount('getTransactionsByAddress')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Observations contract + evidence / explorer links
// ---------------------------------------------------------------------------

describe('P2-15 integration — observations contract + evidence links', () => {
  it('serves full envelope + run payload shape after index → classify pipeline', async () => {
    const database = openTempDb()
    insertValidator(database)

    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const hashes = {
      r1: '11'.repeat(32),
      r2: '22'.repeat(32),
      r3: '33'.repeat(32),
    }
    // Two runs ~12h apart (within schedule) for classification
    const outbound: NimiqTransaction[] = [
      tx(hashes.r1, 1000, {
        timestamp: t0,
        to: RECIPIENT,
      }),
      tx(hashes.r2, 1001, {
        timestamp: t0 + 60_000,
        to: 'NQ00 0000 0000 0000 0000 0000 0000 0000 000D',
      }),
      tx(hashes.r3, 2000, {
        timestamp: t0 + 12 * 3600_000,
        to: RECIPIENT,
      }),
    ]

    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      pageSize: 10,
      maxPages: 1,
      maxAttempts: 1,
      fetchTransactions: async () => outbound,
      getCurrentBlock: async () => 3000,
    })
    await indexer.runCycle([REWARD])

    // Classify is also hooked from indexer when validator row exists — re-run explicitly for clarity
    classifyObservationsForRewardAddress(database, REWARD)

    const app = createApp({
      database,
      getIndexerHealth: () => ({
        lastRunAt: new Date().toISOString(),
        addressesIndexed: 1,
        lagBlocks: 0,
      }),
    })
    const { baseUrl } = await listen(app)

    const response = await fetch(
      `${baseUrl}/api/validators/${encodeURIComponent(VALIDATOR)}/observations`,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Envelope (API.md §1)
    expect(typeof body.updatedAt).toBe('string')
    expect(body.source).toBeTruthy()
    expect(typeof body.status).toBe('string')
    expect(body.dataFreshness).toEqual(
      expect.objectContaining({
        historyDepthDays: expect.any(Number),
      }),
    )

    const data = body.data as Record<string, unknown>
    expect(data).toBeTruthy()
    expect(typeof data.observationStatus).toBe('string')
    expect(data.schedule).toEqual(
      expect.objectContaining({
        declared: expect.anything(),
        normalizable: expect.any(Boolean),
      }),
    )
    expect(Array.isArray(data.runs)).toBe(true)
    expect(Array.isArray(data.limitations)).toBe(true)
    expect((data.limitations as string[]).length).toBeGreaterThan(0)

    const runs = data.runs as Array<Record<string, unknown>>
    expect(runs.length).toBeGreaterThanOrEqual(1)
    for (const run of runs) {
      expect(typeof run.windowStart === 'string' || run.windowStart === null).toBe(true)
      expect(typeof run.txCount).toBe('number')
      expect(typeof run.recipientCount).toBe('number')
      // Coverage nulls when no known staker set (never invent 0/0)
      expect(run.knownStakersCovered === null || typeof run.knownStakersCovered === 'number').toBe(
        true,
      )
      expect(run.knownStakersTotal === null || typeof run.knownStakersTotal === 'number').toBe(true)
      if (run.knownStakersCovered === null) {
        expect(run.knownStakersTotal).toBeNull()
      }
      expect(Array.isArray(run.txHashes)).toBe(true)
      expect((run.txHashes as string[]).length).toBeGreaterThan(0)
      expect(run.blockRange === null || Array.isArray(run.blockRange)).toBe(true)
    }
  })

  it('returns 200 insufficient-data style payload for empty-history validator', async () => {
    const database = openTempDb()
    insertValidator(database)
    const app = createApp({ database })
    const { baseUrl } = await listen(app)

    const response = await fetch(
      `${baseUrl}/api/validators/${encodeURIComponent(VALIDATOR)}/observations`,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { observationStatus: string; runs: unknown[] } }
    expect(['insufficient-data', 'unavailable']).toContain(body.data.observationStatus)
    expect(body.data.runs).toEqual([])
  })

  it('explorer redirect resolves mainnet and testnet URLs; JSON format returns url', async () => {
    const database = openTempDb()
    const app = createApp({ database })
    const { baseUrl } = await listen(app)
    const hash = 'ab'.repeat(32)

    const previousNetwork = process.env.NIMIQ_NETWORK
    try {
      process.env.NIMIQ_NETWORK = 'main'
      const mainRedirect = await fetch(`${baseUrl}/api/explorer/transaction/${hash}`, {
        redirect: 'manual',
      })
      expect(mainRedirect.status).toBe(302)
      const mainLocation = mainRedirect.headers.get('location')
      expect(mainLocation).toBe(buildNimiqExplorerUrl(hash, 'mainnet'))
      expect(mainLocation).toMatch(/^https:\/\/nimiq\.watch\/#/i)

      process.env.NIMIQ_NETWORK = 'testnet'
      const testRedirect = await fetch(`${baseUrl}/api/explorer/transaction/${hash}`, {
        redirect: 'manual',
      })
      expect(testRedirect.status).toBe(302)
      const testLocation = testRedirect.headers.get('location')
      expect(testLocation).toBe(buildNimiqExplorerUrl(hash, 'testnet'))
      expect(testLocation).toMatch(/^https:\/\/test\.nimiq\.watch\/#/i)

      const json = await fetch(`${baseUrl}/api/explorer/transaction/${hash}?format=json`)
      expect(json.status).toBe(200)
      const payload = (await json.json()) as { url: string; network: string }
      expect(payload.url).toBe(buildNimiqExplorerUrl(hash, 'testnet'))
      expect(resolveExplorerNetwork(payload.network)).toBe('testnet')
    } finally {
      if (previousNetwork === undefined) delete process.env.NIMIQ_NETWORK
      else process.env.NIMIQ_NETWORK = previousNetwork
    }

    // Address explorer builders stay network-correct (used by evidence UI links)
    expect(buildNimiqAddressExplorerUrl(VALIDATOR, 'mainnet')).toContain('nimiq.watch')
    expect(buildNimiqAddressExplorerUrl(VALIDATOR, 'testnet')).toContain('test.nimiq.watch')
  })
})
