/**
 * Authenticated validator watchlist and durable in-app alerts.
 *
 * Alerts are deliberately derived from indexed, server-observed rows. The
 * event key is unique per user, so polling/reloading the inbox is idempotent.
 * No alert claims that the absence of an observation proves a missed payment.
 */
import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { isValidNimiqAddress, normalizeAddress } from './addresses.js'
import {
  listDirectPayoutItems,
  listStakingIntentItems,
  type ActivityItem,
} from './activity.js'
import { readObservedPositionGrowth } from './personalContinuity.js'

export const DEFAULT_ALERT_LIMIT = 50
export const MAX_ALERT_LIMIT = 100
export const MAX_WATCHLIST_SIZE = 100

export type AlertType =
  | 'direct-payout'
  | 'position-change'
  | 'withdrawable'
  | 'staking-intent'
  | 'validator-status'
  | 'payout-run'

export interface WatchlistItem {
  id: number
  validatorAddress: string
  validatorName: string | null
  createdAt: string
}

export interface UserAlert {
  id: number
  type: AlertType
  title: string
  message: string
  observedAt: string
  createdAt: string
  readAt: string | null
  isRead: boolean
  validatorAddress: string | null
  validatorName: string | null
  txHash: string | null
  amountLuna: number | null
}

interface AlertRow {
  id: number
  alert_type: string
  title: string
  message: string
  observed_at: string
  created_at: string
  read_at: string | null
  validator_address: string | null
  validator_name: string | null
  tx_hash: string | null
  amount_luna: number | null
}

function clampLimit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_ALERT_LIMIT
  return Math.min(MAX_ALERT_LIMIT, Math.max(1, Math.floor(value)))
}

function validUser(address: string): string {
  const normalized = normalizeAddress(address)
  return isValidNimiqAddress(normalized) ? normalized : ''
}

function validatorRow(
  database: Database.Database,
  address: string,
): { address: string; name: string | null } | null {
  const normalized = normalizeAddress(address)
  if (!isValidNimiqAddress(normalized)) return null
  const row = database.prepare(
    `SELECT address, name FROM validators
     WHERE replace(upper(address), ' ', '') = ? LIMIT 1`,
  ).get(normalized) as { address: string; name: string | null } | undefined
  return row ?? null
}

function alertStatus(status: string): string {
  switch (status) {
    case 'pending': return 'pending'
    case 'confirmed': return 'confirmed'
    case 'failed': return 'failed'
    case 'expired': return 'expired'
    default: return 'observed'
  }
}

function intentMessage(item: ActivityItem): string {
  const state = alertStatus(item.status)
  if (state === 'confirmed') return `${item.label} was confirmed against indexed chain data.`
  if (state === 'pending') return `${item.label} is pending confirmation.`
  if (state === 'failed') return `${item.label} was recorded as failed.`
  if (state === 'expired') return `${item.label} expired before confirmation.`
  return `${item.label} was observed.`
}

function insertAlert(
  database: Database.Database,
  row: {
    userAddress: string
    eventKey: string
    type: AlertType
    title: string
    message: string
    observedAt: string
    validatorAddress?: string | null
    txHash?: string | null
    amountLuna?: number | null
  },
): void {
  database.prepare(
    `INSERT INTO user_alerts (
       user_address, event_key, alert_type, title, message, observed_at,
       validator_address, tx_hash, amount_luna
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_address, event_key) DO UPDATE SET
       alert_type = excluded.alert_type,
       title = excluded.title,
       message = excluded.message,
       observed_at = excluded.observed_at,
       validator_address = excluded.validator_address,
       tx_hash = excluded.tx_hash,
       amount_luna = excluded.amount_luna`,
  ).run(
    row.userAddress,
    row.eventKey,
    row.type,
    row.title,
    row.message,
    row.observedAt,
    row.validatorAddress ?? null,
    row.txHash ?? null,
    row.amountLuna ?? null,
  )
}

