/**
 * P2-07 — History depth + response freshness helpers (API.md §1, METHODOLOGY.md §1).
 *
 * - `historyDepthDays`: earliest indexed relevant tx/observation → now
 * - Stale detection: indexer watermark older than 2× poll cadence → status `"stale"`
 * - Stateful envelope builders for consistent `updatedAt` / `source` / `status` /
 *   `dataFreshness` across public + authenticated endpoints
 */

import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'

/** API.md §1 `source` values. */
export type EnvelopeSource = 'rpc' | 'registry' | 'indexer' | 'cache' | 'provider'

/** API.md §1 `status` values. */
export type EnvelopeStatus = 'ok' | 'stale' | 'partial' | 'unavailable'

export interface DataFreshness {
  ageSeconds: number
  /** Present when the payload is history-backed (validators, observations, continuity). */
  historyDepthDays?: number
}

export interface StatefulEnvelope<T> {
  updatedAt: string
  source: EnvelopeSource
  status: EnvelopeStatus
  dataFreshness: DataFreshness
  data: T
}

/**
 * Default indexer poll cadence (SPEC §8.8 / index.ts: INDEXER_INTERVAL_MINUTES).
 * Stale when watermark age exceeds `STALE_CADENCE_MULTIPLIER ×` this interval.
 */
export const DEFAULT_INDEXER_INTERVAL_MINUTES = 45

/** Indexer watermark older than this many poll intervals → status `"stale"`. */
export const STALE_CADENCE_MULTIPLIER = 2

const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

/**
 * Age of an ISO timestamp relative to `nowMs`, floored to whole seconds.
 * Invalid/missing timestamps yield 0 (caller decides status).
 */
export function ageSeconds(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, Math.floor((nowMs - parsed) / 1000))
}

/**
 * Days from an earliest indexed moment to now. Fractional (one decimal place
 * when used as display depth); never negative. Returns 0 when earliest is missing
 * or unparsable.
 */
export function historyDepthDaysFromEarliest(
  earliestIso: string | null | undefined,
  nowMs: number,
): number {
  if (!earliestIso) return 0
  const earliestMs = Date.parse(earliestIso)
  if (Number.isNaN(earliestMs)) return 0
  return Math.max(0, (nowMs - earliestMs) / MS_PER_DAY)
}

/**
 * Indexer poll cadence in milliseconds from env (`INDEXER_INTERVAL_MINUTES`).
 * Mirrors the clamp used by `server/src/index.ts` (30–180 minutes).
 */
export function indexerPollCadenceMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configured = Number(env.INDEXER_INTERVAL_MINUTES ?? DEFAULT_INDEXER_INTERVAL_MINUTES)
  const minutes = Number.isFinite(configured)
    ? Math.min(180, Math.max(30, configured))
    : DEFAULT_INDEXER_INTERVAL_MINUTES
  return minutes * MS_PER_MINUTE
}

/** Age threshold after which the indexer is considered stale. */
export function staleThresholdMs(pollCadenceMs?: number): number {
  return STALE_CADENCE_MULTIPLIER * (pollCadenceMs ?? indexerPollCadenceMs())
}

/**
 * True when a watermark ISO is older than 2× poll cadence.
 * Missing/invalid watermark → not stale (nothing to age against).
 */
export function isWatermarkStale(
  watermarkIso: string | null | undefined,
  nowMs: number,
  pollCadenceMs?: number,
): boolean {
  if (!watermarkIso) return false
  const parsed = Date.parse(watermarkIso)
  if (Number.isNaN(parsed)) return false
  const ageMs = nowMs - parsed
  return ageMs > staleThresholdMs(pollCadenceMs)
}

/**
 * Newest `index_cursors.updated_at` across all sources — the global indexer watermark.
 * Null when the indexer has never written a cursor.
 */
