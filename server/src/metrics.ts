/**
 * P3-04 — Aggregate, disclosed product telemetry (SPEC §16).
 *
 * Server-side counters only. No third-party analytics, no pageviews-as-usage,
 * no raw addresses on the public endpoint. SPEC track list 1:1:
 *   - distinct connected wallets
 *   - staking intents / successful staking txs (computed from staking_intents when present)
 *   - validator profile views
 *   - repeat sessions
 *   - public profile shares
 *   - indexer history depth (computed, not stored)
 */

import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { historyDepthDaysFromEarliest } from './freshness.js'

/** Counter keys stored in `metrics` (incremented on events). */
export const METRIC_KEYS = {
  /** Successful POST /api/auth/verify (wallet connected). */
  authConnects: 'auth_connects',
  /** Successful verify when the user row already existed (return connect). */
  repeatSessions: 'repeat_sessions',
  /** GET /api/validators/:address that returned a registry profile (200). */
  validatorProfileViews: 'validator_profile_views',
  /** GET /validators/:address share HTML served for a valid address. */
  publicProfileShares: 'public_profile_shares',
} as const

export type MetricKey = (typeof METRIC_KEYS)[keyof typeof METRIC_KEYS]

/** Public aggregate payload — counts only, never addresses. */
export interface PublicMetrics {
  updatedAt: string
  disclosure: string
  metrics: {
    /** Approx distinct connected wallets = COUNT(users). */
    distinctConnectedWallets: number
    /** Successful auth verifies (each connect). */
    authConnects: number
    /** Return connects (user already known). */
    repeatSessions: number
    /** Validator profile API views. */
    validatorProfileViews: number
    /** Path-based share page hits (valid address). */
    publicProfileShares: number
    /**
     * Rows in staking_intents (intent create path writes rows).
     * Aggregate COUNT only — not an event counter.
     */
    stakingIntents: number
    /**
     * staking_intents with status = 'confirmed' (confirm matcher writes status).
     */
    stakingConfirmed: number
    /**
     * Max indexer history depth in whole days (from earliest indexed tx/observation → now).
     * Computed on read; not a stored counter.
     */
    indexerHistoryDepthDays: number
  }
  notes: {
    stakingIntents: string
    stakingConfirmed: string
    indexerHistoryDepthDays: string
  }
}

const DISCLOSURE =
  'Product metrics are aggregate counts only (no wallet addresses, names, emails, or locations). ' +
  'They match the disclosed SPEC §16 track list. No third-party analytics.'

export function incrementMetric(
  database: Database.Database,
  key: MetricKey,
  by = 1,
): void {
  if (!Number.isFinite(by) || by === 0) return
  const delta = Math.trunc(by)
  const nowIso = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO metrics (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = value + excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(key, delta, nowIso)
}

export function getMetric(database: Database.Database, key: MetricKey): number {
  const row = database
    .prepare(`SELECT value FROM metrics WHERE key = ?`)
    .get(key) as { value: number } | undefined
  return row?.value ?? 0
}

function countTable(database: Database.Database, sql: string): number {
  try {
    const row = database.prepare(sql).get() as { n: number } | undefined
    return typeof row?.n === 'number' && Number.isFinite(row.n) ? row.n : 0
  } catch {
    return 0
  }
}

/**
 * Earliest indexed moment for network history depth: prefer transactions.timestamp,
 * fall back to validator_observations.observed_at.
 */
export function earliestIndexedIso(database: Database.Database): string | null {
  try {
    const tx = database
      .prepare(
        `SELECT MIN(timestamp) AS earliest
         FROM transactions
         WHERE timestamp IS NOT NULL AND timestamp != ''`,
      )
      .get() as { earliest: string | null } | undefined
    if (tx?.earliest) return tx.earliest
  } catch {
    // table missing in malformed DBs — ignore
  }
  try {
    const obs = database
      .prepare(
        `SELECT MIN(observed_at) AS earliest
         FROM validator_observations
         WHERE observed_at IS NOT NULL AND observed_at != ''`,
      )
      .get() as { earliest: string | null } | undefined
    if (obs?.earliest) return obs.earliest
  } catch {
    // ignore
  }
  return null
}

export function computeIndexerHistoryDepthDays(
  database: Database.Database,
  nowMs: number = Date.now(),
): number {
  const earliest = earliestIndexedIso(database)
  const days = historyDepthDaysFromEarliest(earliest, nowMs)
  return Math.floor(days)
}

/** Build public aggregates — never includes addresses or other PII. */
export function buildPublicMetrics(
  database: Database.Database,
  options: { nowMs?: number } = {},
): PublicMetrics {
  const nowMs = options.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const distinctConnectedWallets = countTable(
    database,
    `SELECT COUNT(*) AS n FROM users`,
  )
  const stakingIntents = countTable(
    database,
    `SELECT COUNT(*) AS n FROM staking_intents`,
  )
  const stakingConfirmed = countTable(
    database,
    `SELECT COUNT(*) AS n FROM staking_intents WHERE status = 'confirmed'`,
  )

  return {
    updatedAt: nowIso,
    disclosure: DISCLOSURE,
    metrics: {
      distinctConnectedWallets,
      authConnects: getMetric(database, METRIC_KEYS.authConnects),
      repeatSessions: getMetric(database, METRIC_KEYS.repeatSessions),
      validatorProfileViews: getMetric(database, METRIC_KEYS.validatorProfileViews),
      publicProfileShares: getMetric(database, METRIC_KEYS.publicProfileShares),
      stakingIntents,
      stakingConfirmed,
      indexerHistoryDepthDays: computeIndexerHistoryDepthDays(database, nowMs),
    },
    notes: {
      stakingIntents:
        'Computed as COUNT(staking_intents). Rows written by POST /api/staking/intent.',
      stakingConfirmed:
        "Computed as COUNT(staking_intents WHERE status = 'confirmed'). Set by chain-matched POST /api/staking/confirm.",
      indexerHistoryDepthDays:
        'Computed on read from earliest indexed transaction/observation timestamp → now (whole days). Not stored as a counter.',
    },
  }
}

/** Assert response body never leaks address-shaped fields (for tests / safety). */
export function publicMetricsContainsAddresses(body: unknown): boolean {
  const text = JSON.stringify(body)
  // Nimiq user-friendly addresses start with NQ + 2 checksum digits + spaces or alnum.
  return /\bNQ\d{2}[\s0-9A-Z]{30,}/i.test(text)
}

export function mountMetricsApi(app: Express, database: Database.Database): void {
  app.get('/api/metrics/public', (_req: Request, res: Response) => {
    const payload = buildPublicMetrics(database)
    res.setHeader('Cache-Control', 'public, max-age=30')
    res.json(payload)
  })
}