function derivePersonalAlerts(database: Database.Database, userAddress: string): void {
  const user = validUser(userAddress)
  if (!user) return

  for (const item of listDirectPayoutItems(database, user, null)) {
    if (!item.txHash) continue
    insertAlert(database, {
      userAddress: user,
      eventKey: `direct-payout:${item.txHash}`,
      type: 'direct-payout',
      title: 'Observed direct payout',
      message: 'An indexed transaction to your address was observed from a validator reward address.',
      observedAt: item.at,
      validatorAddress: item.validatorAddress,
      txHash: item.txHash,
      amountLuna: item.amountLuna,
    })
  }

  for (const item of listStakingIntentItems(database, user, null)) {
    const identity = item.id ?? item.txHash ?? `${item.at}:${item.label}`
    insertAlert(database, {
      userAddress: user,
      eventKey: `staking-intent:${identity}:${item.status}`,
      type: 'staking-intent',
      title: item.label,
      message: intentMessage(item),
      observedAt: item.at,
      validatorAddress: item.validatorAddress,
      txHash: item.txHash,
      amountLuna: item.amountLuna,
    })
  }

  const snapshots = database.prepare(
    `SELECT id, observed_at, total_balance_luna, active_balance_luna,
            inactive_balance_luna, retired_balance_luna, validator_address,
            source_block
     FROM staker_snapshots
     WHERE replace(upper(user_address), ' ', '') = ?
     ORDER BY observed_at ASC, id ASC`,
  ).all(user) as Array<{
    id: number
    observed_at: string
    total_balance_luna: number
    active_balance_luna: number
    inactive_balance_luna: number
    retired_balance_luna: number
    validator_address: string | null
    source_block: number | null
  }>
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]
    if (!snapshot) continue
    const currentValidator = snapshot.validator_address ? normalizeAddress(snapshot.validator_address) : null
    const withdrawable =
      snapshot.retired_balance_luna > 0 &&
      snapshot.active_balance_luna === 0 &&
      snapshot.inactive_balance_luna === 0
    const previous = snapshots[index - 1]
    const previousWithdrawable =
      previous != null &&
      previous.retired_balance_luna > 0 &&
      previous.active_balance_luna === 0 &&
      previous.inactive_balance_luna === 0
    if (withdrawable && !previousWithdrawable) {
      insertAlert(database, {
        userAddress: user,
        eventKey: `withdrawable:snapshot:${snapshot.id}`,
        type: 'withdrawable',
        title: 'Withdrawable position observed',
        message: 'Your position was observed as withdrawable from a protocol staker snapshot.',
        observedAt: snapshot.observed_at,
        validatorAddress: currentValidator,
      })
    }
  }

  // Keep alerts aligned with the continuity calculation: known staking
  // activity and delegation transitions are position changes, never growth.
  const growth = readObservedPositionGrowth(database, user)
  for (const interval of growth.intervals) {
    if (interval.deltaLuna === 0 && interval.confoundedBy !== 'delegation-change') continue
    const observedGrowth = interval.status === 'observed' && interval.deltaLuna > 0
    const confounded = interval.status === 'confounded'
    const targetSnapshot = snapshots.find(
      (snapshot) =>
        snapshot.observed_at === interval.to.at &&
        snapshot.total_balance_luna === interval.to.totalLuna &&
        snapshot.source_block === interval.to.sourceBlock,
    )
    if (!targetSnapshot) continue
    insertAlert(database, {
      userAddress: user,
      // Preserve the pre-growth-analytics identity so existing read alerts are
      // updated semantically without creating duplicate unread rows.
      eventKey: `position-change:snapshot:${targetSnapshot.id}`,
      type: 'position-change',
      title: observedGrowth ? 'Observed position growth' : 'Observed position change',
      message: confounded
        ? interval.confoundedBy === 'delegation-change'
          ? 'A change in your indexed staker position was observed while delegation changed; it is excluded from growth.'
          : interval.confoundedBy === 'chain-history-unavailable'
            ? 'A change in your indexed staker position was observed, but chain history did not cover the full interval; it is excluded from growth.'
            : interval.confoundedBy === 'chain-staking-action'
              ? 'A change in your indexed staker position was observed alongside on-chain staking activity; it is excluded from growth.'
              : 'A change in your indexed staker position was observed alongside known staking activity recorded by Steakout; it is excluded from growth.'
        : observedGrowth
          ? 'An increase in your indexed staker position was observed.'
          : 'A change in your indexed staker position was observed.',
      observedAt: interval.to.at,
      validatorAddress: interval.to.validatorAddress,
      amountLuna: interval.deltaLuna === 0 ? null : interval.deltaLuna,
    })
  }
}

