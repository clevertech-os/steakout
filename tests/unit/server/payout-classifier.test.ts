import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  CALC_VERSION,
  DEFAULT_RUN_WINDOW_MINUTES,
  PAYOUT_RUN_OBSERVATION_TYPE,
  classifyPayoutRunsForRewardAddress,
  groupPayoutRuns,
  latestObservationCalcVersion,
  listPayoutRunObservations,
  normalizeSchedule,
  normalizeScheduleHours,
  persistPayoutRuns,
  type PayoutTransaction,
} from '../../../server/src/payoutClassifier.js'

const BASE_TIME = Date.parse('2026-08-01T00:00:00.000Z')
const VALIDATOR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const RECIPIENT_A = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002'
const RECIPIENT_B = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0003'

function transaction(overrides: Partial<PayoutTransaction> = {}): PayoutTransaction {
  return {
    hash: 'a'.repeat(64),
    toAddress: RECIPIENT_A,
    valueLuna: 100_000,
    blockNumber: 100,
    timestamp: new Date(BASE_TIME).toISOString(),
    executionResult: 'ok',
    ...overrides,
  }
}

function at(minutes: number, hash: string): PayoutTransaction {
  return transaction({
    hash: hash.repeat(64).slice(0, 64),
    timestamp: new Date(BASE_TIME + minutes * 60_000).toISOString(),
    blockNumber: 100 + minutes,
  })
}

function insertValidator(
  database: ReturnType<typeof openDatabase>,
  address = VALIDATOR,
  rewardAddress = REWARD,
): void {
  database.prepare(`
    INSERT INTO validators (address, name, reward_address, is_listed)
    VALUES (?, 'Test Validator', ?, 1)
  `).run(address, rewardAddress)
}

function insertTx(
  database: ReturnType<typeof openDatabase>,
  tx: PayoutTransaction,
  fromAddress = REWARD,
): void {
  database.prepare(`
    INSERT INTO transactions (
      hash, from_address, to_address, value_luna, fee_luna, block_number,
      timestamp, execution_result, raw_json
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, '{}')
  `).run(
    tx.hash,
    fromAddress,
    tx.toAddress,
    tx.valueLuna,
    tx.blockNumber,
    tx.timestamp,
    tx.executionResult,
  )
}

