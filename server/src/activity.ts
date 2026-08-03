/**
 * Personal + network activity timelines (P2-10).
 *
 * - GET /api/me/activity — chronological personal items (auth required via /api/me/*)
 * - GET /api/activity/network — public recent payout-run summaries
 *
 * Sources (personal): observed direct payouts from known reward addresses,
 * staker_snapshots deltas (restake growth labeled "Observed position growth"),
 * staking_intents when present. Never invents "missed payment" claims.
 *
 * API.md §5: each item `{ type, at, txHash?, amountLuna?, validatorAddress?, status }`.
 */

import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { normalizeAddress } from './addresses.js'
import {
  CALC_VERSION,
  PAYOUT_RUN_OBSERVATION_TYPE,
  type PayoutRunPayload,
} from './payoutClassifier.js'
import { OBSERVED_POSITION_GROWTH_LABEL } from './personalContinuity.js'

/** Default max items returned after merge + sort. */
export const DEFAULT_ACTIVITY_LIMIT = 50
export const MAX_ACTIVITY_LIMIT = 100
export const DEFAULT_NETWORK_ACTIVITY_LIMIT = 25

/** Wire types for personal timeline items (API.md §5). */
export type PersonalActivityType =
  | 'direct-payout'
  | 'observed-position-growth'
  | 'position-change'
  | 'staking-intent'

export type ActivityItemStatus =
  | 'observed'
  | 'verified'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'expired'

export interface ActivityItem {
  type: PersonalActivityType | 'payout-run'
  at: string
  txHash: string | null
  amountLuna: number | null
  validatorAddress: string | null
  status: ActivityItemStatus | string
  /** Human-facing label (neutral). Optional extension for UI. */
  label: string
  /** Restake growth fixed label when type is observed-position-growth. */
  growthLabel?: typeof OBSERVED_POSITION_GROWTH_LABEL
  validatorName?: string | null
  /** Network payout-run extras. */
  txCount?: number | null
  recipientCount?: number | null
}

export interface PersonalActivityPayload {
  items: ActivityItem[]
  nextCursor: string | null
}

export interface PersonalActivityEnvelope {
  updatedAt: string
  source: 'indexer'
  status: 'ok' | 'unavailable'
  dataFreshness: { ageSeconds: number; historyDepthDays: number | null }
  data: PersonalActivityPayload
}

export interface NetworkActivityPayload {
  items: ActivityItem[]
  nextCursor: string | null
}

export interface NetworkActivityEnvelope {
  updatedAt: string
  source: 'indexer'
  status: 'ok' | 'unavailable'
  dataFreshness: { ageSeconds: number; historyDepthDays: number | null }
  data: NetworkActivityPayload
}

export interface ReadPersonalActivityOptions {
  database: Database.Database
  address: string
  limit?: number
  now?: () => number
}

export interface ReadNetworkActivityOptions {
  database: Database.Database
  limit?: number
  now?: () => number
}

function clampLimit(raw: number | undefined, fallback: number): number {
  if (raw == null || !Number.isFinite(raw)) return fallback
  const n = Math.floor(raw)
  if (n < 1) return fallback
  return Math.min(n, MAX_ACTIVITY_LIMIT)
}

function ageSeconds(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, Math.floor((nowMs - parsed) / 1000))
}

function historyDepthDays(items: readonly { at: string }[], nowMs: number): number | null {
  if (items.length === 0) return null
  let earliest = Number.POSITIVE_INFINITY
  for (const item of items) {
    const t = Date.parse(item.at)
    if (!Number.isNaN(t) && t < earliest) earliest = t
  }
  if (!Number.isFinite(earliest)) return null
  const days = (nowMs - earliest) / (24 * 60 * 60 * 1000)
  return Math.max(0, Math.floor(days * 10) / 10)
}

function sortByAtDesc(a: ActivityItem, b: ActivityItem): number {
  const ta = Date.parse(a.at)
  const tb = Date.parse(b.at)
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if (Number.isNaN(ta)) return 1
  if (Number.isNaN(tb)) return -1
  if (tb !== ta) return tb - ta
  // Stable secondary: type then txHash
  if (a.type !== b.type) return a.type < b.type ? -1 : 1
  const ha = a.txHash ?? ''
  const hb = b.txHash ?? ''
  return ha < hb ? -1 : ha > hb ? 1 : 0
}