function deriveWatchedValidatorAlerts(database: Database.Database, userAddress: string): void {
  const user = validUser(userAddress)
  if (!user) return
  const watches = database.prepare(
    `SELECT validator_address, created_at, last_observation_status,
            last_observation_id
     FROM validator_watchlist WHERE user_address = ?`,
  ).all(user) as Array<{
    validator_address: string
    created_at: string
    last_observation_status: string | null
    last_observation_id: number | null
  }>

  for (const watch of watches) {
    const validator = validatorRow(database, watch.validator_address)
    if (!validator) continue
    const canonical = validator.address
    const normalized = normalizeAddress(canonical)

    const statusRows = database.prepare(
      `SELECT id, status, observed_at FROM validator_observations
       WHERE replace(upper(validator_address), ' ', '') = ?
         AND observation_type = 'schedule-adherence'
         AND observed_at >= ?
         AND id > ?
       ORDER BY id ASC`,
    ).all(normalized, watch.created_at, watch.last_observation_id ?? 0) as Array<{
      id: number
      status: string
      observed_at: string
    }>
    let priorStatus = watch.last_observation_status
    let lastObservationId = watch.last_observation_id
    for (const statusRow of statusRows) {
      if (priorStatus != null && priorStatus !== statusRow.status) {
        insertAlert(database, {
          userAddress: user,
          eventKey: `validator-status:${normalized}:${statusRow.id}:${statusRow.status}`,
          type: 'validator-status',
          title: 'Validator observation status changed',
          message: `The latest Steakout observation is labeled “${statusRow.status}”.`,
          observedAt: statusRow.observed_at,
          validatorAddress: canonical,
        })
      }
      priorStatus = statusRow.status
      lastObservationId = statusRow.id
    }
    if (lastObservationId !== watch.last_observation_id) {
      database.prepare(
        `UPDATE validator_watchlist
         SET last_observation_status = ?, last_observation_id = ?
         WHERE user_address = ? AND validator_address = ?`,
      ).run(priorStatus, lastObservationId, user, canonical)
    }

    const runs = database.prepare(
      `SELECT source_tx_hash, observed_at, status, payload_json
       FROM validator_observations
       WHERE replace(upper(validator_address), ' ', '') = ?
         AND observation_type = 'payout-run'
         AND source_tx_hash IS NOT NULL
         AND observed_at >= ?
       ORDER BY observed_at DESC, id DESC`,
    ).all(normalized, watch.created_at) as Array<{
      source_tx_hash: string
      observed_at: string
      status: string
      payload_json: string
    }>
    for (const run of runs) {
      let recipientCount: number | null = null
      try {
        const payload = JSON.parse(run.payload_json) as { recipientCount?: unknown }
        recipientCount = typeof payload.recipientCount === 'number' ? payload.recipientCount : null
      } catch {
        // Malformed historical payloads remain available without an invented count.
      }
      insertAlert(database, {
        userAddress: user,
        eventKey: `payout-run:${normalized}:${run.source_tx_hash}`,
        type: 'payout-run',
        title: 'Payout window observed',
        message: recipientCount == null
          ? 'A payout window was observed for a watched validator.'
          : `A payout window was observed for a watched validator, including ${recipientCount} indexed recipient${recipientCount === 1 ? '' : 's'}.`,
        observedAt: run.observed_at,
        validatorAddress: canonical,
        txHash: run.source_tx_hash,
      })
    }
  }
}

/** Derive current indexed events into durable, idempotent user alerts. */
export function ensureUserAlerts(database: Database.Database, userAddress: string): void {
  database.transaction(() => {
    derivePersonalAlerts(database, userAddress)
    deriveWatchedValidatorAlerts(database, userAddress)
  })()
}

export function listWatchlist(database: Database.Database, userAddress: string): WatchlistItem[] {
  const user = validUser(userAddress)
  if (!user) return []
  const rows = database.prepare(
    `SELECT w.id, w.validator_address, w.created_at, v.name AS validator_name
     FROM validator_watchlist w
     LEFT JOIN validators v ON v.address = w.validator_address
     WHERE w.user_address = ? ORDER BY w.created_at ASC, w.id ASC`,
  ).all(user) as Array<{
    id: number
    validator_address: string
    created_at: string
    validator_name: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    validatorAddress: row.validator_address,
    validatorName: row.validator_name,
    createdAt: row.created_at,
  }))
}

export function listUserAlerts(
  database: Database.Database,
  userAddress: string,
  limit?: number,
): { alerts: UserAlert[]; unreadCount: number; nextCursor: null } {
  const user = validUser(userAddress)
  if (!user) return { alerts: [], unreadCount: 0, nextCursor: null }
  const rows = database.prepare(
    `SELECT a.id, a.alert_type, a.title, a.message, a.observed_at, a.created_at,
            a.read_at, a.validator_address, v.name AS validator_name,
            a.tx_hash, a.amount_luna
     FROM user_alerts a LEFT JOIN validators v ON v.address = a.validator_address
     WHERE a.user_address = ? ORDER BY a.observed_at DESC, a.id DESC LIMIT ?`,
  ).all(user, clampLimit(limit)) as AlertRow[]
  const unread = database.prepare(
    `SELECT COUNT(*) AS count FROM user_alerts WHERE user_address = ? AND read_at IS NULL`,
  ).get(user) as { count: number }
  const alerts = rows.map((row) => ({
    id: row.id,
    type: row.alert_type as AlertType,
    title: row.title,
    message: row.message,
    observedAt: row.observed_at,
    createdAt: row.created_at,
    readAt: row.read_at,
    isRead: row.read_at !== null,
    validatorAddress: row.validator_address,
    validatorName: row.validator_name,
    txHash: row.tx_hash,
    amountLuna: row.amount_luna,
  }))
  return { alerts, unreadCount: unread.count, nextCursor: null }
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } })
}

