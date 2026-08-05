/**
 * Observed payment floor from indexed reward-address outflows.
 *
 * Inferred metric (METHODOLOGY.md §2): not a registry declaration and not proof
 * of operator policy. Prefer p5 over absolute min (dust under hard floors).
 *
 * Request path: read precomputed rows from `payment_floors` only (no tx scan).
 * Background: `refreshPaymentFloors` scans transactions and upserts weekly.
 */

import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'

export const LUNA_PER_NIM = 100_000

/** Minimum sample size before we surface a numeric floor. */
export const PAYMENT_FLOOR_MIN_SAMPLES = 50
/** Minimum distinct recipients for multi-staker-like series. */
export const PAYMENT_FLOOR_MIN_RECIPIENTS = 3
/** Prefer ≥7 days history (SPEC indexer target); still show with shorter depth if samples pass. */
export const PAYMENT_FLOOR_TARGET_DEPTH_DAYS = 7

/** Full recompute cadence (user requirement: update every week). */
export const PAYMENT_FLOOR_REFRESH_MS = 7 * 24 * 60 * 60_000
/** How often the scheduler checks whether a weekly refresh is due. */
export const PAYMENT_FLOOR_CHECK_INTERVAL_MS = 60 * 60_000

/** Short in-process cache of DB rows (not a recompute TTL). */
const MEMORY_READ_TTL_MS = 60_000

export type PaymentFloorStatus = 'inferred' | 'insufficient' | 'unavailable'

/** API shape on list/profile items. */
export interface ObservedPaymentFloor {
  /** Absolute minimum outbound payment (NIM). Sensitive to dust. */
  minNim: number | null
  /** 5th percentile (NIM) — preferred display floor. */
  p5Nim: number | null
  sampleSize: number
  recipientCount: number
  historyDepthDays: number | null
  status: PaymentFloorStatus
  /** ISO time of this computation. */
  computedAt: string
}

export interface PaymentFloorRefreshResult {
  count: number
  computedAt: string
  durationMs: number
}

interface ValidatorRewardRow {
  address: string
  reward_address: string | null
}

interface PaymentFloorRow {
  validator_address: string
  min_nim: number | null
  p5_nim: number | null
  sample_size: number
  recipient_count: number
  history_depth_days: number | null
  status: string
  computed_at: string
}

interface MemoryCache {
  expiresAt: number
  byValidatorCompact: Map<string, ObservedPaymentFloor>
  lastComputedAt: string | null
}

let memoryCache: MemoryCache | null = null

function compactSafe(address: string): string | null {
  try {
    return normalizeAddress(address)
  } catch {
    const stripped = address.replace(/\s+/g, '').toUpperCase()
    return stripped.length > 0 ? stripped : null
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]!
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! * (hi - i) + sorted[hi]! * (i - lo)
}

function historyDepthDays(timestamps: string[]): number | null {
  if (timestamps.length < 2) return null
  const sorted = [...timestamps].sort()
  const a = Date.parse(sorted[0]!)
  const b = Date.parse(sorted[sorted.length - 1]!)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, (b - a) / 86_400_000)
}

function toNim(luna: number): number {
  return luna / LUNA_PER_NIM
}

function emptyFloor(computedAt: string, status: PaymentFloorStatus): ObservedPaymentFloor {
  return {
    minNim: null,
    p5Nim: null,
    sampleSize: 0,
    recipientCount: 0,
    historyDepthDays: null,
    status,
    computedAt,
  }
}

function asStatus(value: string): PaymentFloorStatus {
  if (value === 'inferred' || value === 'insufficient' || value === 'unavailable') {
    return value
  }
  return 'unavailable'
}

function rowToFloor(row: PaymentFloorRow): ObservedPaymentFloor {
  return {
    minNim: row.min_nim,
    p5Nim: row.p5_nim,
    sampleSize: row.sample_size,
    recipientCount: row.recipient_count,
    historyDepthDays: row.history_depth_days,
    status: asStatus(row.status),
    computedAt: row.computed_at,
  }
}

/**
 * Build floors for all validators that have a reward address.
 * Single pass over matching outbound txs. Does not write to SQLite.
 */
