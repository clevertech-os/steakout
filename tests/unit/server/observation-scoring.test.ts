import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  CALC_VERSION,
  classifyPayoutRunsForRewardAddress,
  groupPayoutRuns,
  persistPayoutRuns,
  type PayoutTransaction,
} from '../../../server/src/payoutClassifier.js'
import {
  MIN_HISTORY_DAYS,
  MIN_HISTORY_DAYS_FOR_GRADE,
  MOSTLY_ON_SCHEDULE_MIN_RATE,
  ON_SCHEDULE_MIN_RATE,
  RECIPIENT_COVERAGE_LIMITATIONS,
  RECIPIENT_COVERAGE_OBSERVATION_TYPE,
  SCHEDULE_ADHERENCE_OBSERVATION_TYPE,
  classifyObservationsForRewardAddress,
  classifyRecipientCoverageForValidator,
  classifyScheduleAdherenceForValidator,
  computeRecipientCoverage,
  computeScheduleAdherence,
  listRecipientCoverageObservations,
  listScheduleAdherenceObservation,
  loadKnownStakerSet,
  mapAdherenceStatus,
  persistRecipientCoverage,
  persistScheduleAdherence,
} from '../../../server/src/observationScoring.js'

const VALIDATOR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const RECIPIENT = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002'
const ANCHOR = '2026-01-01T00:00:00.000Z'

function hoursAfter(hours: number, base = ANCHOR): string {
  return new Date(Date.parse(base) + hours * 3_600_000).toISOString()
}

function daysAfter(days: number, base = ANCHOR): string {
  return hoursAfter(days * 24, base)
}

describe('mapAdherenceStatus (METHODOLOGY.md §3 thresholds)', () => {
  // P2-14 boundary matrix: exactly 95% / 80% and day 7 / 14 floors.
  it('boundary: rate exactly 95% → on-schedule (≥95 band)', () => {
    // 19/20 = 0.95 exactly
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 20,
      historyDepthDays: MIN_HISTORY_DAYS_FOR_GRADE,
      expectedWindows: 20,
      observedWindows: 19,
    })).toBe('on-schedule')

    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 100,
      historyDepthDays: 30,
      expectedWindows: 100,
      observedWindows: 95,
    })).toBe('on-schedule')
  })

  it('boundary: rate just below 95% → mostly-on-schedule (80–95 exclusive upper)', () => {
    // 94/100 = 0.94
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 100,
      historyDepthDays: 30,
      expectedWindows: 100,
      observedWindows: 94,
    })).toBe('mostly-on-schedule')
  })

  it('boundary: rate exactly 80% → mostly-on-schedule (≥80 band)', () => {
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 20,
      historyDepthDays: 30,
      expectedWindows: 20,
      observedWindows: 16, // 80.0%
    })).toBe('mostly-on-schedule')
  })

  it('boundary: rate just below 80% → irregular when ≥14 days history', () => {
    // 799/1000 = 0.799
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 1000,
      historyDepthDays: MIN_HISTORY_DAYS_FOR_GRADE,
      expectedWindows: 1000,
      observedWindows: 799,
    })).toBe('irregular')
  })

  it('boundary: day-6 history → insufficient-data even with perfect rate', () => {
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 12,
      historyDepthDays: 6,
      expectedWindows: 12,
      observedWindows: 12,
    })).toBe('insufficient-data')
  })

  it('boundary: history just below 7 days → insufficient-data', () => {
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 10,
      historyDepthDays: MIN_HISTORY_DAYS - 0.001,
      expectedWindows: 10,
      observedWindows: 10,
    })).toBe('insufficient-data')
  })

  it('boundary: day-7 through day-13 → insufficient-data (no grade before day 14)', () => {
    for (const days of [MIN_HISTORY_DAYS, 10, MIN_HISTORY_DAYS_FOR_GRADE - 0.001]) {
      expect(mapAdherenceStatus({
        normalizable: true,
        runCount: 20,
        historyDepthDays: days,
        expectedWindows: 20,
        observedWindows: 20,
      })).toBe('insufficient-data')
    }
  })

  it('boundary: day-14 history allows graded labels', () => {
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 28,
      historyDepthDays: MIN_HISTORY_DAYS_FOR_GRADE,
      expectedWindows: 28,
      observedWindows: 28,
    })).toBe('on-schedule')

    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 28,
      historyDepthDays: MIN_HISTORY_DAYS_FOR_GRADE,
      expectedWindows: 28,
      observedWindows: 22, // ~78.6%
    })).toBe('irregular')
  })

  it('returns insufficient-data when expectedWindows is 0 (too few windows)', () => {
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 1,
      historyDepthDays: 30,
      expectedWindows: 0,
      observedWindows: 0,
    })).toBe('insufficient-data')
  })

  it('normalizable schedule with zero runs → insufficient-data (not unavailable)', () => {
    expect(mapAdherenceStatus({
      normalizable: true,
      runCount: 0,
      historyDepthDays: 0,
      expectedWindows: 0,
      observedWindows: 0,
    })).toBe('insufficient-data')
  })

  it('never grades a non-normalizable schedule; unavailable only with no runs', () => {
    expect(mapAdherenceStatus({
      normalizable: false,
      runCount: 0,
      historyDepthDays: 30,
      expectedWindows: 0,
      observedWindows: 0,
    })).toBe('unavailable')

    expect(mapAdherenceStatus({
      normalizable: false,
      runCount: 5,
      historyDepthDays: 30,
      expectedWindows: 0,
      observedWindows: 0,
    })).toBe('insufficient-data')
  })

  it('exposes threshold constants matching METHODOLOGY.md §3', () => {
    expect(ON_SCHEDULE_MIN_RATE).toBe(0.95)
    expect(MOSTLY_ON_SCHEDULE_MIN_RATE).toBe(0.8)
    expect(MIN_HISTORY_DAYS).toBe(7)
    expect(MIN_HISTORY_DAYS_FOR_GRADE).toBe(14)
  })
})

