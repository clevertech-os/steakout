/**
 * P2-06 — observations evidence endpoint, network summary, explorer redirect.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { openDatabase } from '../../../server/src/db.js'
import {
  buildNimiqExplorerUrl,
  resolveExplorerNetwork,
} from '../../../server/src/explorer.js'
import {
  BASE_OBSERVATION_LIMITATIONS,
  buildNetworkSummary,
  buildObservationsForValidator,
  DEFAULT_RUNS_PAGE_SIZE,
} from '../../../server/src/observationsApi.js'
import {
  persistScheduleAdherence,
  computeScheduleAdherence,
  computeRecipientCoverage,
  persistRecipientCoverage,
} from '../../../server/src/observationScoring.js'
import {
  persistPayoutRuns,
  type PayoutRun,
} from '../../../server/src/payoutClassifier.js'
import { clearRateLimitBuckets } from '../../../server/src/rate-limit.js'
import { clearPublicResponseCache } from '../../../server/src/responseCache.js'
import { toListItem, type ValidatorRow } from '../../../server/src/validatorSync.js'
import { loadObservationSummaries } from '../../../server/src/observationScoring.js'

const VALIDATOR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const RECIPIENT = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002'
const TX_A = 'a'.repeat(64)
const TX_B = 'b'.repeat(64)
const TX_C = 'c'.repeat(64)
const ANCHOR = '2026-01-01T00:00:00.000Z'

interface TestHttp {
  directory: string
  database: ReturnType<typeof openDatabase>
  baseUrl: string
  server: Server
}

function insertValidator(
  database: ReturnType<typeof openDatabase>,
  overrides: Partial<{
    address: string
    name: string
    reward_address: string
    is_listed: number
    payout_schedule_declared: string | null
    schedule_every_hours: number | null
    stake_luna: number | null
    dominance_ratio: number | null
    registry_updated_at: string | null
  }> = {},
): void {
  database.prepare(`
    INSERT INTO validators (
      address, name, reward_address, is_listed,
      payout_schedule_declared, schedule_every_hours,
      stake_luna, dominance_ratio, registry_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.address ?? VALIDATOR,
    overrides.name ?? 'Test Validator',
    overrides.reward_address ?? REWARD,
    overrides.is_listed ?? 1,
    // Allow explicit nulls (?? would replace them with defaults).
    'payout_schedule_declared' in overrides
      ? overrides.payout_schedule_declared
      : 'Every 12 hours',
    'schedule_every_hours' in overrides ? overrides.schedule_every_hours : 12,
    'stake_luna' in overrides ? overrides.stake_luna : 1_000_000,
    'dominance_ratio' in overrides ? overrides.dominance_ratio : 0.02,
    overrides.registry_updated_at ?? '2026-08-01T00:00:00.000Z',
  )
}

function makeRun(overrides: Partial<PayoutRun> & { firstTxHash: string }): PayoutRun {
  const first = overrides.firstTxHash
  return {
    startedAt: overrides.startedAt ?? ANCHOR,
    endedAt: overrides.endedAt ?? ANCHOR,
    txCount: overrides.txCount ?? 1,
    recipientCount: overrides.recipientCount ?? 1,
    recipients: overrides.recipients ?? [RECIPIENT],
    firstBlock: overrides.firstBlock ?? 100,
    lastBlock: overrides.lastBlock ?? 100,
    firstTxHash: first,
    lastTxHash: overrides.lastTxHash ?? first,
    txHashes: overrides.txHashes ?? [first],
    totalValueLuna: overrides.totalValueLuna ?? 100_000,
  }
}

async function startApp(database: ReturnType<typeof openDatabase>): Promise<TestHttp> {
  clearRateLimitBuckets()
  clearPublicResponseCache()
  const directory = mkdtempSync(join(tmpdir(), 'steakout-obs-'))
  // Re-open is awkward — caller owns db path. Use provided db with temp dir for cleanup only.
  const app = createApp({ database })
  const server = createServer(app)
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP address')
  return {
    directory,
    database,
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  }
}

async function closeApp(ctx: TestHttp, removeDbPath?: string): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    ctx.server.close((error) => (error ? reject(error) : resolveClose()))
  })
  ctx.database.close()
  if (removeDbPath) {
    rmSync(removeDbPath, { recursive: true, force: true })
  }
  rmSync(ctx.directory, { recursive: true, force: true })
  clearPublicResponseCache()
  clearRateLimitBuckets()
}

function openTempDb(): { database: ReturnType<typeof openDatabase>; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'steakout-obs-db-'))
  const path = join(directory, 'test.sqlite')
  return { database: openDatabase(path), path: directory }
}

describe('explorer network resolution', () => {
  it('maps main/mainnet → mainnet and test/testnet → testnet', () => {
    expect(resolveExplorerNetwork('main')).toBe('mainnet')
    expect(resolveExplorerNetwork('mainnet')).toBe('mainnet')
    expect(resolveExplorerNetwork('test')).toBe('testnet')
    expect(resolveExplorerNetwork('testnet')).toBe('testnet')
  })

  it('buildNimiqExplorerUrl is network-aware', () => {
    expect(buildNimiqExplorerUrl(TX_A, 'mainnet')).toBe(`https://nimiq.watch/#${TX_A.toUpperCase()}`)
    expect(buildNimiqExplorerUrl(TX_A, 'testnet')).toBe(`https://test.nimiq.watch/#${TX_A.toUpperCase()}`)
    expect(buildNimiqExplorerUrl(`0x${TX_A}`, 'mainnet')).toBe(`https://nimiq.watch/#${TX_A.toUpperCase()}`)
  })
})

describe('buildObservationsForValidator', () => {
  it('returns HTTP-200 style insufficient-data payload for empty history', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database)
      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row, {
        nowMs: Date.parse('2026-08-03T00:00:00.000Z'),
      })

      expect(envelope.status).toBe('ok')
      expect(envelope.data.observationStatus).toBe('insufficient-data')
      expect(envelope.data.runs).toEqual([])
      expect(envelope.data.nextCursor).toBeNull()
      expect(envelope.data.schedule).toEqual({
        declared: 'Every 12 hours',
        normalized: { everyHours: 12 },
        normalizable: true,
      })
      expect(envelope.data.window).toEqual({
        from: null,
        to: null,
        expectedWindows: 0,
        observedWindows: 0,
      })
      expect(envelope.dataFreshness.historyDepthDays).toBe(0)
      expect(envelope.data.limitations).toEqual(
        expect.arrayContaining([...BASE_OBSERVATION_LIMITATIONS, 'insufficient-history']),
      )
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('marks non-normalizable empty history as unavailable', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database, {
        payout_schedule_declared: 'Every 1 minute',
        schedule_every_hours: null,
      })
      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row)
      expect(envelope.data.observationStatus).toBe('unavailable')
      expect(envelope.data.schedule.normalizable).toBe(false)
      expect(envelope.data.schedule.normalized).toBeNull()
      expect(envelope.data.limitations).toContain('schedule-cannot-be-normalized')
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('includes run tx hashes, block ranges, and null coverage when P2-04 absent', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database)
      persistPayoutRuns(database, {
        validatorAddress: VALIDATOR,
        runs: [
          makeRun({
            firstTxHash: TX_A,
            startedAt: ANCHOR,
            endedAt: ANCHOR,
            txCount: 2,
            recipientCount: 2,
            recipients: [RECIPIENT, 'NQ00 0000 0000 0000 0000 0000 0000 0000 0003'],
            firstBlock: 100,
            lastBlock: 105,
            lastTxHash: TX_B,
            txHashes: [TX_A, TX_B],
          }),
        ],
      })

      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row)
      expect(envelope.data.runs).toHaveLength(1)
      const run = envelope.data.runs[0]!
      expect(run.txHashes).toEqual([TX_A, TX_B])
      expect(run.blockRange).toEqual([100, 105])
      expect(run.recipientCount).toBe(2)
      expect(run.knownStakersCovered).toBeNull()
      expect(run.knownStakersTotal).toBeNull()
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('enriches runs with recipient-coverage when present', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database)
      persistPayoutRuns(database, {
        validatorAddress: VALIDATOR,
        runs: [
          makeRun({
            firstTxHash: TX_A,
            startedAt: ANCHOR,
            endedAt: ANCHOR,
            txHashes: [TX_A],
            firstBlock: 10,
            lastBlock: 10,
          }),
        ],
      })
      const coverage = computeRecipientCoverage({
        windowStart: ANCHOR,
        windowEnd: ANCHOR,
        recipientCount: 1,
        recipients: [RECIPIENT],
        firstTxHash: TX_A,
        blockRange: [10, 10],
        knownStakers: [RECIPIENT, 'NQ00 0000 0000 0000 0000 0000 0000 0000 0009'],
      })
      persistRecipientCoverage(database, {
        validatorAddress: VALIDATOR,
        coverages: [coverage],
      })

      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row)
      expect(envelope.data.runs[0]?.knownStakersCovered).toBe(1)
      expect(envelope.data.runs[0]?.knownStakersTotal).toBe(2)
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('uses schedule-adherence status and window when present', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database)
      const starts = Array.from({ length: 30 }, (_, i) =>
        new Date(Date.parse(ANCHOR) + i * 12 * 3_600_000).toISOString(),
      )
      const result = computeScheduleAdherence({
        everyHours: 12,
        declaredSchedule: 'Every 12 hours',
        runStarts: starts,
        analysisEnd: new Date(Date.parse(ANCHOR) + 30 * 12 * 3_600_000).toISOString(),
      })
      persistScheduleAdherence(database, {
        validatorAddress: VALIDATOR,
        result,
        observedAt: result.payload.window.to,
      })

      const nowMs = Date.parse(result.payload.window.to)
      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row, { nowMs })
      expect(envelope.data.observationStatus).toBe(result.status)
      expect(envelope.data.window).toEqual(result.payload.window)
      // P2-07: historyDepthDays is earliest → now (falls back to adherence window).
      expect(envelope.dataFreshness.historyDepthDays).toBeCloseTo(
        result.payload.historyDepthDays,
        5,
      )
      expect(envelope.source).toBe('indexer')
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('paginates runs with cursor / nextCursor', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database)
      const runs: PayoutRun[] = [TX_A, TX_B, TX_C].map((hash, i) =>
        makeRun({
          firstTxHash: hash,
          startedAt: new Date(Date.parse(ANCHOR) + i * 3_600_000).toISOString(),
          endedAt: new Date(Date.parse(ANCHOR) + i * 3_600_000).toISOString(),
          firstBlock: 100 + i,
          lastBlock: 100 + i,
          txHashes: [hash],
        }),
      )
      persistPayoutRuns(database, { validatorAddress: VALIDATOR, runs })

      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const page1 = buildObservationsForValidator(database, row, {
        cursorOffset: 0,
        limit: 2,
      })
      expect(page1.data.runs).toHaveLength(2)
      expect(page1.data.nextCursor).toBeTruthy()
      // Newest first → TX_C then TX_B
      expect(page1.data.runs[0]?.txHashes).toEqual([TX_C])
      expect(page1.data.runs[1]?.txHashes).toEqual([TX_B])

      const page2 = buildObservationsForValidator(database, row, {
        cursorOffset: 2,
        limit: 2,
      })
      expect(page2.data.runs).toHaveLength(1)
      expect(page2.data.runs[0]?.txHashes).toEqual([TX_A])
      expect(page2.data.nextCursor).toBeNull()
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })
})

describe('buildNetworkSummary', () => {
  it('counts listed vs observable separately and reports normalizable stake ratio', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database, {
        address: VALIDATOR,
        is_listed: 1,
        stake_luna: 100,
        schedule_every_hours: 12,
        dominance_ratio: 0.02,
      })
      insertValidator(database, {
        address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002',
        is_listed: 0,
        stake_luna: 300,
        schedule_every_hours: null,
        dominance_ratio: 0.12,
        payout_schedule_declared: null,
      })
      insertValidator(database, {
        address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0003',
        is_listed: 1,
        stake_luna: 100,
        schedule_every_hours: 3,
        dominance_ratio: 0.005,
      })

      const { envelope } = buildNetworkSummary(database)
      expect(envelope.status).toBe('ok')
      expect(envelope.data.validators.listed).toBe(2)
      expect(envelope.data.validators.observable).toBe(3)
      expect(envelope.data.totalStakeLuna).toBe(500)
      // Normalizable: 100 + 100 = 200 / 500 = 0.4
      expect(envelope.data.stakeWithNormalizableScheduleRatio).toBeCloseTo(0.4)
      expect(envelope.data.dominanceBuckets.length).toBeGreaterThanOrEqual(3)
      const top = envelope.data.dominanceBuckets.find((b) => b.label === '10%+')
      expect(top?.count).toBe(1)
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })
})

describe('list/detail observation wiring', () => {
  it('loadObservationSummaries feeds toListItem status + lastObservedAt', () => {
    const { database, path } = openTempDb()
    try {
      insertValidator(database)
      persistPayoutRuns(database, {
        validatorAddress: VALIDATOR,
        runs: [makeRun({ firstTxHash: TX_A, startedAt: ANCHOR, endedAt: ANCHOR })],
      })
      const result = computeScheduleAdherence({
        everyHours: 12,
        declaredSchedule: 'Every 12 hours',
        runStarts: [ANCHOR],
        analysisEnd: new Date(Date.parse(ANCHOR) + 20 * 24 * 3_600_000).toISOString(),
      })
      persistScheduleAdherence(database, {
        validatorAddress: VALIDATOR,
        result,
        observedAt: result.payload.window.to,
      })

      const summaries = loadObservationSummaries(database)
      const summary = summaries.get(VALIDATOR.replace(/\s+/g, '').toUpperCase())
      expect(summary).toBeTruthy()
      expect(summary!.status).toBe(result.status)
      expect(summary!.lastObservedAt).toBeTruthy()

      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const item = toListItem(row, summary)
      expect(item.observation.status).toBe(result.status)
      expect(item.observation.lastObservedAt).toBe(summary!.lastObservedAt)
      expect(item.observation.historyDepthDays).toBe(summary!.historyDepthDays)
    } finally {
      database.close()
      rmSync(path, { recursive: true, force: true })
    }
  })
})

describe('HTTP endpoints', () => {
  const contexts: Array<{ ctx: TestHttp; dbDir: string }> = []

  afterEach(async () => {
    while (contexts.length > 0) {
      const entry = contexts.pop()
      if (entry) await closeApp(entry.ctx, entry.dbDir)
    }
    delete process.env.NIMIQ_NETWORK
  })

  it('GET /api/validators/:address/observations returns envelope + empty history 200', async () => {
    const { database, path } = openTempDb()
    insertValidator(database)
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(
      `${ctx.baseUrl}/api/validators/${encodeURIComponent(VALIDATOR)}/observations`,
    )
    expect(response.status).toBe(200)
    const body = await response.json() as {
      updatedAt: string
      source: string
      status: string
      dataFreshness: { ageSeconds: number; historyDepthDays: number }
      data: {
        observationStatus: string
        schedule: { declared: string | null; normalized: { everyHours: number } | null; normalizable: boolean }
        window: { from: string | null; to: string | null; expectedWindows: number; observedWindows: number }
        runs: unknown[]
        limitations: string[]
        nextCursor: string | null
      }
    }

    expect(body.status).toBe('ok')
    expect(body.dataFreshness).toMatchObject({ historyDepthDays: 0 })
    expect(body.data.observationStatus).toBe('insufficient-data')
    expect(body.data.runs).toEqual([])
    expect(body.data.limitations.length).toBeGreaterThan(0)
    expect(typeof body.dataFreshness.ageSeconds).toBe('number')
  })

  it('GET /api/validators/:address/observations returns runs with tx hashes', async () => {
    const { database, path } = openTempDb()
    insertValidator(database)
    persistPayoutRuns(database, {
      validatorAddress: VALIDATOR,
      runs: [
        makeRun({
          firstTxHash: TX_A,
          txHashes: [TX_A, TX_B],
          firstBlock: 1,
          lastBlock: 9,
          recipientCount: 5,
        }),
      ],
    })
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(
      `${ctx.baseUrl}/api/validators/${encodeURIComponent(VALIDATOR)}/observations?limit=10`,
    )
    expect(response.status).toBe(200)
    const body = await response.json() as {
      data: {
        runs: Array<{
          txHashes: string[]
          blockRange: [number, number]
          recipientCount: number
          knownStakersCovered: number | null
          knownStakersTotal: number | null
        }>
      }
    }
    expect(body.data.runs[0]?.txHashes).toEqual([TX_A, TX_B])
    expect(body.data.runs[0]?.blockRange).toEqual([1, 9])
    expect(body.data.runs[0]?.knownStakersCovered).toBeNull()
    expect(body.data.runs[0]?.knownStakersTotal).toBeNull()
  })

  it('GET /api/validators/:address/observations 404 for unknown validator', async () => {
    const { database, path } = openTempDb()
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(
      `${ctx.baseUrl}/api/validators/${encodeURIComponent(VALIDATOR)}/observations`,
    )
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATOR_NOT_FOUND')
  })

  it('GET /api/network/summary returns listed vs observable counts', async () => {
    const { database, path } = openTempDb()
    insertValidator(database, { is_listed: 1, stake_luna: 50 })
    insertValidator(database, {
      address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002',
      is_listed: 0,
      stake_luna: 150,
      schedule_every_hours: null,
    })
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(`${ctx.baseUrl}/api/network/summary`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      data: {
        validators: { listed: number; observable: number }
        totalStakeLuna: number
        dominanceBuckets: unknown[]
        stakeWithNormalizableScheduleRatio: number | null
        indexer: { addressesWithCursor: number }
      }
    }
    expect(body.data.validators.listed).toBe(1)
    expect(body.data.validators.observable).toBe(2)
    expect(body.data.totalStakeLuna).toBe(200)
    expect(Array.isArray(body.data.dominanceBuckets)).toBe(true)
    expect(body.data.indexer.addressesWithCursor).toBe(0)
  })

  it('GET /api/explorer/transaction/:hash redirects 302 on mainnet', async () => {
    process.env.NIMIQ_NETWORK = 'mainnet'
    const { database, path } = openTempDb()
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(
      `${ctx.baseUrl}/api/explorer/transaction/${TX_A}`,
      { redirect: 'manual' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`https://nimiq.watch/#${TX_A.toUpperCase()}`)
  })

  it('GET /api/explorer/transaction/:hash uses testnet base when NIMIQ_NETWORK=testnet', async () => {
    process.env.NIMIQ_NETWORK = 'testnet'
    const { database, path } = openTempDb()
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(
      `${ctx.baseUrl}/api/explorer/transaction/${TX_A}`,
      { redirect: 'manual' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`https://test.nimiq.watch/#${TX_A.toUpperCase()}`)
  })

  it('GET /api/explorer/transaction/:hash?format=json returns url payload', async () => {
    process.env.NIMIQ_NETWORK = 'main'
    const { database, path } = openTempDb()
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(
      `${ctx.baseUrl}/api/explorer/transaction/${TX_A}?format=json`,
    )
    expect(response.status).toBe(200)
    const body = await response.json() as { url: string; network: string }
    expect(body.network).toBe('mainnet')
    expect(body.url).toBe(`https://nimiq.watch/#${TX_A.toUpperCase()}`)
  })

  it('GET /api/explorer/transaction/:hash rejects malformed hash', async () => {
    const { database, path } = openTempDb()
    const ctx = await startApp(database)
    contexts.push({ ctx, dbDir: path })

    const response = await fetch(`${ctx.baseUrl}/api/explorer/transaction/not-a-hash`)
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION')
  })
})

describe('DEFAULT_RUNS_PAGE_SIZE', () => {
  it('is a positive integer', () => {
    expect(DEFAULT_RUNS_PAGE_SIZE).toBeGreaterThan(0)
  })
})