export function computePaymentFloors(
  database: Database.Database,
  options?: { nowMs?: number },
): Map<string, ObservedPaymentFloor> {
  const nowMs = options?.nowMs ?? Date.now()
  const computedAt = new Date(nowMs).toISOString()
  const result = new Map<string, ObservedPaymentFloor>()

  const validators = database
    .prepare(
      `SELECT address, reward_address FROM validators
       WHERE reward_address IS NOT NULL AND reward_address != ''`,
    )
    .all() as ValidatorRewardRow[]

  /** reward compact → validator compact */
  const rewardToValidator = new Map<string, string>()
  const selfSetByReward = new Map<string, Set<string>>()

  for (const row of validators) {
    const vCompact = compactSafe(row.address)
    const rCompact = compactSafe(row.reward_address ?? '')
    if (!vCompact || !rCompact) continue
    rewardToValidator.set(rCompact, vCompact)
    selfSetByReward.set(rCompact, new Set([rCompact, vCompact]))
    result.set(vCompact, emptyFloor(computedAt, 'unavailable'))
  }

  if (rewardToValidator.size === 0) return result

  const amountsByReward = new Map<
    string,
    { luna: number[]; recipients: Set<string>; timestamps: string[] }
  >()

  const txRows = database
    .prepare(
      `SELECT from_address, to_address, value_luna, timestamp
       FROM transactions
       WHERE execution_result = 'ok' AND value_luna > 0`,
    )
    .all() as Array<{
    from_address: string
    to_address: string
    value_luna: number
    timestamp: string
  }>

  for (const tx of txRows) {
    const from = compactSafe(tx.from_address)
    if (!from || !rewardToValidator.has(from)) continue
    const to = compactSafe(tx.to_address)
    const self = selfSetByReward.get(from)
    if (to && self?.has(to)) continue

    let bucket = amountsByReward.get(from)
    if (!bucket) {
      bucket = { luna: [], recipients: new Set(), timestamps: [] }
      amountsByReward.set(from, bucket)
    }
    bucket.luna.push(tx.value_luna)
    if (to) bucket.recipients.add(to)
    if (tx.timestamp) bucket.timestamps.push(tx.timestamp)
  }

  for (const [rewardCompact, bucket] of amountsByReward) {
    const vCompact = rewardToValidator.get(rewardCompact)
    if (!vCompact) continue
    const sorted = bucket.luna.slice().sort((a, b) => a - b)
    const sampleSize = sorted.length
    const recipientCount = bucket.recipients.size
    const depth = historyDepthDays(bucket.timestamps)
    const minNim = sampleSize > 0 ? toNim(sorted[0]!) : null
    const p5Nim = percentile(sorted, 0.05)
    const p5Display = p5Nim == null ? null : toNim(p5Nim)

    let status: PaymentFloorStatus = 'inferred'
    if (
      sampleSize < PAYMENT_FLOOR_MIN_SAMPLES ||
      recipientCount < PAYMENT_FLOOR_MIN_RECIPIENTS
    ) {
      status = 'insufficient'
    }

    result.set(vCompact, {
      minNim,
      p5Nim: p5Display,
      sampleSize,
      recipientCount,
      historyDepthDays: depth,
      status,
      computedAt,
    })
  }

  return result
}

/** Max `computed_at` across the payment_floors table, or null when empty. */
export function getPaymentFloorLastComputedAt(
  database: Database.Database,
): string | null {
  const row = database
    .prepare(`SELECT MAX(computed_at) AS m FROM payment_floors`)
    .get() as { m: string | null } | undefined
  const m = row?.m
  return typeof m === 'string' && m.length > 0 ? m : null
}

/**
 * True when the table is empty or the newest row is older than the weekly window.
 */
export function isPaymentFloorRefreshDue(
  database: Database.Database,
  nowMs: number = Date.now(),
  refreshMs: number = PAYMENT_FLOOR_REFRESH_MS,
): boolean {
  const last = getPaymentFloorLastComputedAt(database)
  if (!last) return true
  const ms = Date.parse(last)
  if (!Number.isFinite(ms)) return true
  return nowMs - ms >= refreshMs
}

/** Persist a computed map (replaces all rows in one transaction). */
export function persistPaymentFloors(
  database: Database.Database,
  floors: Map<string, ObservedPaymentFloor>,
): void {
  const upsert = database.prepare(`
    INSERT INTO payment_floors (
      validator_address, min_nim, p5_nim, sample_size, recipient_count,
      history_depth_days, status, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(validator_address) DO UPDATE SET
      min_nim = excluded.min_nim,
      p5_nim = excluded.p5_nim,
      sample_size = excluded.sample_size,
      recipient_count = excluded.recipient_count,
      history_depth_days = excluded.history_depth_days,
      status = excluded.status,
      computed_at = excluded.computed_at
  `)

  const keep = [...floors.keys()]
  const run = database.transaction(() => {
    if (keep.length === 0) {
      database.prepare(`DELETE FROM payment_floors`).run()
      return
    }
    // Drop validators that disappeared from the registry / lost reward address.
    const placeholders = keep.map(() => '?').join(',')
    database
      .prepare(
        `DELETE FROM payment_floors WHERE validator_address NOT IN (${placeholders})`,
      )
      .run(...keep)
    for (const [address, floor] of floors) {
      upsert.run(
        address,
        floor.minNim,
        floor.p5Nim,
        floor.sampleSize,
        floor.recipientCount,
        floor.historyDepthDays,
        floor.status,
        floor.computedAt,
      )
    }
  })
  run()
  memoryCache = null
}

/**
 * Full recompute from `transactions` + persist. Call from the weekly scheduler
 * (or tests). Never invoke on the public request path.
 */