describe('groupPayoutRuns', () => {
  it('returns no runs for empty input', () => {
    expect(groupPayoutRuns([])).toEqual([])
  })

  it('groups a single transaction into a single one-transaction run', () => {
    const tx = transaction()
    const runs = groupPayoutRuns([tx])

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      startedAt: tx.timestamp,
      endedAt: tx.timestamp,
      txCount: 1,
      recipientCount: 1,
      firstBlock: tx.blockNumber,
      lastBlock: tx.blockNumber,
      firstTxHash: tx.hash,
      lastTxHash: tx.hash,
      txHashes: [tx.hash],
      totalValueLuna: tx.valueLuna,
    })
  })

  it('keeps a gap of exactly one window inside the same run', () => {
    const runs = groupPayoutRuns([at(0, 'a'), at(DEFAULT_RUN_WINDOW_MINUTES, 'b')])

    expect(runs).toHaveLength(1)
    expect(runs[0]?.txCount).toBe(2)
  })

  it('splits a gap of one millisecond beyond the window into two runs', () => {
    const beyond = transaction({
      hash: 'b'.repeat(64),
      timestamp: new Date(BASE_TIME + DEFAULT_RUN_WINDOW_MINUTES * 60_000 + 1).toISOString(),
    })
    const runs = groupPayoutRuns([at(0, 'a'), beyond])

    expect(runs).toHaveLength(2)
    expect(runs[0]?.txCount).toBe(1)
    expect(runs[1]?.txCount).toBe(1)
  })

  it('chains transactions across gaps each within the window (sliding window)', () => {
    // 0 → 50 → 100 minutes: each gap is within 60 minutes, but the run spans
    // 100 minutes in total. Sliding semantics keep them in a single run.
    const runs = groupPayoutRuns([at(0, 'a'), at(50, 'b'), at(100, 'c')])

    expect(runs).toHaveLength(1)
    expect(runs[0]?.txCount).toBe(3)
    expect(runs[0]?.startedAt).toBe(at(0, 'a').timestamp)
    expect(runs[0]?.endedAt).toBe(at(100, 'c').timestamp)
  })

  it('splits runs at large gaps and preserves chronological order', () => {
    const runs = groupPayoutRuns([at(12 * 60, 'c'), at(0, 'a'), at(10, 'b'), at(30 * 60, 'd')])

    expect(runs).toHaveLength(3)
    expect(runs.map((run) => run.txCount)).toEqual([2, 1, 1])
    expect(runs[0]?.firstTxHash).toBe(at(0, 'a').hash)
    expect(runs[0]?.lastTxHash).toBe(at(10, 'b').hash)
    expect(runs[1]?.startedAt).toBe(at(12 * 60, 'c').timestamp)
    expect(runs[2]?.startedAt).toBe(at(30 * 60, 'd').timestamp)
  })

  it('excludes failed and reverted transactions from grouping', () => {
    const failed = transaction({ hash: 'f'.repeat(64), executionResult: 'failed' })
    const reverted = transaction({ hash: 'e'.repeat(64), executionResult: 'reverted' })
    const runs = groupPayoutRuns([failed, at(0, 'a'), reverted])

    expect(runs).toHaveLength(1)
    expect(runs[0]?.txHashes).toEqual([at(0, 'a').hash])
  })

  it('returns no runs when every transaction failed or reverted', () => {
    const runs = groupPayoutRuns([
      transaction({ hash: 'f'.repeat(64), executionResult: 'failed' }),
      transaction({ hash: 'e'.repeat(64), executionResult: 'reverted' }),
    ])
    expect(runs).toEqual([])
  })

  it('counts distinct recipients while keeping every transaction hash', () => {
    const same = at(1, 'b')
    const runs = groupPayoutRuns([at(0, 'a'), same, transaction({
      hash: 'c'.repeat(64),
      toAddress: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0003',
      timestamp: new Date(BASE_TIME + 2 * 60_000).toISOString(),
    })])

    expect(runs).toHaveLength(1)
    expect(runs[0]?.txCount).toBe(3)
    expect(runs[0]?.recipientCount).toBe(2)
    expect(runs[0]?.txHashes).toHaveLength(3)
  })

  it('orders transactions sharing a timestamp deterministically by hash', () => {
    const first = transaction({ hash: '1'.repeat(64) })
    const second = transaction({ hash: '2'.repeat(64) })
    const runs = groupPayoutRuns([second, first])

    expect(runs).toHaveLength(1)
    expect(runs[0]?.firstTxHash).toBe(first.hash)
    expect(runs[0]?.lastTxHash).toBe(second.hash)
  })

  it('respects a custom window size', () => {
    const runs = groupPayoutRuns([at(0, 'a'), at(10, 'b')], { windowMinutes: 5 })

    expect(runs).toHaveLength(2)
  })

  it('throws on a malformed timestamp instead of mis-grouping', () => {
    expect(() => groupPayoutRuns([transaction({ timestamp: 'not-a-date' })])).toThrow(/timestamp is malformed/)
  })
})

