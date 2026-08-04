import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'
import { loadHistoryDepthDaysByValidator } from './freshness.js'
import {
  CALC_VERSION,
  classifyPayoutRunsForRewardAddress,
  listPayoutRunObservations,
  normalizeSchedule,
  type ClassifyPayoutRunsResult,
  type PayoutRunPayload,
} from './payoutClassifier.js'

// Re-export freshness helpers so callers can import from observationScoring
// (ARCHITECTURE.md: "status labels, history depth, freshness").
export {
  ageSeconds,
  applyIndexerStaleStatus,
  buildDataFreshness,
  buildStatefulEnvelope,
  computeHistoryDepthDays,
  DEFAULT_INDEXER_INTERVAL_MINUTES,
  earliestOutboundTxAt,
  earliestPayoutRunAt,
  getAddressIndexerWatermarkIso,
  getIndexerWatermarkIso,
  historyDepthDaysFromEarliest,
  indexerPollCadenceMs,
  isWatermarkStale,
  loadHistoryDepthDaysByValidator,
  STALE_CADENCE_MULTIPLIER,
  staleThresholdMs,
  type DataFreshness,
  type EnvelopeSource,
  type EnvelopeStatus,
  type StatefulEnvelope,
} from './freshness.js'

/**
 * Schedule-adherence thresholds (METHODOLOGY.md §3). Changing these bumps
 * calc_version and must be noted in the audit trail (METHODOLOGY.md §9).
 */
export const ON_SCHEDULE_MIN_RATE = 0.95
export const MOSTLY_ON_SCHEDULE_MIN_RATE = 0.8
/** Always insufficient-data below this depth (METHODOLOGY.md §3). */
export const MIN_HISTORY_DAYS = 7
/**
 * Prefer no graded label before this depth (P0-07 spike recommendation).
 * METHODOLOGY.md §3 already requires ≥14 days for `irregular`; we apply the
 * same floor to `on-schedule` / `mostly-on-schedule` so a single grid-boundary
 * artifact cannot flip a band on a short window.
 */
export const MIN_HISTORY_DAYS_FOR_GRADE = 14

export const SCHEDULE_ADHERENCE_OBSERVATION_TYPE = 'schedule-adherence' as const

/** Validator-level observation status labels (METHODOLOGY.md §3). */
export type ObservationStatus =
  | 'on-schedule'
  | 'mostly-on-schedule'
  | 'irregular'
  | 'insufficient-data'
  | 'unavailable'

export interface ScheduleAdherenceWindow {
  from: string
  to: string
  expectedWindows: number
  observedWindows: number
}

/**
 * Stored JSON for `validator_observations.payload_json` when
 * `observation_type = 'schedule-adherence'`. API.md §3 window shape plus
 * fields needed to re-display and audit the grade.
 */
export interface ScheduleAdherencePayload {
  window: ScheduleAdherenceWindow
  /** observedWindows / expectedWindows when expected > 0; otherwise null. */
  rate: number | null
  historyDepthDays: number
  everyHours: number | null
  normalizable: boolean
  /** Declared schedule string from the registry (may be null). */
  declaredSchedule: string | null
  /** Grid anchor = first observed run start when runs exist. */
  anchorAt: string | null
  runCount: number
}

export interface ComputeScheduleAdherenceInput {
  /** Interval hours when the schedule is normalizable; null otherwise. */
  everyHours: number | null
  /** Original declared schedule (preserved even when not normalizable). */
  declaredSchedule?: string | null
  /**
   * Start timestamps of observed payout runs (ISO). Ordering does not matter;
   * the earliest is used as the grid anchor.
   */
  runStarts: readonly string[]
  /**
   * End of the analysis window (typically last indexed outbound timestamp, or
   * "now"). Must be ≥ first run when runs exist.
   */
  analysisEnd: string
}

export interface ScheduleAdherenceResult {
  status: ObservationStatus
  payload: ScheduleAdherencePayload
}

export interface PersistScheduleAdherenceOptions {
  validatorAddress: string
  result: ScheduleAdherenceResult
  calcVersion?: number
  observedAt?: string
}

export interface PersistScheduleAdherenceResult {
  inserted: number
  updated: number
  unchanged: number
}