function requestAddress(response: Response): string | null {
  const address = response.locals.address as string | undefined
  const user = address ? validUser(address) : ''
  return user || null
}

/** Mount authenticated `/api/me/watchlist` and `/api/me/alerts` routes. */
export function mountAlertsApi(app: Express, database: Database.Database): void {
  app.get('/api/me/watchlist', (_request, response) => {
    const user = requestAddress(response)
    if (!user) { sendError(response, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.'); return }
    response.json({
      updatedAt: new Date().toISOString(), source: 'database', status: 'ok',
      data: { validators: listWatchlist(database, user) },
    })
  })

  app.post('/api/me/watchlist', (request: Request, response) => {
    const user = requestAddress(response)
    if (!user) { sendError(response, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.'); return }
    const body = request.body as { validatorAddress?: unknown }
    const raw = typeof body?.validatorAddress === 'string' ? body.validatorAddress : ''
    const validator = validatorRow(database, raw)
    if (!validator) { sendError(response, 400, 'VALIDATION', 'A known validator address is required.'); return }
    const existing = database.prepare(
      `SELECT id FROM validator_watchlist
       WHERE user_address = ? AND validator_address = ?`,
    ).get(user, validator.address) as { id: number } | undefined
    const count = database.prepare(
      `SELECT COUNT(*) AS count FROM validator_watchlist WHERE user_address = ?`,
    ).get(user) as { count: number }
    if (!existing && count.count >= MAX_WATCHLIST_SIZE) {
      sendError(response, 400, 'VALIDATION', 'Watchlist limit reached.'); return
    }
    const baseline = database.prepare(
      `SELECT id, status FROM validator_observations
       WHERE replace(upper(validator_address), ' ', '') = ?
         AND observation_type = 'schedule-adherence'
       ORDER BY id DESC LIMIT 1`,
    ).get(normalizeAddress(validator.address)) as
      | { id: number; status: string }
      | undefined
    database.prepare(
      `INSERT OR IGNORE INTO validator_watchlist
       (user_address, validator_address, last_observation_status, last_observation_id)
       VALUES (?, ?, ?, ?)`,
    ).run(user, validator.address, baseline?.status ?? null, baseline?.id ?? null)
    response.status(201).json({
      updatedAt: new Date().toISOString(), source: 'database', status: 'ok',
      data: { validators: listWatchlist(database, user) },
    })
  })

  app.delete('/api/me/watchlist/:address', (request, response) => {
    const user = requestAddress(response)
    if (!user) { sendError(response, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.'); return }
    const validator = validatorRow(database, request.params.address)
    if (!validator) { sendError(response, 404, 'VALIDATOR_NOT_FOUND', 'Validator not found.'); return }
    database.prepare(
      `DELETE FROM validator_watchlist WHERE user_address = ? AND validator_address = ?`,
    ).run(user, validator.address)
    response.json({
      updatedAt: new Date().toISOString(), source: 'database', status: 'ok',
      data: { validators: listWatchlist(database, user) },
    })
  })

  app.get('/api/me/alerts', (request, response) => {
    const user = requestAddress(response)
    if (!user) { sendError(response, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.'); return }
    ensureUserAlerts(database, user)
    const limit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined
    const data = listUserAlerts(database, user, limit)
    response.json({ updatedAt: new Date().toISOString(), source: 'database', status: 'ok', data })
  })

  app.post('/api/me/alerts/:id/read', (request, response) => {
    const user = requestAddress(response)
    if (!user) { sendError(response, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.'); return }
    const id = Number(request.params.id)
    if (!Number.isSafeInteger(id) || id < 1) { sendError(response, 400, 'VALIDATION', 'A valid alert id is required.'); return }
    database.prepare(
      `UPDATE user_alerts SET read_at = COALESCE(read_at, ?)
       WHERE id = ? AND user_address = ?`,
    ).run(new Date().toISOString(), id, user)
    ensureUserAlerts(database, user)
    response.json({ updatedAt: new Date().toISOString(), source: 'database', status: 'ok', data: listUserAlerts(database, user) })
  })

  app.post('/api/me/alerts/read-all', (_request, response) => {
    const user = requestAddress(response)
    if (!user) { sendError(response, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.'); return }
    database.prepare(
      `UPDATE user_alerts SET read_at = COALESCE(read_at, ?) WHERE user_address = ?`,
    ).run(new Date().toISOString(), user)
    response.json({ updatedAt: new Date().toISOString(), source: 'database', status: 'ok', data: listUserAlerts(database, user) })
  })
}
