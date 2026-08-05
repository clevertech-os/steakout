/**
 * Observed payment floor from indexed reward-address outflows.
 *
 * Inferred metric (METHODOLOGY.md §2): not a registry declaration and not proof
 * of operator policy. Prefer p5 over absolute min (dust under hard floors).
 *
 * Stats are scanned from `transactions` and cached in-process (TTL).
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

const DEFAULT_CACHE_TTL_MS = 5 * 60_000

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

interface ValidatorRewardRow {
  address: string
  reward_address: string | null
}

interface TxLite {
  value_luna: number
  to_address: string
  timestamp: string
}

interface CacheEntry {
  expiresAt: number
  byValidatorCompact: Map<string, ObservedPaymentFloor>
  computedAt: string
}

let cache: CacheEntry | null = null

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

/**
 * Build floors for all validators that have a reward address.
 * Single pass over matching outbound txs.
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

  // Group amounts by reward address (exclude self / validator loops).
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

export function loadPaymentFloors(
  database: Database.Database,
  options?: { nowMs?: number; ttlMs?: number; reload?: boolean },
): Map<string, ObservedPaymentFloor> {
  const nowMs = options?.nowMs ?? Date.now()
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  if (
    !options?.reload &&
    cache &&
    cache.expiresAt > nowMs
  ) {
    return cache.byValidatorCompact
  }
  const byValidatorCompact = computePaymentFloors(database, { nowMs })
  const computedAt =
    byValidatorCompact.values().next().value?.computedAt ??
    new Date(nowMs).toISOString()
  cache = {
    expiresAt: nowMs + ttlMs,
    byValidatorCompact,
    computedAt,
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
    return emptyFloor(new Date(options?.nowMs ?? Date.now()).toISOString(), 'unavailable')
  }
  return (
    floors.get(compact) ??
    emptyFloor(new Date(options?.nowMs ?? Date.now()).toISOString(), 'unavailable')
  )
}

/** Test helper. */
export function resetPaymentFloorCache(): void {
  cache = null
}
