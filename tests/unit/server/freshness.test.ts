/**
 * P2-07 — history depth + freshness helpers + stale simulation.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  ageSeconds,
  applyIndexerStaleStatus,
  buildDataFreshness,
  buildStatefulEnvelope,
  computeHistoryDepthDays,
  DEFAULT_INDEXER_INTERVAL_MINUTES,
  getIndexerWatermarkIso,
  historyDepthDaysFromEarliest,
  indexerPollCadenceMs,
  isWatermarkStale,
  loadHistoryDepthDaysByValidator,
  STALE_CADENCE_MULTIPLIER,
  staleThresholdMs,
} from '../../../server/src/freshness.js'
import { buildObservationsForValidator } from '../../../server/src/observationsApi.js'
import {
  loadObservationSummaries,
  persistScheduleAdherence,
  computeScheduleAdherence,
} from '../../../server/src/observationScoring.js'
import { persistPayoutRuns, type PayoutRun } from '../../../server/src/payoutClassifier.js'
import { toListItem, type ValidatorRow } from '../../../server/src/validatorSync.js'

const VALIDATOR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const RECIPIENT = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002'
const TX_A = 'a'.repeat(64)
const TX_B = 'b'.repeat(64)
const EARLIEST = '2026-01-01T00:00:00.000Z'
const LATER = '2026-01-15T00:00:00.000Z'
// Fixed "now": 30 days after earliest.
const NOW_MS = Date.parse('2026-01-31T00:00:00.000Z')

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function openTempDb() {
  const directory = mkdtempSync(join(tmpdir(), 'steakout-freshness-'))
  tempDirs.push(directory)
  const path = join(directory, 'test.sqlite')
  const database = openDatabase(path)
  return { database, path, directory }
}

function insertValidator(
  database: ReturnType<typeof openDatabase>,
  overrides: Partial<{
    address: string
    reward_address: string
    schedule_every_hours: number | null
    payout_schedule_declared: string | null
    registry_updated_at: string | null
  }> = {},
): void {
  database.prepare(`
    INSERT INTO validators (
      address, name, reward_address, is_listed,
      payout_schedule_declared, schedule_every_hours, registry_updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(
    overrides.address ?? VALIDATOR,
    'Test Validator',
    overrides.reward_address ?? REWARD,
    'payout_schedule_declared' in overrides
      ? overrides.payout_schedule_declared
      : 'Every 12 hours',
    'schedule_every_hours' in overrides ? overrides.schedule_every_hours : 12,
    overrides.registry_updated_at ?? '2026-01-20T00:00:00.000Z',
  )
}

function insertCursor(
  database: ReturnType<typeof openDatabase>,
  updatedAt: string,
  address = REWARD,
): void {
  database.prepare(`
    INSERT INTO index_cursors (source, address, last_block, last_tx_hash, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('rpc:main', address, 100, TX_A, updatedAt)
}

function makeRun(overrides: Partial<PayoutRun> & { firstTxHash: string; startedAt?: string }): PayoutRun {
  const first = overrides.firstTxHash
  const startedAt = overrides.startedAt ?? EARLIEST
  return {
    startedAt,
    endedAt: overrides.endedAt ?? startedAt,
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

describe('freshness pure helpers', () => {
  it('ageSeconds floors to whole seconds and never goes negative', () => {
    expect(ageSeconds('2026-01-31T00:00:00.000Z', NOW_MS)).toBe(0)
    expect(ageSeconds('2026-01-30T23:59:00.000Z', NOW_MS)).toBe(60)
    expect(ageSeconds('2026-02-01T00:00:00.000Z', NOW_MS)).toBe(0)
    expect(ageSeconds(null, NOW_MS)).toBe(0)
    expect(ageSeconds('not-a-date', NOW_MS)).toBe(0)
  })

  it('historyDepthDaysFromEarliest is earliest → now in fractional days', () => {
    expect(historyDepthDaysFromEarliest(EARLIEST, NOW_MS)).toBeCloseTo(30, 5)
    expect(historyDepthDaysFromEarliest(LATER, NOW_MS)).toBeCloseTo(16, 5)
    expect(historyDepthDaysFromEarliest(null, NOW_MS)).toBe(0)
  })

  it('indexerPollCadenceMs clamps INDEXER_INTERVAL_MINUTES to 30–180', () => {
    expect(indexerPollCadenceMs({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_INDEXER_INTERVAL_MINUTES * 60_000,
    )
    expect(indexerPollCadenceMs({ INDEXER_INTERVAL_MINUTES: '45' })).toBe(45 * 60_000)
    expect(indexerPollCadenceMs({ INDEXER_INTERVAL_MINUTES: '10' })).toBe(30 * 60_000)
    expect(indexerPollCadenceMs({ INDEXER_INTERVAL_MINUTES: '999' })).toBe(180 * 60_000)
  })

  it('stale when watermark older than 2× poll cadence', () => {
    const cadence = 45 * 60_000
    const threshold = staleThresholdMs(cadence)
    expect(threshold).toBe(STALE_CADENCE_MULTIPLIER * cadence)

    const fresh = new Date(NOW_MS - cadence).toISOString()
    const justStale = new Date(NOW_MS - threshold - 1).toISOString()
    const veryStale = new Date(NOW_MS - threshold * 3).toISOString()

    expect(isWatermarkStale(fresh, NOW_MS, cadence)).toBe(false)
    expect(isWatermarkStale(justStale, NOW_MS, cadence)).toBe(true)
    expect(isWatermarkStale(veryStale, NOW_MS, cadence)).toBe(true)
    expect(isWatermarkStale(null, NOW_MS, cadence)).toBe(false)
  })

  it('applyIndexerStaleStatus never upgrades unavailable', () => {
    const cadence = 45 * 60_000
    const staleIso = new Date(NOW_MS - staleThresholdMs(cadence) - 1_000).toISOString()
    expect(
      applyIndexerStaleStatus('ok', { nowMs: NOW_MS, watermarkIso: staleIso, pollCadenceMs: cadence }),
    ).toBe('stale')
    expect(
      applyIndexerStaleStatus('partial', {
        nowMs: NOW_MS,
        watermarkIso: staleIso,
        pollCadenceMs: cadence,
      }),
    ).toBe('stale')
    expect(
      applyIndexerStaleStatus('unavailable', {
        nowMs: NOW_MS,
        watermarkIso: staleIso,
        pollCadenceMs: cadence,
      }),
    ).toBe('unavailable')
  })

  it('buildStatefulEnvelope fills complete API.md §1 shape', () => {
    const envelope = buildStatefulEnvelope({
      updatedAt: LATER,
      source: 'indexer',
      status: 'ok',
      data: { hello: true },
      nowMs: NOW_MS,
      historyDepthDays: 16,
    })
    expect(envelope).toEqual({
      updatedAt: LATER,
      source: 'indexer',
      status: 'ok',
      dataFreshness: { ageSeconds: ageSeconds(LATER, NOW_MS), historyDepthDays: 16 },
      data: { hello: true },
    })
  })
})

describe('history depth from indexed data', () => {
  it('computeHistoryDepthDays uses earliest payout-run → now', () => {
    const { database } = openTempDb()
    insertValidator(database)
    persistPayoutRuns(database, {
      validatorAddress: VALIDATOR,
      runs: [
        makeRun({ firstTxHash: TX_A, startedAt: EARLIEST }),
        makeRun({ firstTxHash: TX_B, startedAt: LATER }),
      ],
    })

    const depth = computeHistoryDepthDays(database, {
      validatorAddress: VALIDATOR,
      rewardAddress: REWARD,
      nowMs: NOW_MS,
    })
    expect(depth).toBeCloseTo(30, 5)
  })

  it('computeHistoryDepthDays falls back to outbound txs when no runs', () => {
    const { database } = openTempDb()
    insertValidator(database)
    database.prepare(`
      INSERT INTO transactions (
        hash, from_address, to_address, value_luna, fee_luna,
        block_number, timestamp, execution_result, raw_json
      ) VALUES (?, ?, ?, 1, 0, 1, ?, 'ok', '{}')
    `).run(TX_A, REWARD, RECIPIENT, EARLIEST)

    const depth = computeHistoryDepthDays(database, {
      validatorAddress: VALIDATOR,
      rewardAddress: REWARD,
      nowMs: NOW_MS,
    })
    expect(depth).toBeCloseTo(30, 5)
  })

  it('loadHistoryDepthDaysByValidator + loadObservationSummaries surface depth', () => {
    const { database } = openTempDb()
    insertValidator(database)
    persistPayoutRuns(database, {
      validatorAddress: VALIDATOR,
      runs: [makeRun({ firstTxHash: TX_A, startedAt: EARLIEST })],
    })

    const batch = loadHistoryDepthDaysByValidator(database, NOW_MS)
    const key = VALIDATOR.replace(/\s+/g, '').toUpperCase()
    expect(batch.get(key)).toBeCloseTo(30, 5)

    // Runs only (no adherence): still reports depth for list/detail.
    const summaries = loadObservationSummaries(database, { nowMs: NOW_MS })
    expect(summaries.get(key)?.historyDepthDays).toBeCloseTo(30, 5)
    expect(summaries.get(key)?.lastObservedAt).toBeTruthy()

    const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
    const item = toListItem(row, summaries.get(key))
    expect(item.observation.historyDepthDays).toBeCloseTo(30, 5)
  })

  it('observations envelope exposes historyDepthDays + complete envelope', () => {
    const { database } = openTempDb()
    insertValidator(database)
    persistPayoutRuns(database, {
      validatorAddress: VALIDATOR,
      runs: [makeRun({ firstTxHash: TX_A, startedAt: EARLIEST })],
    })
    const result = computeScheduleAdherence({
      everyHours: 12,
      declaredSchedule: 'Every 12 hours',
      runStarts: [EARLIEST],
      analysisEnd: LATER,
    })
    persistScheduleAdherence(database, {
      validatorAddress: VALIDATOR,
      result,
      observedAt: result.payload.window.to,
    })

    const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
    const envelope = buildObservationsForValidator(database, row, { nowMs: NOW_MS })

    expect(envelope).toMatchObject({
      source: 'indexer',
      status: 'ok',
    })
    expect(typeof envelope.updatedAt).toBe('string')
    expect(envelope.dataFreshness.historyDepthDays).toBeCloseTo(30, 5)
    expect(typeof envelope.dataFreshness.ageSeconds).toBe('number')
    expect(envelope.data.observationStatus).toBe(result.status)
  })
})

describe('stale indexer simulation', () => {
  it('stale watermark → observations status stale + accurate ageSeconds', () => {
    const { database } = openTempDb()
    insertValidator(database)
    persistPayoutRuns(database, {
      validatorAddress: VALIDATOR,
      runs: [makeRun({ firstTxHash: TX_A, startedAt: EARLIEST })],
    })

    // Default cadence 45 min → stale after 90 min.
    const cadenceMs = indexerPollCadenceMs({ INDEXER_INTERVAL_MINUTES: '45' })
    const watermarkMs = NOW_MS - staleThresholdMs(cadenceMs) - 30_000
    const watermarkIso = new Date(watermarkMs).toISOString()
    insertCursor(database, watermarkIso)

    const prev = process.env.INDEXER_INTERVAL_MINUTES
    process.env.INDEXER_INTERVAL_MINUTES = '45'
    try {
      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row, { nowMs: NOW_MS })

      expect(getIndexerWatermarkIso(database)).toBe(watermarkIso)
      expect(envelope.status).toBe('stale')
      // Age is measured from watermark when present.
      expect(envelope.dataFreshness.ageSeconds).toBe(ageSeconds(watermarkIso, NOW_MS))
      expect(envelope.dataFreshness.ageSeconds).toBeGreaterThan(
        Math.floor(staleThresholdMs(cadenceMs) / 1000),
      )
      expect(envelope.dataFreshness.historyDepthDays).toBeCloseTo(30, 5)
    } finally {
      if (prev === undefined) delete process.env.INDEXER_INTERVAL_MINUTES
      else process.env.INDEXER_INTERVAL_MINUTES = prev
    }
  })

  it('fresh watermark keeps status ok', () => {
    const { database } = openTempDb()
    insertValidator(database)
    persistPayoutRuns(database, {
      validatorAddress: VALIDATOR,
      runs: [makeRun({ firstTxHash: TX_A, startedAt: EARLIEST })],
    })
    // 10 minutes ago — well within 2×45min.
    insertCursor(database, new Date(NOW_MS - 10 * 60_000).toISOString())

    const prev = process.env.INDEXER_INTERVAL_MINUTES
    process.env.INDEXER_INTERVAL_MINUTES = '45'
    try {
      const row = database.prepare('SELECT * FROM validators WHERE address = ?').get(VALIDATOR) as ValidatorRow
      const envelope = buildObservationsForValidator(database, row, { nowMs: NOW_MS })
      expect(envelope.status).toBe('partial') // runs without adherence → partial
      expect(envelope.dataFreshness.ageSeconds).toBeLessThan(15 * 60)
    } finally {
      if (prev === undefined) delete process.env.INDEXER_INTERVAL_MINUTES
      else process.env.INDEXER_INTERVAL_MINUTES = prev
    }
  })

  it('buildDataFreshness prefers ageFromIso for ageSeconds', () => {
    const watermark = new Date(NOW_MS - 3_600_000).toISOString()
    const freshness = buildDataFreshness({
      updatedAt: new Date(NOW_MS).toISOString(),
      nowMs: NOW_MS,
      ageFromIso: watermark,
      historyDepthDays: 14,
    })
    expect(freshness.ageSeconds).toBe(3600)
    expect(freshness.historyDepthDays).toBe(14)
  })
})
