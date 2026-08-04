import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'

/** Gap-based payout-run window (METHODOLOGY.md §4.1 / P0-07 spike). */
export const DEFAULT_RUN_WINDOW_MINUTES = 60

/**
 * Classifier calc version. Bump when grouping or observation semantics change
 * (METHODOLOGY.md §9). Keep in sync with client `learn/calcVersion.ts`.
 */
export const CALC_VERSION = 2

export const PAYOUT_RUN_OBSERVATION_TYPE = 'payout-run' as const

/** Status for chain-derived payout-run rows (METHODOLOGY.md §2). */
export const PAYOUT_RUN_STATUS = 'verified' as const

export interface PayoutTransaction {
  hash: string
  toAddress: string
  valueLuna: number
  blockNumber: number
  timestamp: string
  executionResult: 'ok' | 'failed' | 'reverted'
}

export interface PayoutRun {
  startedAt: string
  endedAt: string
  txCount: number
  recipientCount: number
  recipients: string[]
  firstBlock: number
  lastBlock: number
  firstTxHash: string
  lastTxHash: string
  txHashes: string[]
  totalValueLuna: number
}

/**
 * Stored JSON for `validator_observations.payload_json` when
 * `observation_type = 'payout-run'`. Matches API run fields (API.md §3) plus
 * window end and identity hashes for re-classification.
 */
export interface PayoutRunPayload {
  windowStart: string
  windowEnd: string
  txCount: number
  recipientCount: number
  recipients: string[]
  blockRange: [number, number]
  txHashes: string[]
  firstTxHash: string
  lastTxHash: string
  totalValueLuna: number
  windowMinutes: number
}

export interface GroupPayoutRunsOptions {
  windowMinutes?: number
}

export interface PersistPayoutRunsOptions {
  validatorAddress: string
  runs: readonly PayoutRun[]
  calcVersion?: number
  windowMinutes?: number
}

export interface PersistPayoutRunsResult {
  inserted: number
  updated: number
  removed: number
  runCount: number
}

export interface ClassifyPayoutRunsOptions {
  /** Override validator row; default resolves via reward_address / self-address. */
  validatorAddress?: string
  calcVersion?: number
  windowMinutes?: number
}

export interface ClassifyPayoutRunsResult {
  rewardAddress: string
  validatorAddress: string | null
  calcVersion: number
  runCount: number
  inserted: number
  updated: number
  removed: number
  skipped: boolean
  skipReason: string | null
}

interface TransactionRow {
  hash: string
  to_address: string
  value_luna: number
  block_number: number
  timestamp: string
  execution_result: 'ok' | 'failed' | 'reverted'
}

interface ObservationRow {
  id: number
  source_tx_hash: string | null
  observed_at: string
  block_number: number | null
  payload_json: string
  status: string
}

function transactionTime(transaction: PayoutTransaction): number {
  const time = Date.parse(transaction.timestamp)
  if (Number.isNaN(time)) {
    throw new Error(`Transaction ${transaction.hash} timestamp is malformed`)
  }
  return time
}

// Gap-based sessionization: a transaction joins the current run when it occurs
// within `windowMinutes` of the previous transaction (sliding window). Runs are
// pure observed groupings; no fee, intent, or payout-purpose claim is made here.
export function groupPayoutRuns(
  transactions: readonly PayoutTransaction[],
  options: GroupPayoutRunsOptions = {},
): PayoutRun[] {
  const windowMs = Math.max(1, options.windowMinutes ?? DEFAULT_RUN_WINDOW_MINUTES) * 60_000
  const ordered = transactions
    .filter((transaction) => transaction.executionResult === 'ok')
    .map((transaction) => ({ transaction, time: transactionTime(transaction) }))
    .sort((a, b) => a.time - b.time || a.transaction.hash.localeCompare(b.transaction.hash))

  const runs: PayoutRun[] = []
  let current: Array<{ transaction: PayoutTransaction; time: number }> = []

  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]
    const last = current[current.length - 1]
    const recipients = [...new Set(current.map(({ transaction }) => transaction.toAddress))].sort()
    runs.push({
      startedAt: new Date(first.time).toISOString(),
      endedAt: new Date(last.time).toISOString(),
      txCount: current.length,
      recipientCount: recipients.length,
      recipients,
      firstBlock: Math.min(...current.map(({ transaction }) => transaction.blockNumber)),
      lastBlock: Math.max(...current.map(({ transaction }) => transaction.blockNumber)),
      firstTxHash: first.transaction.hash,
      lastTxHash: last.transaction.hash,
      txHashes: current.map(({ transaction }) => transaction.hash),
      totalValueLuna: current.reduce((total, { transaction }) => total + transaction.valueLuna, 0),
    })
    current = []
  }

  for (const entry of ordered) {
    const previous = current[current.length - 1]
    if (previous !== undefined && entry.time - previous.time > windowMs) flush()
    current.push(entry)
  }
  flush()

  return runs
}