/**
 * Observed successful inbound payments from any known validator reward address
 * (or validator self-address when reward is unset) to the user.
 */
export function listDirectPayoutItems(
  database: Database.Database,
  userAddress: string,
  limit: number,
): ActivityItem[] {
  const user = normalizeAddress(userAddress)
  if (user === '' || limit < 1) return []

  // Map reward/self address → validator row (prefer listed when duplicates).
  const validators = database
    .prepare(
      `SELECT address, name, reward_address
       FROM validators`,
    )
    .all() as Array<{
    address: string
    name: string | null
    reward_address: string | null
  }>

  const fromToValidator = new Map<
    string,
    { address: string; name: string | null }
  >()
  for (const row of validators) {
    const reward =
      typeof row.reward_address === 'string' && row.reward_address.trim() !== ''
        ? normalizeAddress(row.reward_address)
        : normalizeAddress(row.address)
    if (reward === '') continue
    const existing = fromToValidator.get(reward)
    if (!existing) {
      fromToValidator.set(reward, {
        address: row.address,
        name:
          typeof row.name === 'string' && row.name.trim() !== ''
            ? row.name.trim()
            : null,
      })
    }
  }

  if (fromToValidator.size === 0) return []

  const fromKeys = [...fromToValidator.keys()]
  // SQLite has a bind limit; reward-address set is small (~24–100).
  const placeholders = fromKeys.map(() => '?').join(', ')
  const rows = database
    .prepare(
      `SELECT hash, timestamp, value_luna, from_address
       FROM transactions
       WHERE replace(upper(to_address), ' ', '') = ?
         AND replace(upper(from_address), ' ', '') IN (${placeholders})
         AND execution_result = 'ok'
       ORDER BY timestamp DESC, block_number DESC, hash DESC
       LIMIT ?`,
    )
    .all(user, ...fromKeys, limit) as Array<{
    hash: string
    timestamp: string
    value_luna: number
    from_address: string
  }>

  const items: ActivityItem[] = []
  for (const row of rows) {
    const from = normalizeAddress(row.from_address)
    const validator = fromToValidator.get(from)
    items.push({
      type: 'direct-payout',
      at: row.timestamp,
      txHash: row.hash,
      amountLuna: row.value_luna,
      validatorAddress: validator?.address ?? null,
      status: 'observed',
      label: 'Observed direct payout',
      validatorName: validator?.name ?? null,
    })
  }
  return items
}

interface SnapshotRow {
  id: number
  observed_at: string
  total_balance_luna: number
  validator_address: string | null
}

/**
 * Consecutive staker_snapshot deltas for the user.
 * Positive total delta → `observed-position-growth` with fixed growth label.
 * Other non-zero deltas → neutral `position-change`.
 * Zero deltas are skipped (noise).
 */
export function listSnapshotChangeItems(
  database: Database.Database,
  userAddress: string,
  limit: number,
): ActivityItem[] {
  const user = normalizeAddress(userAddress)
  if (user === '' || limit < 1) return []

  const rows = database
    .prepare(
      `SELECT id, observed_at, total_balance_luna, validator_address
       FROM staker_snapshots
       WHERE replace(upper(user_address), ' ', '') = ?
       ORDER BY observed_at ASC, id ASC`,
    )
    .all(user) as SnapshotRow[]

  if (rows.length < 2) return []

  const items: ActivityItem[] = []
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]
    const curr = rows[i]
    if (!prev || !curr) continue
    const delta = curr.total_balance_luna - prev.total_balance_luna
    if (delta === 0) continue

    const validatorAddress =
      typeof curr.validator_address === 'string' &&
      curr.validator_address.trim() !== ''
        ? curr.validator_address
        : null

    if (delta > 0) {
      items.push({
        type: 'observed-position-growth',
        at: curr.observed_at,
        txHash: null,
        amountLuna: delta,
        validatorAddress,
        status: 'observed',
        label: OBSERVED_POSITION_GROWTH_LABEL,
        growthLabel: OBSERVED_POSITION_GROWTH_LABEL,
      })
    } else {
      items.push({
        type: 'position-change',
        at: curr.observed_at,
        txHash: null,
        amountLuna: delta,
        validatorAddress,
        status: 'observed',
        label: 'Observed position change',
      })
    }
  }

  // Newest first for merge; caller re-sorts.
  items.sort(sortByAtDesc)
  return items.slice(0, limit)
}