export interface ClassifyScheduleAdherenceOptions {
  calcVersion?: number
  /** Override analysis end (default: last outbound tx time, else now). */
  analysisEnd?: string
  /** Override schedule hours (default: validators.schedule_every_hours). */
  everyHours?: number | null
  declaredSchedule?: string | null
}

export interface ClassifyScheduleAdherenceResult {
  validatorAddress: string
  calcVersion: number
  status: ObservationStatus
  inserted: number
  updated: number
  unchanged: number
  skipped: boolean
  skipReason: string | null
}

function parseIsoMs(iso: string, label: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) {
    throw new Error(`${label} timestamp is malformed: ${iso}`)
  }
  return ms
}

function hoursBetween(fromIso: string, toIso: string): number {
  return (parseIsoMs(toIso, 'to') - parseIsoMs(fromIso, 'from')) / 3_600_000
}

/**
 * Map adherence rate + history depth to a METHODOLOGY.md §3 status label.
 * Pure; exported for unit tests of exact threshold boundaries.
 *
 * Rules (v1):
 * - non-normalizable + no runs → `unavailable`
 * - non-normalizable + runs → `insufficient-data` (never graded; runs still shown)
 * - historyDepthDays < 7 → `insufficient-data`
 * - expectedWindows === 0 (too few windows) → `insufficient-data`
 * - historyDepthDays < 14 → `insufficient-data` (no graded label yet)
 * - rate ≥ 0.95 → `on-schedule`
 * - rate ≥ 0.80 → `mostly-on-schedule`
 * - rate < 0.80 → `irregular`
 */
export function mapAdherenceStatus(input: {
  normalizable: boolean
  runCount: number
  historyDepthDays: number
  expectedWindows: number
  observedWindows: number
}): ObservationStatus {
  const { normalizable, runCount, historyDepthDays, expectedWindows, observedWindows } = input

  if (!normalizable) {
    return runCount === 0 ? 'unavailable' : 'insufficient-data'
  }

  if (historyDepthDays < MIN_HISTORY_DAYS) {
    return 'insufficient-data'
  }

  if (expectedWindows <= 0) {
    return 'insufficient-data'
  }

  if (historyDepthDays < MIN_HISTORY_DAYS_FOR_GRADE) {
    return 'insufficient-data'
  }

  const rate = observedWindows / expectedWindows
  if (rate >= ON_SCHEDULE_MIN_RATE) return 'on-schedule'
  if (rate >= MOSTLY_ON_SCHEDULE_MIN_RATE) return 'mostly-on-schedule'
  return 'irregular'
}

/**
 * Expected-vs-observed window analysis for one validator.
 *
 * Grid is anchored at the first observed run start (P0-07). Only **fully
 * elapsed** windows count as expected; the trailing partial window is not yet
 * due and never counts as observed or not-observed. A window is observed when
 * at least one run starts inside it.
 */
export function computeScheduleAdherence(
  input: ComputeScheduleAdherenceInput,
): ScheduleAdherenceResult {
  const declaredSchedule = input.declaredSchedule ?? null
  const everyHours = input.everyHours
  const normalizable = everyHours != null && everyHours > 0 && Number.isFinite(everyHours)

  const runStarts = [...input.runStarts].sort(
    (a, b) => parseIsoMs(a, 'run') - parseIsoMs(b, 'run'),
  )
  const runCount = runStarts.length
  const analysisEnd = input.analysisEnd
  const anchorAt = runStarts[0] ?? null

  // No runs: nothing to anchor. Window collapses to analysisEnd with zeros.
  if (anchorAt === null) {
    const payload: ScheduleAdherencePayload = {
      window: {
        from: analysisEnd,
        to: analysisEnd,
        expectedWindows: 0,
        observedWindows: 0,
      },
      rate: null,
      historyDepthDays: 0,
      everyHours: normalizable ? everyHours : null,
      normalizable,
      declaredSchedule,
      anchorAt: null,
      runCount: 0,
    }
    return {
      status: mapAdherenceStatus({
        normalizable,
        runCount: 0,
        historyDepthDays: 0,
        expectedWindows: 0,
        observedWindows: 0,
      }),
      payload,
    }
  }

  const spanHours = Math.max(0, hoursBetween(anchorAt, analysisEnd))
  const historyDepthDays = spanHours / 24

  let expectedWindows = 0
  let observedWindows = 0

  if (normalizable && everyHours != null) {
    expectedWindows = Math.max(0, Math.floor(spanHours / everyHours))
    if (expectedWindows > 0) {
      const observedIndexes = new Set<number>()
      for (const start of runStarts) {
        const index = Math.floor(hoursBetween(anchorAt, start) / everyHours)
        if (index >= 0 && index < expectedWindows) {
          observedIndexes.add(index)
        }
      }
      observedWindows = observedIndexes.size
    }
  }

  const rate = expectedWindows > 0 ? observedWindows / expectedWindows : null
  const status = mapAdherenceStatus({
    normalizable,
    runCount,
    historyDepthDays,
    expectedWindows,
    observedWindows,
  })

  return {
    status,
    payload: {
      window: {
        from: anchorAt,
        to: analysisEnd,
        expectedWindows,
        observedWindows,
      },
      rate,
      historyDepthDays,
      everyHours: normalizable ? everyHours : null,
      normalizable,
      declaredSchedule,
      anchorAt,
      runCount,
    },
  }
}