describe('normalizeSchedule', () => {
  it.each([
    ['hourly', 1],
    ['Hourly', 1],
    ['HOURLY!', 1],
    [' hourly. ', 1],
    ['every 12 hours', 12],
    ['Every 12 hours', 12],
    ['Every 12 hours.', 12],
    ['  every 12 hours  ', 12],
    ['every 1 hour', 1],
    ['every 3 hours', 3],
    ['Every 4 hours', 4],
    ['every 0.5 hours', 0.5],
    ['every-12-hours', 12],
    ['every 12 hrs', 12],
    ['every 12 hr', 12],
    ['every 6 h', 6],
    ['Every 3 hrs.', 3],
    ['daily', 24],
    ['Daily', 24],
    ['daily.', 24],
    ['twice daily', 12],
    ['Twice  Daily', 12],
    ['twice-daily', 12],
    ['TWICE DAILY!', 12],
    // Hour-level cron (calc_version 2)
    ['0 * * * *', 1],
    ['0 */6 * * *', 6],
    ['0 */12 * * *', 12],
    ['0 0 * * *', 24],
  ])('normalizes %j to everyHours=%s', (raw, hours) => {
    const result = normalizeSchedule(raw)
    expect(result).toEqual({ normalizable: true, everyHours: hours, raw })
    expect(normalizeScheduleHours(raw)).toBe(hours)
  })

  it.each([
    // Minute-level and free-text — non-normalizable
    'Approx. every ~6hrs',
    'Every 1 minute',
    'Every minute',
    'Payouts over 10 NIM are instant when NimiqPocket is elected .',
    // Ambiguous / rejected cron
    '* * * * *',
    '*/5 * * * *',
    '0 12 * * *',
    '0 */6 * * 1',
    '15 * * * *',
    '0 0 1 * *',
    // Other rejection cases
    '',
    '   ',
    'weekly',
    'every day',
    'every twelve hours',
    'every 0 hours',
    'every -3 hours',
    'every hours',
    'instant',
    'when elected',
  ])('refuses to normalize %j (raw preserved)', (raw) => {
    const result = normalizeSchedule(raw)
    expect(result).toEqual({ normalizable: false, everyHours: null, raw })
    expect(normalizeScheduleHours(raw)).toBeNull()
  })

  it('refuses null and undefined schedules', () => {
    expect(normalizeSchedule(null)).toEqual({
      normalizable: false,
      everyHours: null,
      raw: null,
    })
    expect(normalizeSchedule(undefined)).toEqual({
      normalizable: false,
      everyHours: null,
      raw: null,
    })
    expect(normalizeScheduleHours(null)).toBeNull()
    expect(normalizeScheduleHours(undefined)).toBeNull()
  })

  it('classifies every distinct P0-05 wild-observed schedule string', () => {
    // From docs/spikes/validators-api.md § Raw Schedule Inventory (calc_version 2)
    const inventory: Array<{ raw: string; everyHours: number | null }> = [
      { raw: '0 * * * *', everyHours: 1 },
      { raw: '0 */6 * * *', everyHours: 6 },
      { raw: 'Approx. every ~6hrs', everyHours: null },
      { raw: 'Every 1 minute', everyHours: null },
      { raw: 'Every 12 hours', everyHours: 12 },
      { raw: 'Every 3 hours', everyHours: 3 },
      { raw: 'Every 4 hours', everyHours: 4 },
      { raw: 'Every minute', everyHours: null },
      {
        raw: 'Payouts over 10 NIM are instant when NimiqPocket is elected .',
        everyHours: null,
      },
    ]

    for (const entry of inventory) {
      const result = normalizeSchedule(entry.raw)
      if (entry.everyHours === null) {
        expect(result.normalizable).toBe(false)
        expect(result.everyHours).toBeNull()
      } else {
        expect(result.normalizable).toBe(true)
        expect(result.everyHours).toBe(entry.everyHours)
      }
      expect(result.raw).toBe(entry.raw)
    }
  })
})