function parseIntentAmountLuna(paramsJson: string): number | null {
  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>
    const keys = [
      'valueLuna',
      'retireStakeLuna',
      'newActiveBalanceLuna',
    ] as const
    for (const key of keys) {
      const v = params[key]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  } catch {
    return null
  }
}

function intentLabel(operation: string): string {
  switch (operation) {
    case 'new-staker':
      return 'Create staker'
    case 'stake':
      return 'Add stake'
    case 'set-active':
      return 'Set active balance'
    case 'update-staker':
      return 'Change delegation'
    case 'retire':
      return 'Retire stake'
    case 'remove':
      return 'Remove stake'
    default:
      return 'Staking action'
  }
}

function mapIntentStatus(status: string): ActivityItemStatus {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'confirmed':
      return 'confirmed'
    case 'failed':
      return 'failed'
    case 'expired':
      return 'expired'
    default:
      return status as ActivityItemStatus
  }
}

/**
 * Staking intents recorded for the user (if any). Uses confirmed_at when
 * present, otherwise created_at.
 */
export function listStakingIntentItems(
  database: Database.Database,
  userAddress: string,
  limit: number,
): ActivityItem[] {
  const user = normalizeAddress(userAddress)
  if (user === '' || limit < 1) return []

  const rows = database
    .prepare(
      `SELECT operation, status, tx_hash, created_at, confirmed_at, params_json
       FROM staking_intents
       WHERE replace(upper(user_address), ' ', '') = ?
       ORDER BY COALESCE(confirmed_at, created_at) DESC, created_at DESC
       LIMIT ?`,
    )
    .all(user, limit) as Array<{
    operation: string
    status: string
    tx_hash: string | null
    created_at: string
    confirmed_at: string | null
    params_json: string
  }>

  return rows.map((row) => {
    const at =
      typeof row.confirmed_at === 'string' && row.confirmed_at.trim() !== ''
        ? row.confirmed_at
        : row.created_at
    let validatorAddress: string | null = null
    try {
      const params = JSON.parse(row.params_json) as Record<string, unknown>
      const del =
        (typeof params.delegation === 'string' && params.delegation) ||
        (typeof params.newDelegation === 'string' && params.newDelegation) ||
        null
      if (del) validatorAddress = del
    } catch {
      // ignore
    }

    return {
      type: 'staking-intent' as const,
      at,
      txHash:
        typeof row.tx_hash === 'string' && row.tx_hash.trim() !== ''
          ? row.tx_hash
          : null,
      amountLuna: parseIntentAmountLuna(row.params_json),
      validatorAddress,
      status: mapIntentStatus(row.status),
      label: intentLabel(row.operation),
    }
  })
}

/**
 * Authenticated personal timeline merge.
 */
export function readPersonalActivity(
  options: ReadPersonalActivityOptions,
): PersonalActivityEnvelope {
  const nowMs = (options.now ?? Date.now)()
  const limit = clampLimit(options.limit, DEFAULT_ACTIVITY_LIMIT)
  const address = normalizeAddress(options.address)

  // Over-fetch each source then merge so the final window is balanced.
  const perSource = Math.max(limit, DEFAULT_ACTIVITY_LIMIT)

  const merged: ActivityItem[] = [
    ...listDirectPayoutItems(options.database, address, perSource),
    ...listSnapshotChangeItems(options.database, address, perSource),
    ...listStakingIntentItems(options.database, address, perSource),
  ]

  merged.sort(sortByAtDesc)
  const items = merged.slice(0, limit)

  const newestAt = items[0]?.at ?? null
  const status: PersonalActivityEnvelope['status'] =
    items.length === 0 ? 'ok' : 'ok'

  return {
    updatedAt: newestAt ?? new Date(nowMs).toISOString(),
    source: 'indexer',
    status,
    dataFreshness: {
      ageSeconds: ageSeconds(newestAt, nowMs),
      historyDepthDays: historyDepthDays(items, nowMs),
    },
    data: {
      items,
      nextCursor: null,
    },
  }
}