export function payoutRunToPayload(
  run: PayoutRun,
  windowMinutes: number = DEFAULT_RUN_WINDOW_MINUTES,
): PayoutRunPayload {
  return {
    windowStart: run.startedAt,
    windowEnd: run.endedAt,
    txCount: run.txCount,
    recipientCount: run.recipientCount,
    recipients: run.recipients,
    blockRange: [run.firstBlock, run.lastBlock],
    txHashes: run.txHashes,
    firstTxHash: run.firstTxHash,
    lastTxHash: run.lastTxHash,
    totalValueLuna: run.totalValueLuna,
    windowMinutes,
  }
}

/**
 * Resolve the validators.address row that owns a reward address.
 * Prefers `reward_address` match; falls back to self-reward (`address` == reward).
 * Comparison is space-insensitive (addresses.ts normalize).
 */
export function resolveValidatorAddressForReward(
  database: Database.Database,
  rewardAddress: string,
): string | null {
  const target = normalizeAddress(rewardAddress)
  if (target === '') return null

  const rows = database.prepare(`
    SELECT address, reward_address FROM validators
  `).all() as Array<{ address: string; reward_address: string | null }>

  for (const row of rows) {
    if (row.reward_address != null && normalizeAddress(row.reward_address) === target) {
      return row.address
    }
  }
  for (const row of rows) {
    if (normalizeAddress(row.address) === target) {
      return row.address
    }
  }
  return null
}

/**
 * Load outbound transactions from the reward address (exact DB string match first;
 * falls back to space-stripped match for mixed formatting).
 */
export function loadOutboundTransactions(
  database: Database.Database,
  rewardAddress: string,
): PayoutTransaction[] {
  const exact = database.prepare(`
    SELECT hash, to_address, value_luna, block_number, timestamp, execution_result
    FROM transactions
    WHERE from_address = ?
    ORDER BY timestamp ASC, hash ASC
  `).all(rewardAddress) as TransactionRow[]

  let rows = exact
  if (rows.length === 0) {
    const target = normalizeAddress(rewardAddress)
    rows = (database.prepare(`
      SELECT hash, to_address, value_luna, block_number, timestamp, execution_result
      FROM transactions
      WHERE replace(upper(from_address), ' ', '') = ?
      ORDER BY timestamp ASC, hash ASC
    `).all(target) as TransactionRow[])
  }

  return rows.map((row) => ({
    hash: row.hash,
    toAddress: row.to_address,
    valueLuna: row.value_luna,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    executionResult: row.execution_result,
  }))
}

/**
 * Persist payout runs for one validator at a given calc_version.
 * Idempotent: identity key is (validator, type, calc_version, source_tx_hash=firstTxHash).
 * Same-version orphans (no longer produced by grouping) are removed so re-runs
 * over the same data never leave duplicate or stale runs. Other calc_versions
 * are never touched (append-only audit trail).
 */