export function refreshPaymentFloors(
  database: Database.Database,
  options?: { nowMs?: number; logger?: (line: string) => void },
): PaymentFloorRefreshResult {
  const started = performance.now()
  const nowMs = options?.nowMs ?? Date.now()
  const floors = computePaymentFloors(database, { nowMs })
  persistPaymentFloors(database, floors)
  const computedAt =
    floors.values().next().value?.computedAt ?? new Date(nowMs).toISOString()
  const durationMs = Math.round(performance.now() - started)
  const result: PaymentFloorRefreshResult = {
    count: floors.size,
    computedAt,
    durationMs,
  }
  const logger = options?.logger ?? ((line: string) => console.log(line))
  logger(
    JSON.stringify({
      paymentFloors: 'refresh',
      count: result.count,
      computedAt: result.computedAt,
      durationMs: result.durationMs,
    }),
  )
  // Warm memory cache from the map we just built.
  memoryCache = {
    expiresAt: Date.now() + MEMORY_READ_TTL_MS,
    byValidatorCompact: floors,
    lastComputedAt: computedAt,
  }
  return result
}

/** Read precomputed floors from SQLite (no transaction scan). */
export function loadPaymentFloorsFromDb(
  database: Database.Database,
): Map<string, ObservedPaymentFloor> {
  const rows = database
    .prepare(
      `SELECT validator_address, min_nim, p5_nim, sample_size, recipient_count,
              history_depth_days, status, computed_at
       FROM payment_floors`,
    )
    .all() as PaymentFloorRow[]

  const map = new Map<string, ObservedPaymentFloor>()
  for (const row of rows) {
    const key = compactSafe(row.validator_address) ?? row.validator_address
    map.set(key, rowToFloor(row))
  }
  return map
}

/**
 * Load floors for list/profile. Memory-cached DB reads only.
 * Pass `reload: true` to force a full recompute+persist (tests / operator tools).
 */
export function loadPaymentFloors(
  database: Database.Database,
  options?: { nowMs?: number; ttlMs?: number; reload?: boolean },
): Map<string, ObservedPaymentFloor> {
  const nowMs = options?.nowMs ?? Date.now()
  if (options?.reload === true) {
    // Force path for tests/ops; silence default log noise from request-adjacent helpers.
    refreshPaymentFloors(database, { nowMs, logger: () => {} })
    return memoryCache?.byValidatorCompact ?? loadPaymentFloorsFromDb(database)
  }
  const ttlMs = options?.ttlMs ?? MEMORY_READ_TTL_MS
  if (memoryCache && memoryCache.expiresAt > nowMs) {
    return memoryCache.byValidatorCompact
  }
  const byValidatorCompact = loadPaymentFloorsFromDb(database)
  const lastComputedAt = getPaymentFloorLastComputedAt(database)
  memoryCache = {
    expiresAt: nowMs + ttlMs,
    byValidatorCompact,
    lastComputedAt,
  }
  return byValidatorCompact
}

export function getObservedPaymentFloor(
  database: Database.Database,
  validatorAddress: string,
  options?: { nowMs?: number; reload?: boolean },
): ObservedPaymentFloor {
  const floors = loadPaymentFloors(database, options)
  let compact: string
  try {
    compact = normalizeAddress(validatorAddress)
  } catch {
    return emptyFloor(
      new Date(options?.nowMs ?? Date.now()).toISOString(),
      'unavailable',
    )
  }
  return (
    floors.get(compact) ??
    emptyFloor(
      new Date(options?.nowMs ?? Date.now()).toISOString(),
      'unavailable',
    )
  )
}

/**
 * Weekly refresh scheduler. Checks hourly whether a recompute is due
 * (empty table or last computed_at older than 7 days). Runs once on start when due.
 */
export function startPaymentFloorScheduler(
  database: Database.Database,
  options?: {
    /** Override weekly age threshold (tests). Default 7 days. */
    refreshMs?: number
    /** How often to check due (default 1h). */
    checkIntervalMs?: number
    logger?: (line: string) => void
    /** When false, skip the immediate due check (tests). Default true. */
    runIfDueOnStart?: boolean
  },
): { stop: () => void; runNow: () => PaymentFloorRefreshResult | null } {
  const refreshMs = options?.refreshMs ?? PAYMENT_FLOOR_REFRESH_MS
  const checkIntervalMs = options?.checkIntervalMs ?? PAYMENT_FLOOR_CHECK_INTERVAL_MS
  const logger = options?.logger ?? ((line: string) => console.log(line))
  let running = false

  const runNow = (): PaymentFloorRefreshResult | null => {
    if (running) return null
    running = true
    try {
      return refreshPaymentFloors(database, { logger })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger(JSON.stringify({ paymentFloors: 'refresh-error', error: message }))
      return null
    } finally {
      running = false
    }
  }

  const maybeRun = (): void => {
    if (isPaymentFloorRefreshDue(database, Date.now(), refreshMs)) {
      void Promise.resolve().then(() => runNow())
    }
  }

  if (options?.runIfDueOnStart !== false) {
    maybeRun()
  }

  const timer = setInterval(maybeRun, checkIntervalMs)
  // Unref so the timer does not keep the process alive alone in tests.
  if (typeof timer.unref === 'function') timer.unref()

  return {
    stop: () => clearInterval(timer),
    runNow,
  }
}

/** Test helper. */
export function resetPaymentFloorCache(): void {
  memoryCache = null
}