function parsePayoutRunPayload(raw: string): PayoutRunPayload | null {
  try {
    const payload = JSON.parse(raw) as PayoutRunPayload
    if (
      typeof payload.windowStart !== 'string' ||
      typeof payload.windowEnd !== 'string'
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

/**
 * Public network feed: recent payout-run observations across validators.
 */
export function readNetworkActivity(
  options: ReadNetworkActivityOptions,
): NetworkActivityEnvelope {
  const nowMs = (options.now ?? Date.now)()
  const limit = clampLimit(options.limit, DEFAULT_NETWORK_ACTIVITY_LIMIT)

  const versionRow = options.database
    .prepare(
      `SELECT MAX(calc_version) AS version
       FROM validator_observations
       WHERE observation_type = ?`,
    )
    .get(PAYOUT_RUN_OBSERVATION_TYPE) as { version: number | null } | undefined

  const calcVersion = versionRow?.version ?? CALC_VERSION

  const rows = options.database
    .prepare(
      `SELECT vo.validator_address, vo.observed_at, vo.status, vo.source_tx_hash,
              vo.payload_json, v.name AS validator_name
       FROM validator_observations vo
       LEFT JOIN validators v ON v.address = vo.validator_address
       WHERE vo.observation_type = ?
         AND vo.calc_version = ?
       ORDER BY vo.observed_at DESC, vo.id DESC
       LIMIT ?`,
    )
    .all(PAYOUT_RUN_OBSERVATION_TYPE, calcVersion, limit) as Array<{
    validator_address: string
    observed_at: string
    status: string
    source_tx_hash: string | null
    payload_json: string
    validator_name: string | null
  }>

  const items: ActivityItem[] = []
  for (const row of rows) {
    const payload = parsePayoutRunPayload(row.payload_json)
    const at = payload?.windowEnd ?? row.observed_at
    items.push({
      type: 'payout-run',
      at,
      txHash: row.source_tx_hash,
      amountLuna:
        payload && typeof payload.totalValueLuna === 'number'
          ? payload.totalValueLuna
          : null,
      validatorAddress: row.validator_address,
      status: row.status || 'verified',
      label: 'Observed payout run',
      validatorName:
        typeof row.validator_name === 'string' && row.validator_name.trim() !== ''
          ? row.validator_name.trim()
          : null,
      txCount: payload?.txCount ?? null,
      recipientCount: payload?.recipientCount ?? null,
    })
  }

  const newestAt = items[0]?.at ?? null

  return {
    updatedAt: newestAt ?? new Date(nowMs).toISOString(),
    source: 'indexer',
    status: items.length === 0 ? 'unavailable' : 'ok',
    dataFreshness: {
      ageSeconds: ageSeconds(newestAt, nowMs),
      historyDepthDays: historyDepthDays(items, nowMs),
    },
    data: {
      items,
      nextCursor: null,
    },
  }
}

function parseLimitQuery(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = typeof raw === 'string' ? Number(raw) : Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return clampLimit(n, fallback)
}

/**
 * Mount public network activity. Personal route is registered on the app
 * after auth middleware (see app.ts).
 */
export function mountNetworkActivityApi(
  app: Express,
  database: Database.Database,
): void {
  app.get('/api/activity/network', (_req: Request, res: Response) => {
    const limit = parseLimitQuery(
      _req.query.limit,
      DEFAULT_NETWORK_ACTIVITY_LIMIT,
    )
    const envelope = readNetworkActivity({ database, limit })
    res.setHeader('Cache-Control', 'public, max-age=30')
    res.json(envelope)
  })
}

/**
 * Handler factory for GET /api/me/activity (caller must apply requireAuth).
 */
export function handlePersonalActivity(
  database: Database.Database,
  req: Request,
  res: Response,
): void {
  const address = res.locals.address as string | undefined
  if (!address) {
    res.status(401).json({
      error: {
        code: 'WALLET_NOT_CONNECTED',
        message: 'No valid wallet session.',
      },
    })
    return
  }

  const limit = parseLimitQuery(req.query.limit, DEFAULT_ACTIVITY_LIMIT)
  const envelope = readPersonalActivity({ database, address, limit })
  res.setHeader('Cache-Control', 'private, max-age=15')
  res.json(envelope)
}