export function persistPayoutRuns(
  database: Database.Database,
  options: PersistPayoutRunsOptions,
): PersistPayoutRunsResult {
  const calcVersion = options.calcVersion ?? CALC_VERSION
  const windowMinutes = options.windowMinutes ?? DEFAULT_RUN_WINDOW_MINUTES
  const validatorAddress = options.validatorAddress

  const existing = database.prepare(`
    SELECT id, source_tx_hash, observed_at, block_number, payload_json, status
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = ?
      AND calc_version = ?
  `).all(
    validatorAddress,
    PAYOUT_RUN_OBSERVATION_TYPE,
    calcVersion,
  ) as ObservationRow[]

  const bySourceHash = new Map<string, ObservationRow>()
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

    for (const run of options.runs) {
      const sourceTxHash = run.firstTxHash
      seen.add(sourceTxHash)
      const payload = payoutRunToPayload(run, windowMinutes)
      const payloadJson = JSON.stringify(payload)
      const observedAt = run.endedAt
      const blockNumber = run.firstBlock
      const prior = bySourceHash.get(sourceTxHash)

      if (prior === undefined) {
        insert.run(
          validatorAddress,
          PAYOUT_RUN_OBSERVATION_TYPE,
          PAYOUT_RUN_STATUS,
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
        || prior.status !== PAYOUT_RUN_STATUS
      ) {
        update.run(PAYOUT_RUN_STATUS, observedAt, blockNumber, payloadJson, prior.id)
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

    return { inserted, updated, removed, runCount: options.runs.length }
  })

  return sync()
}

/**
 * Full classify step for one reward address (DATA-MODEL.md §2 step 6):
 * load outbound txs → groupPayoutRuns → persist as payout-run observations.
 * Schedule adherence is scored after this by `observationScoring` (P2-03).
 * Skips cleanly when no validator row exists (FK); does not invent validators.
 */
export function classifyPayoutRunsForRewardAddress(
  database: Database.Database,
  rewardAddress: string,
  options: ClassifyPayoutRunsOptions = {},
): ClassifyPayoutRunsResult {
  const calcVersion = options.calcVersion ?? CALC_VERSION
  const windowMinutes = options.windowMinutes ?? DEFAULT_RUN_WINDOW_MINUTES
  const validatorAddress = options.validatorAddress
    ?? resolveValidatorAddressForReward(database, rewardAddress)

  if (validatorAddress == null) {
    return {
      rewardAddress,
      validatorAddress: null,
      calcVersion,
      runCount: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
      skipped: true,
      skipReason: 'no-validator-row',
    }
  }

  const transactions = loadOutboundTransactions(database, rewardAddress)
  const runs = groupPayoutRuns(transactions, { windowMinutes })
  const persisted = persistPayoutRuns(database, {
    validatorAddress,
    runs,
    calcVersion,
    windowMinutes,
  })

  return {
    rewardAddress,
    validatorAddress,
    calcVersion,
    runCount: persisted.runCount,
    inserted: persisted.inserted,
    updated: persisted.updated,
    removed: persisted.removed,
    skipped: false,
    skipReason: null,
  }
}

/**
 * Latest calc_version present for an observation type (optionally scoped to a
 * validator). Returns null when no rows exist.
 */
export function latestObservationCalcVersion(
  database: Database.Database,
  observationType: string,
  validatorAddress?: string,
): number | null {
  if (validatorAddress !== undefined) {
    const row = database.prepare(`
      SELECT MAX(calc_version) AS version
      FROM validator_observations
      WHERE observation_type = ? AND validator_address = ?
    `).get(observationType, validatorAddress) as { version: number | null }
    return row.version
  }
  const row = database.prepare(`
    SELECT MAX(calc_version) AS version
    FROM validator_observations
    WHERE observation_type = ?
  `).get(observationType) as { version: number | null }
  return row.version
}

/**
 * Read payout-run observations for a validator. Defaults to the latest
 * calc_version only (old versions retained but not returned).
 */
export function listPayoutRunObservations(
  database: Database.Database,
  validatorAddress: string,
  options: { calcVersion?: number | 'latest' } = {},
): Array<{
  id: number
  observedAt: string
  sourceTxHash: string | null
  blockNumber: number | null
  calcVersion: number
  payload: PayoutRunPayload
}> {
  let calcVersion = options.calcVersion ?? 'latest'
  if (calcVersion === 'latest') {
    const latest = latestObservationCalcVersion(
      database,
      PAYOUT_RUN_OBSERVATION_TYPE,
      validatorAddress,
    )
    if (latest === null) return []
    calcVersion = latest
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
    PAYOUT_RUN_OBSERVATION_TYPE,
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
    payload: JSON.parse(row.payload_json) as PayoutRunPayload,
  }))
}