describe('computeScheduleAdherence (window math)', () => {
  it('anchors the grid at the first observed run and counts only fully elapsed windows', () => {
    // every 12h; span of exactly 5 full windows + partial → expected 5
    const runStarts = [
      ANCHOR,
      hoursAfter(12),
      hoursAfter(24),
      hoursAfter(36),
      hoursAfter(48),
      hoursAfter(54), // inside trailing partial (window 4 ended at 48h; next due at 60h)
    ]
    const result = computeScheduleAdherence({
      everyHours: 12,
      declaredSchedule: 'Every 12 hours',
      runStarts,
      analysisEnd: hoursAfter(54),
    })

    expect(result.payload.window.from).toBe(ANCHOR)
    expect(result.payload.window.to).toBe(hoursAfter(54))
    expect(result.payload.window.expectedWindows).toBe(4) // floor(54/12)=4
    expect(result.payload.window.observedWindows).toBe(4) // runs at 0,12,24,36,48 → indexes 0..4; only 0..3 count → 4 observed? 
    // index 0: 0h, 1: 12h, 2: 24h, 3: 36h, 4: 48h — index 4 is NOT < expected 4, so excluded
    // observed = indexes 0,1,2,3 = 4
    expect(result.payload.anchorAt).toBe(ANCHOR)
    expect(result.payload.rate).toBe(1)
  })

  it('counts a window as observed when at least one run starts inside it', () => {
    const result = computeScheduleAdherence({
      everyHours: 12,
      runStarts: [ANCHOR, hoursAfter(1), hoursAfter(2), hoursAfter(24)],
      analysisEnd: hoursAfter(36),
    })
    // span 36h → expected 3 windows [0-12), [12-24), [24-36)
    // runs at 0,1,2 → window 0; run at 24 → window 2; window 1 empty
    expect(result.payload.window.expectedWindows).toBe(3)
    expect(result.payload.window.observedWindows).toBe(2)
  })

  it('never grades non-normalizable schedules but still reports runs', () => {
    const result = computeScheduleAdherence({
      everyHours: null,
      declaredSchedule: 'Every 1 minute',
      runStarts: [ANCHOR, hoursAfter(12), hoursAfter(24)],
      analysisEnd: daysAfter(20),
    })
    expect(result.status).toBe('insufficient-data')
    expect(result.payload.normalizable).toBe(false)
    expect(result.payload.runCount).toBe(3)
    expect(result.payload.window.expectedWindows).toBe(0)
    expect(result.payload.window.observedWindows).toBe(0)
  })

  it('returns unavailable when not normalizable and no runs', () => {
    const result = computeScheduleAdherence({
      everyHours: null,
      declaredSchedule: 'Approx. every ~6hrs',
      runStarts: [],
      analysisEnd: daysAfter(20),
    })
    expect(result.status).toBe('unavailable')
    expect(result.payload.runCount).toBe(0)
  })

  it('yields insufficient-data for day-6 history with a perfect run grid', () => {
    // every 12h over 6 days = 12 full windows if analysisEnd = day 6 exactly
    const runStarts = Array.from({ length: 12 }, (_, i) => hoursAfter(i * 12))
    const result = computeScheduleAdherence({
      everyHours: 12,
      runStarts,
      analysisEnd: daysAfter(6),
    })
    expect(result.payload.historyDepthDays).toBeCloseTo(6, 5)
    expect(result.payload.window.expectedWindows).toBe(12)
    expect(result.payload.window.observedWindows).toBe(12)
    expect(result.status).toBe('insufficient-data')
  })

  it('grades on-schedule at day-14 with ≥95% observed', () => {
    // every 12h over 14 days → 28 full windows; 27 observed → 96.4%
    const runStarts = Array.from({ length: 27 }, (_, i) => hoursAfter(i * 12))
    const result = computeScheduleAdherence({
      everyHours: 12,
      declaredSchedule: 'every 12 hours',
      runStarts,
      analysisEnd: daysAfter(14),
    })
    expect(result.payload.historyDepthDays).toBeCloseTo(14, 5)
    expect(result.payload.window.expectedWindows).toBe(28)
    expect(result.payload.window.observedWindows).toBe(27)
    expect(result.payload.rate).toBeCloseTo(27 / 28, 5)
    expect(result.status).toBe('on-schedule')
  })

  it('grades mostly-on-schedule at exactly 80% with day-14 history', () => {
    // 20 windows over enough span; 16 observed = 80%
    const everyHours = 12
    const expected = 20
    const observed = 16
    const runStarts = Array.from({ length: observed }, (_, i) => hoursAfter(i * everyHours))
    const analysisEnd = hoursAfter(expected * everyHours) // exactly 20 full windows
    // history depth = 20*12/24 = 10 days → insufficient. Need ≥14 days.
    // Use longer interval so 20 windows span ≥14 days: everyHours = 14*24/20 = 16.8
    const longEvery = 18
    const longExpected = 20
    const longObserved = 16
    const longStarts = Array.from({ length: longObserved }, (_, i) => hoursAfter(i * longEvery))
    const longEnd = hoursAfter(longExpected * longEvery) // 360h = 15 days
    const result = computeScheduleAdherence({
      everyHours: longEvery,
      runStarts: longStarts,
      analysisEnd: longEnd,
    })
    expect(result.payload.historyDepthDays).toBeGreaterThanOrEqual(14)
    expect(result.payload.window.expectedWindows).toBe(20)
    expect(result.payload.window.observedWindows).toBe(16)
    expect(result.payload.rate).toBeCloseTo(0.8, 5)
    expect(result.status).toBe('mostly-on-schedule')
  })

  it('grades irregular at 79.9% with day-14 history', () => {
    // 1000 fully elapsed windows over exactly 14 days; 799 observed → 79.9%.
    // Use integer hours to avoid float floor artifacts: 1000 * 0.336h is not exact.
    const everyHours = 1 // 1000 hours ≈ 41.67 days ≥ 14
    const expected = 1000
    const observed = 799
    const runStarts = Array.from({ length: observed }, (_, i) => hoursAfter(i * everyHours))
    const analysisEnd = hoursAfter(expected * everyHours)
    const result = computeScheduleAdherence({
      everyHours,
      runStarts,
      analysisEnd,
    })
    expect(result.payload.historyDepthDays).toBeCloseTo(1000 / 24, 5)
    expect(result.payload.historyDepthDays).toBeGreaterThanOrEqual(14)
    expect(result.payload.window.expectedWindows).toBe(1000)
    expect(result.payload.window.observedWindows).toBe(799)
    expect(result.payload.rate).toBeCloseTo(0.799, 5)
    expect(result.status).toBe('irregular')
  })

  it('includes window { from, to, expectedWindows, observedWindows } in payload', () => {
    const result = computeScheduleAdherence({
      everyHours: 24,
      runStarts: [ANCHOR],
      analysisEnd: daysAfter(3),
    })
    expect(result.payload.window).toEqual({
      from: ANCHOR,
      to: daysAfter(3),
      expectedWindows: 3,
      observedWindows: 1,
    })
  })

  it('normalizable schedule with zero runs → insufficient-data + empty window', () => {
    const result = computeScheduleAdherence({
      everyHours: 12,
      declaredSchedule: 'Every 12 hours',
      runStarts: [],
      analysisEnd: daysAfter(20),
    })
    expect(result.status).toBe('insufficient-data')
    expect(result.payload.normalizable).toBe(true)
    expect(result.payload.runCount).toBe(0)
    expect(result.payload.window.expectedWindows).toBe(0)
    expect(result.payload.rate).toBeNull()
  })
})