describe('payout-run persistence', () => {
  const databases: Array<ReturnType<typeof openDatabase>> = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  function db(): ReturnType<typeof openDatabase> {
    const database = openDatabase(':memory:')
    databases.push(database)
    return database
  }

  it('persists runs with window, counts, block range, and tx hashes', () => {
    const database = db()
    insertValidator(database)
    const txs = [
      at(0, 'a'),
      transaction({
        hash: 'b'.repeat(64),
        toAddress: RECIPIENT_B,
        timestamp: new Date(BASE_TIME + 10 * 60_000).toISOString(),
        blockNumber: 110,
      }),
      at(120, 'c'),
    ]
    for (const tx of txs) insertTx(database, tx)

    const result = classifyPayoutRunsForRewardAddress(database, REWARD)
    expect(result.skipped).toBe(false)
    expect(result.runCount).toBe(2)
    expect(result.inserted).toBe(2)

    const observations = listPayoutRunObservations(database, VALIDATOR)
    expect(observations).toHaveLength(2)
    expect(observations[0]?.payload).toMatchObject({
      windowStart: txs[0]?.timestamp,
      windowEnd: txs[1]?.timestamp,
      txCount: 2,
      recipientCount: 2,
      blockRange: [100, 110],
      windowMinutes: DEFAULT_RUN_WINDOW_MINUTES,
    })
    expect(observations[0]?.payload.txHashes).toEqual([txs[0]?.hash, txs[1]?.hash])
    expect(observations[1]?.payload.txCount).toBe(1)
    expect(observations[1]?.calcVersion).toBe(CALC_VERSION)
    expect(observations[0]?.sourceTxHash).toBe(txs[0]?.hash)
  })

  it('re-running classification over the same data produces no duplicate runs', () => {
    const database = db()
    insertValidator(database)
    for (const tx of [at(0, 'a'), at(10, 'b'), at(200, 'c')]) insertTx(database, tx)

    const first = classifyPayoutRunsForRewardAddress(database, REWARD)
    const second = classifyPayoutRunsForRewardAddress(database, REWARD)

    expect(first.runCount).toBe(2)
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.removed).toBe(0)
    expect(second.runCount).toBe(2)

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM validator_observations
      WHERE observation_type = ? AND calc_version = ?
    `).get(PAYOUT_RUN_OBSERVATION_TYPE, CALC_VERSION) as { count: number }
    expect(count.count).toBe(2)
  })

  it('updates an existing run payload when new txs join the same run', () => {
    const database = db()
    insertValidator(database)
    insertTx(database, at(0, 'a'))

    expect(classifyPayoutRunsForRewardAddress(database, REWARD).runCount).toBe(1)
    expect(listPayoutRunObservations(database, VALIDATOR)[0]?.payload.txCount).toBe(1)

    insertTx(database, at(30, 'b'))
    const again = classifyPayoutRunsForRewardAddress(database, REWARD)
    expect(again.runCount).toBe(1)
    expect(again.updated).toBe(1)
    expect(again.inserted).toBe(0)

    const runs = listPayoutRunObservations(database, VALIDATOR)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.payload.txCount).toBe(2)
    expect(runs[0]?.payload.txHashes).toHaveLength(2)
  })

  it('all run tx hashes resolve to transactions rows', () => {
    const database = db()
    insertValidator(database)
    const txs = [at(0, 'a'), at(5, 'b'), at(200, 'c')]
    for (const tx of txs) insertTx(database, tx)

    classifyPayoutRunsForRewardAddress(database, REWARD)
    const runs = listPayoutRunObservations(database, VALIDATOR)
    const known = new Set(
      (database.prepare('SELECT hash FROM transactions').all() as Array<{ hash: string }>)
        .map((row) => row.hash),
    )

    for (const run of runs) {
      expect(run.payload.txHashes.length).toBeGreaterThan(0)
      for (const hash of run.payload.txHashes) {
        expect(known.has(hash)).toBe(true)
      }
    }
  })

  it('retains old calc_version rows; list defaults to latest version', () => {
    const database = db()
    insertValidator(database)
    for (const tx of [at(0, 'a'), at(200, 'b')]) insertTx(database, tx)

    classifyPayoutRunsForRewardAddress(database, REWARD, { calcVersion: 1 })
    classifyPayoutRunsForRewardAddress(database, REWARD, { calcVersion: 2 })

    const total = database.prepare(`
      SELECT COUNT(*) AS count FROM validator_observations
      WHERE observation_type = ?
    `).get(PAYOUT_RUN_OBSERVATION_TYPE) as { count: number }
    expect(total.count).toBe(4)

    expect(latestObservationCalcVersion(database, PAYOUT_RUN_OBSERVATION_TYPE, VALIDATOR)).toBe(2)
    const latest = listPayoutRunObservations(database, VALIDATOR)
    expect(latest).toHaveLength(2)
    expect(latest.every((row) => row.calcVersion === 2)).toBe(true)

    const v1 = listPayoutRunObservations(database, VALIDATOR, { calcVersion: 1 })
    expect(v1).toHaveLength(2)
    expect(v1.every((row) => row.calcVersion === 1)).toBe(true)
  })

  it('skips cleanly when no validator row exists (FK-safe hook)', () => {
    const database = db()
    insertTx(database, at(0, 'a'))

    const result = classifyPayoutRunsForRewardAddress(database, REWARD)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('no-validator-row')
    expect(result.runCount).toBe(0)

    const count = database.prepare('SELECT COUNT(*) AS count FROM validator_observations').get() as {
      count: number
    }
    expect(count.count).toBe(0)
  })

  it('persistPayoutRuns alone is idempotent for identical run sets', () => {
    const database = db()
    insertValidator(database)
    const runs = groupPayoutRuns([at(0, 'a'), at(200, 'b')])

    const first = persistPayoutRuns(database, { validatorAddress: VALIDATOR, runs })
    const second = persistPayoutRuns(database, { validatorAddress: VALIDATOR, runs })

    expect(first.inserted).toBe(2)
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.removed).toBe(0)
    expect(listPayoutRunObservations(database, VALIDATOR)).toHaveLength(2)
  })

  it('handles single-tx run, window boundary, and gaps > window when persisted', () => {
    const database = db()
    insertValidator(database)
    // single-tx run, then exactly window (same run), then beyond window (new run)
    const exactWindow = transaction({
      hash: 'b'.repeat(64),
      timestamp: new Date(BASE_TIME + DEFAULT_RUN_WINDOW_MINUTES * 60_000).toISOString(),
      blockNumber: 160,
    })
    const beyond = transaction({
      hash: 'c'.repeat(64),
      timestamp: new Date(BASE_TIME + DEFAULT_RUN_WINDOW_MINUTES * 60_000 + 1).toISOString(),
      blockNumber: 161,
    })
    const later = at(300, 'd')
    for (const tx of [at(0, 'a'), exactWindow, beyond, later]) insertTx(database, tx)

    const result = classifyPayoutRunsForRewardAddress(database, REWARD)
    // gap-based: a + exactWindow = run1; beyond alone starts run2? 
    // beyond is 1ms after exactWindow which is within 60min of exactWindow
    // chain: a (0) -> exactWindow (60min) same run; beyond (60min+1ms) within window of exactWindow → same run
    // later (300min) > window from beyond → new run
    // Wait: beyond - exactWindow = 1ms, so joins. later - beyond = large gap.
    // So 2 runs: [a, exactWindow, beyond] and [later]
    // Actually re-read groupPayoutRuns: gap from previous only.
    // a -> exactWindow: 60min exactly, windowMs = 60*60000, entry - previous > windowMs? 60min is NOT > 60min, so same run.
    // exactWindow -> beyond: 1ms, same run
    // beyond -> later: ~240 min, new run
    expect(result.runCount).toBe(2)

    const runs = listPayoutRunObservations(database, VALIDATOR)
    expect(runs[0]?.payload.txCount).toBe(3)
    expect(runs[1]?.payload.txCount).toBe(1)
  })
})