export function getIndexerWatermarkIso(
  database: Database.Database,
): string | null {
  const row = database.prepare(`
    SELECT MAX(updated_at) AS newest
    FROM index_cursors
  `).get() as { newest: string | null } | undefined
  return row?.newest ?? null
}

/**
 * Cursor watermark for a single reward/indexed address (any source).
 */
export function getAddressIndexerWatermarkIso(
  database: Database.Database,
  address: string,
): string | null {
  const normalized = normalizeAddress(address)
  const row = database.prepare(`
    SELECT MAX(updated_at) AS newest
    FROM index_cursors
    WHERE UPPER(REPLACE(address, ' ', '')) = ?
  `).get(normalized) as { newest: string | null } | undefined
  return row?.newest ?? null
}

/**
 * Apply stale detection to a base envelope status.
 * Never upgrades `unavailable` → `stale`. Does not demote `partial` away from partial
 * when fresh; only marks `ok` / `partial` as `stale` when the watermark is old.
 */
export function applyIndexerStaleStatus(
  baseStatus: EnvelopeStatus,
  options: {
    nowMs: number
    watermarkIso?: string | null
    pollCadenceMs?: number
  },
): EnvelopeStatus {
  if (baseStatus === 'unavailable') return baseStatus
  if (isWatermarkStale(options.watermarkIso, options.nowMs, options.pollCadenceMs)) {
    return 'stale'
  }
  return baseStatus
}

export interface BuildEnvelopeOptions<T> {
  updatedAt: string
  source: EnvelopeSource
  /** Base status before stale detection. */
  status: EnvelopeStatus
  data: T
  nowMs?: number
  historyDepthDays?: number
  /**
   * When provided, may flip `ok`/`partial` → `stale` if older than 2× cadence.
   * Omit when the endpoint is pure registry/RPC with no indexer dependency.
   */
  indexerWatermarkIso?: string | null
  pollCadenceMs?: number
  /**
   * ISO used for `dataFreshness.ageSeconds`. Defaults to `updatedAt`.
   * Pass the indexer watermark when `updatedAt` is wall-clock "now" but the
   * underlying indexed data is older.
   */
  ageFromIso?: string | null
}

/**
 * Build a complete API.md §1 stateful envelope.
 */
export function buildStatefulEnvelope<T>(
  options: BuildEnvelopeOptions<T>,
): StatefulEnvelope<T> {
  const nowMs = options.nowMs ?? Date.now()
  const status = applyIndexerStaleStatus(options.status, {
    nowMs,
    watermarkIso: options.indexerWatermarkIso,
    pollCadenceMs: options.pollCadenceMs,
  })
  const ageIso = options.ageFromIso ?? options.updatedAt
  const freshness: DataFreshness = {
    ageSeconds: ageSeconds(ageIso, nowMs),
  }
  if (options.historyDepthDays !== undefined) {
    freshness.historyDepthDays = options.historyDepthDays
  }
  return {
    updatedAt: options.updatedAt,
    source: options.source,
    status,
    dataFreshness: freshness,
    data: options.data,
  }
}

/**
 * Earliest ISO timestamp among indexed payout-run observations for a validator.
 * Prefers `payload.windowStart`; falls back to `observed_at`.
 */
export function earliestPayoutRunAt(
  database: Database.Database,
  validatorAddress: string,
): string | null {
  const rows = database.prepare(`
    SELECT observed_at, payload_json
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = 'payout-run'
  `).all(validatorAddress) as Array<{ observed_at: string; payload_json: string }>

  let earliestMs = Number.POSITIVE_INFINITY
  let earliestIso: string | null = null

  for (const row of rows) {
    let candidate = row.observed_at
    try {
      const payload = JSON.parse(row.payload_json) as { windowStart?: unknown }
      if (typeof payload.windowStart === 'string' && payload.windowStart.length > 0) {
        candidate = payload.windowStart
      }
    } catch {
      // use observed_at
    }
    const ms = Date.parse(candidate)
    if (!Number.isNaN(ms) && ms < earliestMs) {
      earliestMs = ms
      earliestIso = candidate
    }
  }

  return earliestIso
}