describe('schedule-adherence persistence', () => {
  const databases: Array<ReturnType<typeof openDatabase>> = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  function db(): ReturnType<typeof openDatabase> {
    const database = openDatabase(':memory:')
    databases.push(database)
    return database
  }

  function insertValidator(
    database: ReturnType<typeof openDatabase>,
    schedule: string | null = 'Every 12 hours',
    everyHours: number | null = 12,
  ): void {
    database.prepare(`
      INSERT INTO validators (
        address, name, reward_address, is_listed,
        payout_schedule_declared, schedule_every_hours
      ) VALUES (?, 'Test', ?, 1, ?, ?)
    `).run(VALIDATOR, REWARD, schedule, everyHours)
  }

  function insertTx(
    database: ReturnType<typeof openDatabase>,
    hours: number,
    index: number,
  ): void {
    const hash = index.toString(16).padStart(64, '0')
    const timestamp = hoursAfter(hours)
    database.prepare(`
      INSERT INTO transactions (
        hash, from_address, to_address, value_luna, fee_luna, block_number,
        timestamp, execution_result, raw_json
      ) VALUES (?, ?, ?, 100000, 0, ?, ?, 'ok', '{}')
    `).run(hash, REWARD, RECIPIENT, 100 + hours, timestamp)
  }

  /**
   * Seed `runCount` runs every 12h starting at ANCHOR, then one freshness
   * marker at exactly day 14 so analysisEnd spans 14 full days / 28 windows
   * (the marker itself sits in the trailing partial window and is not graded).
   */
  function seedPerfectGrid(database: ReturnType<typeof openDatabase>, runCount = 28): void {
    for (let i = 0; i < runCount; i += 1) insertTx(database, i * 12, i)
    // analysisEnd = last outbound; need ≥ 14 days from first run for grading.
    insertTx(database, runCount * 12, runCount) // hour 336 = day 14 for runCount=28
  }

  it('persists a schedule-adherence observation with the mandated window payload', () => {
    const database = db()
    insertValidator(database)
    // 14 days of perfect 12h runs
    seedPerfectGrid(database, 28)

    const runs = classifyPayoutRunsForRewardAddress(database, REWARD)
    // 28 grid runs + 1 day-14 freshness marker (trailing partial window)
    expect(runs.runCount).toBe(29)

    const adherence = classifyScheduleAdherenceForValidator(database, VALIDATOR, {
      rewardAddress: REWARD,
    })
    expect(adherence.skipped).toBe(false)
    expect(adherence.inserted).toBe(1)
    expect(adherence.status).toBe('on-schedule')

    const row = listScheduleAdherenceObservation(database, VALIDATOR)
    expect(row).not.toBeNull()
    expect(row?.status).toBe('on-schedule')
    expect(row?.calcVersion).toBe(CALC_VERSION)
    expect(row?.payload.window.expectedWindows).toBe(28)
    expect(row?.payload.window.observedWindows).toBe(28)
    expect(row?.payload.window.from).toBeTruthy()
    expect(row?.payload.window.to).toBeTruthy()
    expect(row?.payload.normalizable).toBe(true)
    expect(row?.payload.everyHours).toBe(12)
    expect(row?.payload.historyDepthDays).toBeCloseTo(14, 5)
  })

  it('is idempotent on re-classification', () => {
    const database = db()
    insertValidator(database)
    seedPerfectGrid(database, 28)

    classifyPayoutRunsForRewardAddress(database, REWARD)
    const first = classifyScheduleAdherenceForValidator(database, VALIDATOR, {
      rewardAddress: REWARD,
    })
    const second = classifyScheduleAdherenceForValidator(database, VALIDATOR, {
      rewardAddress: REWARD,
    })

    expect(first.inserted).toBe(1)
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.unchanged).toBe(1)

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM validator_observations
      WHERE observation_type = ? AND calc_version = ?
    `).get(SCHEDULE_ADHERENCE_OBSERVATION_TYPE, CALC_VERSION) as { count: number }
    expect(count.count).toBe(1)
  })

  it('combined pipeline classifies runs then adherence', () => {
    const database = db()
    insertValidator(database)
    seedPerfectGrid(database, 28)

    const { runs, adherence } = classifyObservationsForRewardAddress(database, REWARD)
    expect(runs.skipped).toBe(false)
    expect(runs.runCount).toBe(29)
    expect(adherence).not.toBeNull()
    expect(adherence?.status).toBe('on-schedule')
  })

  it('does not grade free-text schedules; still persists runs via pipeline', () => {
    const database = db()
    insertValidator(database, 'Approx. every ~6hrs', null)
    for (let i = 0; i < 10; i += 1) insertTx(database, i * 12, i)

    const { runs, adherence } = classifyObservationsForRewardAddress(database, REWARD)
    expect(runs.runCount).toBe(10)
    expect(adherence?.status).toBe('insufficient-data')
    expect(adherence?.skipped).toBe(false)

    const row = listScheduleAdherenceObservation(database, VALIDATOR)
    expect(row?.payload.normalizable).toBe(false)
    expect(row?.payload.runCount).toBe(10)
    expect(row?.payload.declaredSchedule).toBe('Approx. every ~6hrs')
  })

  it('returns unavailable when schedule not normalizable and no runs', () => {
    const database = db()
    insertValidator(database, 'Payouts over 10 NIM are instant', null)

    const adherence = classifyScheduleAdherenceForValidator(database, VALIDATOR, {
      rewardAddress: REWARD,
    })
    expect(adherence.status).toBe('unavailable')
    const row = listScheduleAdherenceObservation(database, VALIDATOR)
    expect(row?.status).toBe('unavailable')
    expect(row?.payload.runCount).toBe(0)
  })

  it('retain separate calc_versions for adherence rows', () => {
    const database = db()
    insertValidator(database)
    seedPerfectGrid(database, 28)

    classifyPayoutRunsForRewardAddress(database, REWARD, { calcVersion: 1 })
    classifyScheduleAdherenceForValidator(database, VALIDATOR, {
      rewardAddress: REWARD,
      calcVersion: 1,
    })
    classifyPayoutRunsForRewardAddress(database, REWARD, { calcVersion: 2 })
    classifyScheduleAdherenceForValidator(database, VALIDATOR, {
      rewardAddress: REWARD,
      calcVersion: 2,
    })

    const total = database.prepare(`
      SELECT COUNT(*) AS count FROM validator_observations
      WHERE observation_type = ?
    `).get(SCHEDULE_ADHERENCE_OBSERVATION_TYPE) as { count: number }
    expect(total.count).toBe(2)

    const latest = listScheduleAdherenceObservation(database, VALIDATOR)
    expect(latest?.calcVersion).toBe(2)
  })

  it('persistScheduleAdherence updates when status changes', () => {
    const database = db()
    insertValidator(database)

    const first = computeScheduleAdherence({
      everyHours: 12,
      runStarts: Array.from({ length: 28 }, (_, i) => hoursAfter(i * 12)),
      analysisEnd: daysAfter(14),
    })
    expect(first.status).toBe('on-schedule')
    persistScheduleAdherence(database, { validatorAddress: VALIDATOR, result: first })

    const worse = computeScheduleAdherence({
      everyHours: 12,
      runStarts: Array.from({ length: 10 }, (_, i) => hoursAfter(i * 12)),
      analysisEnd: daysAfter(14),
    })
    expect(worse.status).toBe('irregular')
    const updated = persistScheduleAdherence(database, {
      validatorAddress: VALIDATOR,
      result: worse,
    })
    expect(updated.updated).toBe(1)
    expect(listScheduleAdherenceObservation(database, VALIDATOR)?.status).toBe('irregular')
  })

  it('skips cleanly when validator row is missing', () => {
    const database = db()
    const result = classifyScheduleAdherenceForValidator(database, VALIDATOR)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('no-validator-row')
  })
})

describe('groupPayoutRuns + adherence smoke', () => {
  it('scores from pure run starts without DB', () => {
    const txs: PayoutTransaction[] = Array.from({ length: 28 }, (_, i) => ({
      hash: i.toString(16).padStart(64, '0'),
      toAddress: RECIPIENT,
      valueLuna: 1,
      blockNumber: 1000 + i,
      timestamp: hoursAfter(i * 12),
      executionResult: 'ok' as const,
    }))
    const runs = groupPayoutRuns(txs)
    expect(runs).toHaveLength(28)

    const result = computeScheduleAdherence({
      everyHours: 12,
      runStarts: runs.map((r) => r.startedAt),
      analysisEnd: daysAfter(14),
    })
    expect(result.status).toBe('on-schedule')
    expect(result.payload.window).toMatchObject({
      expectedWindows: 28,
      observedWindows: 28,
    })
  })
})

// ---------------------------------------------------------------------------
// P2-04 — Recipient coverage (METHODOLOGY.md §4.3)
// ---------------------------------------------------------------------------

const STAKER_A = 'NQ00 0000 0000 0000 0000 0000 0000 0000 000A'
const STAKER_B = 'NQ00 0000 0000 0000 0000 0000 0000 0000 000B'
const STAKER_C = 'NQ00 0000 0000 0000 0000 0000 0000 0000 000C'
const OTHER_RECIPIENT = 'NQ00 0000 0000 0000 0000 0000 0000 0000 00FF'

describe('computeRecipientCoverage (METHODOLOGY.md §4.3)', () => {
  const base = {
    windowStart: ANCHOR,
    windowEnd: hoursAfter(1),
    firstTxHash: 'aa'.repeat(32),
    blockRange: [100, 101] as [number, number],
  }

  it('returns null knownStakers* when staker set is missing (never 0/0)', () => {
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 3,
      recipients: [STAKER_A, STAKER_B, OTHER_RECIPIENT],
      knownStakers: null,
    })
    expect(result.recipientCount).toBe(3)
    expect(result.knownStakersCovered).toBeNull()
    expect(result.knownStakersTotal).toBeNull()
  })

  it('returns null knownStakers* when knownStakers is undefined', () => {
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 1,
      recipients: [STAKER_A],
    })
    expect(result.knownStakersCovered).toBeNull()
    expect(result.knownStakersTotal).toBeNull()
  })

  it('returns null knownStakers* for empty staker set (never 0/0)', () => {
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 2,
      recipients: [STAKER_A, STAKER_B],
      knownStakers: [],
    })
    expect(result.knownStakersCovered).toBeNull()
    expect(result.knownStakersTotal).toBeNull()
  })

  it('computes covered/total when a known staker set exists (mixed present/absent)', () => {
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 3,
      recipients: [STAKER_A, STAKER_B, OTHER_RECIPIENT],
      knownStakers: [STAKER_A, STAKER_B, STAKER_C],
    })
    expect(result.recipientCount).toBe(3)
    expect(result.knownStakersCovered).toBe(2) // A, B observed; C not
    expect(result.knownStakersTotal).toBe(3)
  })

  it('known set present: all known stakers observed → covered === total', () => {
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 3,
      recipients: [STAKER_A, STAKER_B, STAKER_C],
      knownStakers: [STAKER_A, STAKER_B, STAKER_C],
    })
    expect(result.knownStakersCovered).toBe(3)
    expect(result.knownStakersTotal).toBe(3)
    // Counts only — never a derived percentage field.
    expect(result).not.toHaveProperty('coveragePercent')
  })

  it('known set absent: none of the known stakers observed → covered === 0 (valid count)', () => {
    // Unlike a missing set (null/null), an empty intersection is a real observation.
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 1,
      recipients: [OTHER_RECIPIENT],
      knownStakers: [STAKER_A, STAKER_B, STAKER_C],
    })
    expect(result.knownStakersCovered).toBe(0)
    expect(result.knownStakersTotal).toBe(3)
    expect(result.limitations).toContain('consolidation-may-aggregate-multiple-stakers')
  })

  it('normalizes addresses when matching known stakers', () => {
    // Same address as STAKER_A without spaces / different case.
    const compactLower = STAKER_A.replace(/\s+/g, '').toLowerCase()
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 1,
      recipients: [compactLower],
      knownStakers: [STAKER_A, STAKER_B],
    })
    expect(result.knownStakersCovered).toBe(1)
    expect(result.knownStakersTotal).toBe(2)
  })

  it('always includes consolidation/threshold/registry-incompleteness caveats', () => {
    for (const knownStakers of [null, [], [STAKER_A]]) {
      const result = computeRecipientCoverage({
        ...base,
        recipientCount: 1,
        recipients: [STAKER_A],
        knownStakers,
      })
      expect(result.limitations).toEqual([...RECIPIENT_COVERAGE_LIMITATIONS])
      expect(result.limitations).toContain(
        'observed-recipient-coverage-is-not-proof-of-full-payout',
      )
      expect(result.limitations).toContain('consolidation-may-aggregate-multiple-stakers')
      expect(result.limitations).toContain('payout-threshold-may-exclude-stakers')
      expect(result.limitations).toContain('registry-staker-list-may-be-incomplete')
    }
  })

  it('never includes a derived payout rate percentage field', () => {
    const withSet = computeRecipientCoverage({
      ...base,
      recipientCount: 2,
      recipients: [STAKER_A, STAKER_B],
      knownStakers: [STAKER_A, STAKER_B, STAKER_C],
    })
    const withoutSet = computeRecipientCoverage({
      ...base,
      recipientCount: 2,
      recipients: [STAKER_A, STAKER_B],
      knownStakers: null,
    })
    for (const payload of [withSet, withoutSet]) {
      const keys = Object.keys(payload)
      expect(keys).not.toContain('payoutRate')
      expect(keys).not.toContain('payoutRatePercent')
      expect(keys).not.toContain('rate')
      expect(keys).not.toContain('coveragePercent')
      expect(keys).not.toContain('coverageRate')
      // No percentage-shaped number derived from covered/total.
      const json = JSON.stringify(payload)
      expect(json).not.toMatch(/payout\s*rate/i)
      expect(json).not.toMatch(/paid everyone/i)
      expect(json).not.toMatch(/missed stakers/i)
      expect(payload).not.toHaveProperty('payoutRate')
    }
    // Covered/total are counts only — never a precomputed ratio.
    expect(withSet.knownStakersCovered).toBe(2)
    expect(withSet.knownStakersTotal).toBe(3)
  })

  it('dedupes known stakers by normalized address', () => {
    const compact = STAKER_A.replace(/\s+/g, '')
    const result = computeRecipientCoverage({
      ...base,
      recipientCount: 1,
      recipients: [STAKER_A],
      knownStakers: [STAKER_A, compact, STAKER_B],
    })
    expect(result.knownStakersTotal).toBe(2)
    expect(result.knownStakersCovered).toBe(1)
  })
})

describe('recipient-coverage persistence + pipeline', () => {
  const databases: Array<ReturnType<typeof openDatabase>> = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  function db(): ReturnType<typeof openDatabase> {
    const database = openDatabase(':memory:')
    databases.push(database)
    return database
  }

  function insertValidator(database: ReturnType<typeof openDatabase>): void {
    database.prepare(`
      INSERT INTO validators (
        address, name, reward_address, is_listed,
        payout_schedule_declared, schedule_every_hours, stakers_count
      ) VALUES (?, 'Test', ?, 1, 'Every 12 hours', 12, 99)
    `).run(VALIDATOR, REWARD)
  }

  function insertTx(
    database: ReturnType<typeof openDatabase>,
    hours: number,
    index: number,
    toAddress: string = RECIPIENT,
  ): void {
    const hash = index.toString(16).padStart(64, '0')
    const timestamp = hoursAfter(hours)
    database.prepare(`
      INSERT INTO transactions (
        hash, from_address, to_address, value_luna, fee_luna, block_number,
        timestamp, execution_result, raw_json
      ) VALUES (?, ?, ?, 100000, 0, ?, ?, 'ok', '{}')
    `).run(hash, REWARD, toAddress, 100 + hours, timestamp)
  }

  it('loadKnownStakerSet returns null (no registry list yet; do not invent from count)', () => {
    const database = db()
    insertValidator(database)
    // stakers_count=99 must not become knownStakersTotal=99
    expect(loadKnownStakerSet(database, VALIDATOR)).toBeNull()
  })

  it('persists coverage with null knownStakers* when no set exists', () => {
    const database = db()
    insertValidator(database)
    insertTx(database, 0, 0, STAKER_A)
    insertTx(database, 0.1, 1, STAKER_B) // same run window

    classifyPayoutRunsForRewardAddress(database, REWARD)
    const result = classifyRecipientCoverageForValidator(database, VALIDATOR)
    expect(result.skipped).toBe(false)
    expect(result.coverageCount).toBe(1)
    expect(result.inserted).toBe(1)

    const rows = listRecipientCoverageObservations(database, VALIDATOR)
    expect(rows).toHaveLength(1)
    const payload = rows[0].payload
    expect(payload.recipientCount).toBe(2)
    expect(payload.knownStakersCovered).toBeNull()
    expect(payload.knownStakersTotal).toBeNull()
    expect(payload.limitations).toEqual([...RECIPIENT_COVERAGE_LIMITATIONS])
    // Never 0/0
    expect(payload.knownStakersCovered).not.toBe(0)
    expect(payload.knownStakersTotal).not.toBe(0)
  })

  it('persists covered/total when known staker set is supplied', () => {
    const database = db()
    insertValidator(database)
    insertTx(database, 0, 0, STAKER_A)
    insertTx(database, 0.1, 1, OTHER_RECIPIENT)

    classifyPayoutRunsForRewardAddress(database, REWARD)
    classifyRecipientCoverageForValidator(database, VALIDATOR, {
      knownStakers: [STAKER_A, STAKER_B, STAKER_C],
    })

    const rows = listRecipientCoverageObservations(database, VALIDATOR)
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.knownStakersCovered).toBe(1)
    expect(rows[0].payload.knownStakersTotal).toBe(3)
    expect(rows[0].payload.recipientCount).toBe(2)
    expect(rows[0].payload.limitations.length).toBeGreaterThanOrEqual(3)
  })

  it('is idempotent on re-classification', () => {
    const database = db()
    insertValidator(database)
    insertTx(database, 0, 0)
    insertTx(database, 12, 1)

    classifyPayoutRunsForRewardAddress(database, REWARD)
    const first = classifyRecipientCoverageForValidator(database, VALIDATOR)
    const second = classifyRecipientCoverageForValidator(database, VALIDATOR)
    expect(first.inserted).toBe(2)
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.removed).toBe(0)

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM validator_observations
      WHERE observation_type = ? AND calc_version = ?
    `).get(RECIPIENT_COVERAGE_OBSERVATION_TYPE, CALC_VERSION) as { count: number }
    expect(count.count).toBe(2)
  })

  it('combined pipeline classifies runs, adherence, and coverage', () => {
    const database = db()
    insertValidator(database)
    for (let i = 0; i < 28; i += 1) insertTx(database, i * 12, i)
    insertTx(database, 28 * 12, 28)

    const { runs, adherence, coverage } = classifyObservationsForRewardAddress(
      database,
      REWARD,
    )
    expect(runs.skipped).toBe(false)
    expect(runs.runCount).toBe(29)
    expect(adherence?.status).toBe('on-schedule')
    expect(coverage).not.toBeNull()
    expect(coverage?.coverageCount).toBe(29)
    expect(coverage?.inserted).toBe(29)

    const coverages = listRecipientCoverageObservations(database, VALIDATOR)
    expect(coverages).toHaveLength(29)
    for (const row of coverages) {
      expect(row.payload.knownStakersCovered).toBeNull()
      expect(row.payload.knownStakersTotal).toBeNull()
      expect(row.payload.limitations).toEqual([...RECIPIENT_COVERAGE_LIMITATIONS])
      expect(JSON.stringify(row.payload)).not.toMatch(/payout rate/i)
    }
  })

  it('skips cleanly when validator row is missing', () => {
    const database = db()
    const result = classifyRecipientCoverageForValidator(database, VALIDATOR)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('no-validator-row')
  })

  it('persistRecipientCoverage updates when payload changes', () => {
    const database = db()
    insertValidator(database)

    const first = computeRecipientCoverage({
      windowStart: ANCHOR,
      windowEnd: hoursAfter(1),
      recipientCount: 1,
      recipients: [STAKER_A],
      firstTxHash: 'bb'.repeat(32),
      blockRange: [10, 10],
      knownStakers: null,
    })
    expect(persistRecipientCoverage(database, {
      validatorAddress: VALIDATOR,
      coverages: [first],
    }).inserted).toBe(1)

    const withSet = computeRecipientCoverage({
      windowStart: ANCHOR,
      windowEnd: hoursAfter(1),
      recipientCount: 1,
      recipients: [STAKER_A],
      firstTxHash: 'bb'.repeat(32),
      blockRange: [10, 10],
      knownStakers: [STAKER_A, STAKER_B],
    })
    const updated = persistRecipientCoverage(database, {
      validatorAddress: VALIDATOR,
      coverages: [withSet],
    })
    expect(updated.updated).toBe(1)
    const row = listRecipientCoverageObservations(database, VALIDATOR)[0]
    expect(row.payload.knownStakersCovered).toBe(1)
    expect(row.payload.knownStakersTotal).toBe(2)
  })
})