/**
 * Upsert the single schedule-adherence observation for a validator at a given
 * calc_version. Identity: (validator, type, calc_version) — one row per version.
 * Other calc_versions are never touched (append-only audit trail).
 */
export function persistScheduleAdherence(
  database: Database.Database,
  options: PersistScheduleAdherenceOptions,
): PersistScheduleAdherenceResult {
  const calcVersion = options.calcVersion ?? CALC_VERSION
  const observedAt = options.observedAt
    ?? options.result.payload.window.to
    ?? new Date().toISOString()
  const payloadJson = JSON.stringify(options.result.payload)
  const status = options.result.status
  const validatorAddress = options.validatorAddress

  const existing = database.prepare(`
    SELECT id, status, observed_at, payload_json
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = ?
      AND calc_version = ?
    LIMIT 1
  `).get(
    validatorAddress,
    SCHEDULE_ADHERENCE_OBSERVATION_TYPE,
    calcVersion,
  ) as { id: number; status: string; observed_at: string; payload_json: string } | undefined

  if (existing === undefined) {
    database.prepare(`
      INSERT INTO validator_observations (
        validator_address, observation_type, status, observed_at,
        source_tx_hash, block_number, calc_version, payload_json
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(
      validatorAddress,
      SCHEDULE_ADHERENCE_OBSERVATION_TYPE,
      status,
      observedAt,
      calcVersion,
      payloadJson,
    )
    return { inserted: 1, updated: 0, unchanged: 0 }
  }

  if (
    existing.status !== status
    || existing.observed_at !== observedAt
    || existing.payload_json !== payloadJson
  ) {
    database.prepare(`
      UPDATE validator_observations
      SET status = ?, observed_at = ?, payload_json = ?
      WHERE id = ?
    `).run(status, observedAt, payloadJson, existing.id)
    return { inserted: 0, updated: 1, unchanged: 0 }
  }

  return { inserted: 0, updated: 0, unchanged: 1 }
}

interface ValidatorScheduleRow {
  address: string
  payout_schedule_declared: string | null
  schedule_every_hours: number | null
}

/**
 * Load validator schedule fields for adherence scoring.
 */
export function loadValidatorSchedule(
  database: Database.Database,
  validatorAddress: string,
): ValidatorScheduleRow | null {
  const row = database.prepare(`
    SELECT address, payout_schedule_declared, schedule_every_hours
    FROM validators
    WHERE address = ?
  `).get(validatorAddress) as ValidatorScheduleRow | undefined
  return row ?? null
}

/**
 * Last outbound transaction timestamp from the reward address (any execution
 * result), used as analysis-window end when not overridden.
 */
export function lastOutboundTimestamp(
  database: Database.Database,
  rewardAddress: string,
): string | null {
  const row = database.prepare(`
    SELECT MAX(timestamp) AS last_ts
    FROM transactions
    WHERE from_address = ?
  `).get(rewardAddress) as { last_ts: string | null }
  if (row.last_ts != null) return row.last_ts

  // Space-insensitive fallback (same as loadOutboundTransactions).
  const compact = rewardAddress.replace(/\s+/g, '').toUpperCase()
  const fallback = database.prepare(`
    SELECT MAX(timestamp) AS last_ts
    FROM transactions
    WHERE replace(upper(from_address), ' ', '') = ?
  `).get(compact) as { last_ts: string | null }
  return fallback.last_ts
}

/**
 * Full schedule-adherence classify for one validator after payout-run grouping
 * (DATA-MODEL.md §2 step 6). Reads latest payout-run observations + declared
 * schedule, computes adherence, persists as `schedule-adherence`.
 */
export function classifyScheduleAdherenceForValidator(
  database: Database.Database,
  validatorAddress: string,
  options: ClassifyScheduleAdherenceOptions & { rewardAddress?: string } = {},
): ClassifyScheduleAdherenceResult {
  const calcVersion = options.calcVersion ?? CALC_VERSION
  const validator = loadValidatorSchedule(database, validatorAddress)
  if (validator === null) {
    return {
      validatorAddress,
      calcVersion,
      status: 'unavailable',
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skipped: true,
      skipReason: 'no-validator-row',
    }
  }

  let everyHours = options.everyHours
  let declaredSchedule = options.declaredSchedule
  if (everyHours === undefined || declaredSchedule === undefined) {
    declaredSchedule = declaredSchedule !== undefined
      ? declaredSchedule
      : validator.payout_schedule_declared
    if (everyHours === undefined) {
      // Prefer stored column; re-normalize declaration when column is null so
      // free-text vs missing stays correct even if sync lagged.
      if (validator.schedule_every_hours != null && validator.schedule_every_hours > 0) {
        everyHours = validator.schedule_every_hours
      } else {
        everyHours = normalizeSchedule(validator.payout_schedule_declared).everyHours
      }
    }
  }

  const runs = listPayoutRunObservations(database, validatorAddress, { calcVersion })
  const runStarts = runs.map((run) => run.payload.windowStart)

  let analysisEnd = options.analysisEnd
  if (analysisEnd === undefined) {
    const reward = options.rewardAddress
    const lastTx = reward != null ? lastOutboundTimestamp(database, reward) : null
    if (lastTx != null) {
      analysisEnd = lastTx
    } else if (runs.length > 0) {
      // Fall back to latest run end when no reward address was provided.
      analysisEnd = runs.reduce(
        (latest, run) => (run.payload.windowEnd > latest ? run.payload.windowEnd : latest),
        runs[0].payload.windowEnd,
      )
    } else {
      analysisEnd = new Date().toISOString()
    }
  }

  const result = computeScheduleAdherence({
    everyHours: everyHours ?? null,
    declaredSchedule: declaredSchedule ?? null,
    runStarts,
    analysisEnd,
  })

  const persisted = persistScheduleAdherence(database, {
    validatorAddress,
    result,
    calcVersion,
    observedAt: analysisEnd,
  })

  return {
    validatorAddress,
    calcVersion,
    status: result.status,
    inserted: persisted.inserted,
    updated: persisted.updated,
    unchanged: persisted.unchanged,
    skipped: false,
    skipReason: null,
  }
}

/**
 * Read the latest schedule-adherence observation for a validator.
 */
export function listScheduleAdherenceObservation(
  database: Database.Database,
  validatorAddress: string,
  options: { calcVersion?: number | 'latest' } = {},
): {
  id: number
  status: ObservationStatus
  observedAt: string
  calcVersion: number
  payload: ScheduleAdherencePayload
} | null {
  let calcVersion = options.calcVersion ?? 'latest'
  if (calcVersion === 'latest') {
    const row = database.prepare(`
      SELECT MAX(calc_version) AS version
      FROM validator_observations
      WHERE observation_type = ? AND validator_address = ?
    `).get(SCHEDULE_ADHERENCE_OBSERVATION_TYPE, validatorAddress) as {
      version: number | null
    }
    if (row.version === null) return null
    calcVersion = row.version
  }

  const row = database.prepare(`
    SELECT id, status, observed_at, calc_version, payload_json
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = ?
      AND calc_version = ?
    LIMIT 1
  `).get(
    validatorAddress,
    SCHEDULE_ADHERENCE_OBSERVATION_TYPE,
    calcVersion,
  ) as {
    id: number
    status: string
    observed_at: string
    calc_version: number
    payload_json: string
  } | undefined

  if (row === undefined) return null
  return {
    id: row.id,
    status: row.status as ObservationStatus,
    observedAt: row.observed_at,
    calcVersion: row.calc_version,
    payload: JSON.parse(row.payload_json) as ScheduleAdherencePayload,
  }
}

export interface ObservationSummaryFields {
  status: ObservationStatus
  lastObservedAt: string | null
  historyDepthDays: number
  /** From latest schedule-adherence payload; null when not graded / no grid. */
  observedWindows: number | null
  expectedWindows: number | null
}

/**
 * Batch-load latest schedule-adherence + last payout-run timestamp for list/detail
 * observation summary fields. Keyed by compact (space-stripped uppercase) address.
 *
 * `historyDepthDays` is earliest indexed payout-run → now (P2-07). Falls back to
 * the schedule-adherence payload depth when no runs are stored yet.
 */
export function loadObservationSummaries(
  database: Database.Database,
  options: { nowMs?: number } = {},
): Map<string, ObservationSummaryFields> {
  const nowMs = options.nowMs ?? Date.now()
  const map = new Map<string, ObservationSummaryFields>()
  const depths = loadHistoryDepthDaysByValidator(database, nowMs)

  const adherenceRows = database.prepare(`
    SELECT o.validator_address, o.status, o.observed_at, o.payload_json
    FROM validator_observations o
    INNER JOIN (
      SELECT validator_address, MAX(calc_version) AS max_version
      FROM validator_observations
      WHERE observation_type = ?
      GROUP BY validator_address
    ) latest
      ON latest.validator_address = o.validator_address
      AND latest.max_version = o.calc_version
    WHERE o.observation_type = ?
  `).all(
    SCHEDULE_ADHERENCE_OBSERVATION_TYPE,
    SCHEDULE_ADHERENCE_OBSERVATION_TYPE,
  ) as Array<{
    validator_address: string
    status: string
    observed_at: string
    payload_json: string
  }>

  for (const row of adherenceRows) {
    const key = normalizeAddress(row.validator_address)
    let payloadDepth = 0
    let observedWindows: number | null = null
    let expectedWindows: number | null = null
    try {
      const payload = JSON.parse(row.payload_json) as ScheduleAdherencePayload
      payloadDepth = typeof payload.historyDepthDays === 'number'
        ? payload.historyDepthDays
        : 0
      if (payload.window && typeof payload.window.observedWindows === 'number') {
        observedWindows = payload.window.observedWindows
      }
      if (payload.window && typeof payload.window.expectedWindows === 'number') {
        expectedWindows = payload.window.expectedWindows
      }
    } catch {
      payloadDepth = 0
    }
    // Prefer live earliest→now from runs; fall back to scored payload depth.
    const historyDepthDays = depths.get(key) ?? payloadDepth
    map.set(key, {
      status: row.status as ObservationStatus,
      lastObservedAt: null,
      historyDepthDays,
      observedWindows,
      expectedWindows,
    })
  }

  const runRows = database.prepare(`
    SELECT validator_address, MAX(observed_at) AS last_at
    FROM validator_observations
    WHERE observation_type = 'payout-run'
    GROUP BY validator_address
  `).all() as Array<{ validator_address: string; last_at: string }>

  for (const row of runRows) {
    const key = normalizeAddress(row.validator_address)
    const depth = depths.get(key) ?? 0
    const existing = map.get(key)
    if (existing) {
      existing.lastObservedAt = row.last_at
      // Keep the larger of live depth vs any prior value.
      if (depth > existing.historyDepthDays) {
        existing.historyDepthDays = depth
      }
    } else {
      map.set(key, {
        status: 'insufficient-data',
        lastObservedAt: row.last_at,
        historyDepthDays: depth,
        observedWindows: null,
        expectedWindows: null,
      })
    }
  }

  return map
}

// ---------------------------------------------------------------------------
// Recipient coverage (METHODOLOGY.md §4.3 / P2-04)
// ---------------------------------------------------------------------------

export const RECIPIENT_COVERAGE_OBSERVATION_TYPE = 'recipient-coverage' as const

/** Chain-derived recipient counts are verified observations (METHODOLOGY.md §2). */
export const RECIPIENT_COVERAGE_STATUS = 'verified' as const

/**
 * Mandated caveats for every recipient-coverage payload (METHODOLOGY.md §4.3,
 * SPEC.md §7.2, API.md §3). Machine-stable keys for the API `limitations[]`
 * array. Wording intentionally avoids "paid everyone" / "payout rate" /
 * "missed stakers".
 */
export const RECIPIENT_COVERAGE_LIMITATIONS = [
  'observed-recipient-coverage-is-not-proof-of-full-payout',
  'consolidation-may-aggregate-multiple-stakers',
  'payout-threshold-may-exclude-stakers',
  'registry-staker-list-may-be-incomplete',
] as const

export type RecipientCoverageLimitation = (typeof RECIPIENT_COVERAGE_LIMITATIONS)[number]

/**
 * Stored JSON for `validator_observations.payload_json` when
 * `observation_type = 'recipient-coverage'`. API-ready for run enrichment
 * (API.md §3 knownStakersCovered/Total + limitations).
 *
 * Never includes a derived payout-rate percentage (METHODOLOGY.md §7 ban).
 */
export interface RecipientCoveragePayload {
  windowStart: string
  windowEnd: string
  recipientCount: number
  /** Distinct known stakers that appear among run recipients; null when no set. */
  knownStakersCovered: number | null
  /** Size of the known staker set; null when no set (never 0 for "missing"). */
  knownStakersTotal: number | null
  /** Always present; consolidation / threshold / registry-incompleteness caveats. */
  limitations: RecipientCoverageLimitation[]
  /** Identity join key = payout-run firstTxHash. */
  firstTxHash: string
  blockRange: [number, number]
}

export interface ComputeRecipientCoverageInput {
  windowStart: string
  windowEnd: string
  recipientCount: number
  /** Distinct recipient addresses for the run (used when a known set exists). */
  recipients: readonly string[]
  firstTxHash: string
  blockRange: [number, number]
  /**
   * Known staker addresses from the registry when available.
   * Pass `null` / `undefined` when no list exists — never invent from counts.
   * Empty arrays are treated as missing (nulls), never 0/0.
   */
  knownStakers?: readonly string[] | null
}

export interface PersistRecipientCoverageOptions {
  validatorAddress: string
  coverages: readonly RecipientCoveragePayload[]
  calcVersion?: number
}

export interface PersistRecipientCoverageResult {
  inserted: number
  updated: number
  removed: number
  coverageCount: number
}

export interface ClassifyRecipientCoverageOptions {
  calcVersion?: number
  /**
   * Optional known staker set override. Default: `loadKnownStakerSet` (null
   * until a registry stakers list is available).
   */
  knownStakers?: readonly string[] | null
}

export interface ClassifyRecipientCoverageResult {
  validatorAddress: string
  calcVersion: number
  coverageCount: number
  inserted: number
  updated: number
  removed: number
  skipped: boolean
  skipReason: string | null
}

/**
 * Pure recipient-coverage computation for one payout run (METHODOLOGY.md §4.3).
 *
 * - Always reports distinct `recipientCount`.
 * - When a non-empty known staker set is provided, reports covered/total by
 *   address intersection (normalized). Missing or empty set → both nulls
 *   (never 0/0, never a percentage).
 * - Always attaches the mandated limitations array.
 */
export function computeRecipientCoverage(
  input: ComputeRecipientCoverageInput,
): RecipientCoveragePayload {
  const limitations = [...RECIPIENT_COVERAGE_LIMITATIONS]
  const recipientCount = Math.max(0, Math.floor(input.recipientCount))

  let knownStakersCovered: number | null = null
  let knownStakersTotal: number | null = null

  const known = input.knownStakers
  if (known != null && known.length > 0) {
    const knownNormalized = new Set(
      known.map((address) => normalizeAddress(address)).filter((a) => a !== ''),
    )
    // Empty after normalize still means no usable set — keep nulls (never 0/0).
    if (knownNormalized.size > 0) {
      const recipientNormalized = new Set(
        input.recipients.map((address) => normalizeAddress(address)).filter((a) => a !== ''),
      )
      let covered = 0
      for (const staker of knownNormalized) {
        if (recipientNormalized.has(staker)) covered += 1
      }
      knownStakersCovered = covered
      knownStakersTotal = knownNormalized.size
    }
  }

  return {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    recipientCount,
    knownStakersCovered,
    knownStakersTotal,
    limitations,
    firstTxHash: input.firstTxHash,
    blockRange: input.blockRange,
  }
}

/**
 * Load the known staker address set for a validator when the registry provides
 * one. v1 schema has only `stakers_count` (aggregate) — no address list —
 * so this always returns null. Do not invent a set from counts.
 *
 * Hook point for a future registry/API stakers list (P2-05 personal continuity
 * and P2-06 observations can pass an override once a source exists).
 */
export function loadKnownStakerSet(
  _database: Database.Database,
  _validatorAddress: string,
): string[] | null {
  return null
}

/**
 * Persist recipient-coverage observations for one validator at a calc_version.
 * Identity: (validator, type, calc_version, source_tx_hash=firstTxHash) —
 * same key as the matching payout-run so API can join coverage onto runs.
 * Same-version orphans removed; other calc_versions retained.
 */
export function persistRecipientCoverage(
  database: Database.Database,
  options: PersistRecipientCoverageOptions,
): PersistRecipientCoverageResult {
  const calcVersion = options.calcVersion ?? CALC_VERSION
  const validatorAddress = options.validatorAddress

  const existing = database.prepare(`
    SELECT id, source_tx_hash, observed_at, block_number, payload_json, status
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = ?
      AND calc_version = ?
  `).all(
    validatorAddress,
    RECIPIENT_COVERAGE_OBSERVATION_TYPE,
    calcVersion,
  ) as Array<{
    id: number
    source_tx_hash: string | null
    observed_at: string
    block_number: number | null
    payload_json: string
    status: string
  }>

  const bySourceHash = new Map<string, (typeof existing)[number]>()
  for (const row of existing) {
    if (row.source_tx_hash != null && row.source_tx_hash !== '') {
      bySourceHash.set(row.source_tx_hash, row)
    }
  }

  const insert = database.prepare(`
    INSERT INTO validator_observations (
      validator_address, observation_type, status, observed_at,
      source_tx_hash, block_number, calc_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const update = database.prepare(`
    UPDATE validator_observations
    SET status = ?, observed_at = ?, block_number = ?, payload_json = ?
    WHERE id = ?
  `)
  const remove = database.prepare(`
    DELETE FROM validator_observations WHERE id = ?
  `)

  const sync = database.transaction(() => {
    let inserted = 0
    let updated = 0
    const seen = new Set<string>()

    for (const coverage of options.coverages) {
      const sourceTxHash = coverage.firstTxHash
      seen.add(sourceTxHash)
      const payloadJson = JSON.stringify(coverage)
      const observedAt = coverage.windowEnd
      const blockNumber = coverage.blockRange[0]
      const prior = bySourceHash.get(sourceTxHash)

      if (prior === undefined) {
        insert.run(
          validatorAddress,
          RECIPIENT_COVERAGE_OBSERVATION_TYPE,
          RECIPIENT_COVERAGE_STATUS,
          observedAt,
          sourceTxHash,
          blockNumber,
          calcVersion,
          payloadJson,
        )
        inserted += 1
        continue
      }

      if (
        prior.payload_json !== payloadJson
        || prior.observed_at !== observedAt
        || prior.block_number !== blockNumber
        || prior.status !== RECIPIENT_COVERAGE_STATUS
      ) {
        update.run(
          RECIPIENT_COVERAGE_STATUS,
          observedAt,
          blockNumber,
          payloadJson,
          prior.id,
        )
        updated += 1
      }
    }

    let removed = 0
    for (const row of existing) {
      const key = row.source_tx_hash
      if (key == null || key === '' || !seen.has(key)) {
        remove.run(row.id)
        removed += 1
      }
    }

    return {
      inserted,
      updated,
      removed,
      coverageCount: options.coverages.length,
    }
  })

  return sync()
}

/**
 * Score + persist recipient-coverage for all latest payout-run observations of
 * a validator. Uses `loadKnownStakerSet` unless an override is provided.
 */
export function classifyRecipientCoverageForValidator(
  database: Database.Database,
  validatorAddress: string,
  options: ClassifyRecipientCoverageOptions = {},
): ClassifyRecipientCoverageResult {
  const calcVersion = options.calcVersion ?? CALC_VERSION

  const exists = database.prepare(`
    SELECT 1 AS ok FROM validators WHERE address = ?
  `).get(validatorAddress) as { ok: number } | undefined
  if (exists === undefined) {
    return {
      validatorAddress,
      calcVersion,
      coverageCount: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
      skipped: true,
      skipReason: 'no-validator-row',
    }
  }

  const knownStakers = options.knownStakers !== undefined
    ? options.knownStakers
    : loadKnownStakerSet(database, validatorAddress)

  const runs = listPayoutRunObservations(database, validatorAddress, { calcVersion })
  const coverages = runs.map((run) => computeRecipientCoverage({
    windowStart: run.payload.windowStart,
    windowEnd: run.payload.windowEnd,
    recipientCount: run.payload.recipientCount,
    recipients: run.payload.recipients,
    firstTxHash: run.payload.firstTxHash,
    blockRange: run.payload.blockRange,
    knownStakers,
  }))

  const persisted = persistRecipientCoverage(database, {
    validatorAddress,
    coverages,
    calcVersion,
  })

  return {
    validatorAddress,
    calcVersion,
    coverageCount: persisted.coverageCount,
    inserted: persisted.inserted,
    updated: persisted.updated,
    removed: persisted.removed,
    skipped: false,
    skipReason: null,
  }
}

/**
 * Read recipient-coverage observations for a validator (latest calc_version
 * by default). Ordered by observed_at for stable join with runs.
 */
export function listRecipientCoverageObservations(
  database: Database.Database,
  validatorAddress: string,
  options: { calcVersion?: number | 'latest' } = {},
): Array<{
  id: number
  observedAt: string
  sourceTxHash: string | null
  blockNumber: number | null
  calcVersion: number
  payload: RecipientCoveragePayload
}> {
  let calcVersion = options.calcVersion ?? 'latest'
  if (calcVersion === 'latest') {
    const row = database.prepare(`
      SELECT MAX(calc_version) AS version
      FROM validator_observations
      WHERE observation_type = ? AND validator_address = ?
    `).get(RECIPIENT_COVERAGE_OBSERVATION_TYPE, validatorAddress) as {
      version: number | null
    }
    if (row.version === null) return []
    calcVersion = row.version
  }

  const rows = database.prepare(`
    SELECT id, observed_at, source_tx_hash, block_number, calc_version, payload_json
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = ?
      AND calc_version = ?
    ORDER BY observed_at ASC, id ASC
  `).all(
    validatorAddress,
    RECIPIENT_COVERAGE_OBSERVATION_TYPE,
    calcVersion,
  ) as Array<{
    id: number
    observed_at: string
    source_tx_hash: string | null
    block_number: number | null
    calc_version: number
    payload_json: string
  }>

  return rows.map((row) => ({
    id: row.id,
    observedAt: row.observed_at,
    sourceTxHash: row.source_tx_hash,
    blockNumber: row.block_number,
    calcVersion: row.calc_version,
    payload: JSON.parse(row.payload_json) as RecipientCoveragePayload,
  }))
}

/**
 * DATA-MODEL.md §2 step 6 pipeline: payout-run grouping, schedule adherence,
 * then recipient coverage. Prefer this from the indexer so observation types
 * stay in sync for the same calc_version.
 */
export function classifyObservationsForRewardAddress(
  database: Database.Database,
  rewardAddress: string,
  options: {
    calcVersion?: number
    windowMinutes?: number
    validatorAddress?: string
    /** Optional known staker set for coverage (default: no set → nulls). */
    knownStakers?: readonly string[] | null
  } = {},
): {
  runs: ClassifyPayoutRunsResult
  adherence: ClassifyScheduleAdherenceResult | null
  coverage: ClassifyRecipientCoverageResult | null
} {
  const runs = classifyPayoutRunsForRewardAddress(database, rewardAddress, options)
  if (runs.skipped || runs.validatorAddress == null) {
    return { runs, adherence: null, coverage: null }
  }
  const calcVersion = options.calcVersion ?? runs.calcVersion
  const adherence = classifyScheduleAdherenceForValidator(database, runs.validatorAddress, {
    calcVersion,
    rewardAddress,
  })
  const coverage = classifyRecipientCoverageForValidator(database, runs.validatorAddress, {
    calcVersion,
    knownStakers: options.knownStakers,
  })
  return { runs, adherence, coverage }
}

/** Re-export run payload type for callers that score from payloads. */
export type { PayoutRunPayload }