/**
 * Earliest outbound tx timestamp from a reward address (indexed chain history).
 */
export function earliestOutboundTxAt(
  database: Database.Database,
  rewardAddress: string,
): string | null {
  const normalized = normalizeAddress(rewardAddress)
  // Address storage may be spaced or compact; compare normalized form.
  const row = database.prepare(`
    SELECT MIN(timestamp) AS earliest
    FROM transactions
    WHERE UPPER(REPLACE(from_address, ' ', '')) = ?
  `).get(normalized) as { earliest: string | null } | undefined
  return row?.earliest ?? null
}

/**
 * `historyDepthDays` for a validator: earliest indexed relevant tx/observation → now.
 * Considers payout-run observations and (when `rewardAddress` is set) outbound txs.
 */
export function computeHistoryDepthDays(
  database: Database.Database,
  options: {
    validatorAddress: string
    rewardAddress?: string | null
    nowMs?: number
  },
): number {
  const nowMs = options.nowMs ?? Date.now()
  const candidates: string[] = []

  const runEarliest = earliestPayoutRunAt(database, options.validatorAddress)
  if (runEarliest) candidates.push(runEarliest)

  if (options.rewardAddress) {
    const txEarliest = earliestOutboundTxAt(database, options.rewardAddress)
    if (txEarliest) candidates.push(txEarliest)
  }

  if (candidates.length === 0) return 0

  let earliestMs = Number.POSITIVE_INFINITY
  let earliestIso: string | null = null
  for (const iso of candidates) {
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms) && ms < earliestMs) {
      earliestMs = ms
      earliestIso = iso
    }
  }
  return historyDepthDaysFromEarliest(earliestIso, nowMs)
}

/**
 * Batch history depth (days) for many validators from payout-run observations.
 * Keyed by compact (space-stripped uppercase) address. Does not scan transactions
 * (list path stays O(observations)).
 */
export function loadHistoryDepthDaysByValidator(
  database: Database.Database,
  nowMs: number = Date.now(),
): Map<string, number> {
  const map = new Map<string, number>()
  const rows = database.prepare(`
    SELECT validator_address, observed_at, payload_json
    FROM validator_observations
    WHERE observation_type = 'payout-run'
  `).all() as Array<{
    validator_address: string
    observed_at: string
    payload_json: string
  }>

  const earliestByKey = new Map<string, number>()

  for (const row of rows) {
    const key = normalizeAddress(row.validator_address)
    let candidate = row.observed_at
    try {
      const payload = JSON.parse(row.payload_json) as { windowStart?: unknown }
      if (typeof payload.windowStart === 'string' && payload.windowStart.length > 0) {
        candidate = payload.windowStart
      }
    } catch {
      // use observed_at
    }
    const ms = Date.parse(candidate)
    if (Number.isNaN(ms)) continue
    const prev = earliestByKey.get(key)
    if (prev === undefined || ms < prev) {
      earliestByKey.set(key, ms)
    }
  }

  for (const [key, earliestMs] of earliestByKey) {
    map.set(key, Math.max(0, (nowMs - earliestMs) / MS_PER_DAY))
  }
  return map
}

/**
 * Convenience: age + optional history depth for `dataFreshness`.
 */
export function buildDataFreshness(options: {
  updatedAt: string | null | undefined
  nowMs: number
  historyDepthDays?: number
  /** Prefer this ISO for age when `updatedAt` is wall-clock now. */
  ageFromIso?: string | null
}): DataFreshness {
  const ageIso = options.ageFromIso ?? options.updatedAt
  const freshness: DataFreshness = {
    ageSeconds: ageSeconds(ageIso, options.nowMs),
  }
  if (options.historyDepthDays !== undefined) {
    freshness.historyDepthDays = options.historyDepthDays
  }
  return freshness
}