/**
 * Result of mapping a registry-declared payout schedule string to an expected
 * cadence. Only the unambiguous forms in METHODOLOGY.md §4.2 are accepted:
 * `hourly`, `every N hours` / `hrs` / `hr` / `h`, `daily`, `twice daily`,
 * and hour-level cron `0 * * * *`, `0 star/N * * *`, `0 0 * * *`
 * (case/punctuation tolerant). Everything else is `normalizable: false` with
 * the raw declaration preserved. Never force free-text or minute-level cron
 * into a number.
 */
export interface NormalizedSchedule {
  normalizable: boolean
  /** Expected interval in hours when normalizable; otherwise null. */
  everyHours: number | null
  /** Original declaration (or null when input was null/undefined). */
  raw: string | null
}

/**
 * Collapse trivial punctuation/spacing so documented schedule forms match
 * without accepting minute-level, approximate, or free-text policies.
 */
function canonicalizeScheduleText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Hyphen/underscore only as word separators (e.g. "twice-daily", "every-12-hours").
    // Do not strip a free-standing minus (e.g. "every -3 hours" must stay rejected).
    .replace(/(?<=[a-z0-9])[-_]+(?=[a-z0-9])/g, ' ')
    .replace(/\s+/g, ' ')
    // Drop leading/trailing trivial punctuation only (not internal content).
    .replace(/^[.,;:!?]+|[.,;:!?]+$/g, '')
    .trim()
}

/**
 * Unambiguous 5-field cron with minute fixed to `0` only (METHODOLOGY §4.2):
 * - `0 * * * *` → 1 hour
 * - `0 star/N * * *` (N positive integer) → N hours
 * - `0 0 * * *` → 24 hours
 * Rejects minute steps, non-star day/month/dow, fixed non-zero hour, lists/ranges.
 */
function parseCronEveryHours(canonical: string): number | null {
  const parts = canonical.split(' ')
  if (parts.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null
  if (minute !== '0') return null

  if (hour === '*') return 1
  if (hour === '0') return 24

  const step = /^\*\/(\d+)$/.exec(hour)
  if (!step) return null
  const n = Number(step[1])
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

function parseEveryHours(canonical: string): number | null {
  if (canonical === 'hourly') return 1
  if (canonical === 'daily') return 24
  if (canonical === 'twice daily') return 12

  // hour / hours / hr / hrs / h (unambiguous hour-unit synonyms only).
  const every = /^every (\d+(?:\.\d+)?) (?:hours?|hrs?|h)$/.exec(canonical)
  if (every) {
    const hours = Number(every[1])
    if (!Number.isFinite(hours) || hours <= 0) return null
    return hours
  }

  return parseCronEveryHours(canonical)
}

/**
 * Normalize a declared payout schedule for adherence math (P2-03).
 * Pure function — does not grade validators or invent cadence from free text.
 */
export function normalizeSchedule(raw: string | null | undefined): NormalizedSchedule {
  if (raw === null || raw === undefined) {
    return { normalizable: false, everyHours: null, raw: null }
  }

  const everyHours = parseEveryHours(canonicalizeScheduleText(raw))
  if (everyHours === null) {
    return { normalizable: false, everyHours: null, raw }
  }
  return { normalizable: true, everyHours, raw }
}

/**
 * Convenience wrapper: interval hours or null when the schedule cannot be
 * normalized. Used by the P0-07 classify script; prefer `normalizeSchedule`
 * for new call sites that need the full `{ normalizable, everyHours, raw }`.
 */
export function normalizeScheduleHours(raw: string | null | undefined): number | null {
  return normalizeSchedule(raw).everyHours
}
