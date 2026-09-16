/** Watchlist + durable in-app alert inbox. */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureUserAlerts,
  listUserAlerts,
  listWatchlist,
} from '../../../server/src/alerts.js'
import { createApp } from '../../../server/src/app.js'
import { mintSessionCookie } from '../../../server/src/auth.js'
import { openDatabase } from '../../../server/src/db.js'
import {
  persistScheduleAdherence,
  type ObservationStatus,
} from '../../../server/src/observationScoring.js'

const SECRET = 'alerts-unit-test-secret'
const USER = 'NQ0000000000000000000000000000000002'
const VALIDATOR = 'NQ0000000000000000000000000000000001'
const REWARD = 'NQ0000000000000000000000000000000099'

function seed(database: ReturnType<typeof openDatabase>): void {
  database.prepare(
    `INSERT INTO validators (address, name, reward_address, payout_type_declared, is_listed)
     VALUES (?, 'Test Pool', ?, 'direct', 1)`,
  ).run(VALIDATOR, REWARD)
  database.prepare(
    `INSERT INTO transactions
       (hash, from_address, to_address, value_luna, fee_luna, block_number, timestamp, execution_result, raw_json)
     VALUES (?, ?, ?, 12345, 0, 10, ?, 'ok', '{}')`,
  ).run('a'.repeat(64), REWARD, USER, '2026-08-01T00:00:00.000Z')
  database.prepare(
    `INSERT INTO validator_observations
      (validator_address, observation_type, status, observed_at, source_tx_hash, calc_version, payload_json)
     VALUES (?, 'payout-run', 'on-schedule', ?, ?, 1, ?)`,
  ).run(VALIDATOR, '2026-08-01T00:00:01.000Z', 'b'.repeat(64), JSON.stringify({ recipientCount: 2 }))
}

describe('durable alert derivation', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-alerts-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('persists personal alerts idempotently', () => {
    seed(database)
    ensureUserAlerts(database, USER)
    ensureUserAlerts(database, USER)
    const result = listUserAlerts(database, USER)
    expect(result.alerts.map((alert) => alert.type)).toContain('direct-payout')
    expect(database.prepare('SELECT COUNT(*) AS count FROM user_alerts').get()).toEqual({ count: 1 })
  })

  it('derives payout-run alerts observed after the validator was watched', () => {
    seed(database)
    database.prepare(
      `INSERT INTO validator_watchlist (user_address, validator_address, created_at)
       VALUES (?, ?, ?)`,
    ).run(USER, VALIDATOR, '2026-07-31T00:00:00.000Z')
    ensureUserAlerts(database, USER)
    const result = listUserAlerts(database, USER)
    expect(result.alerts.map((alert) => alert.type)).toContain('payout-run')
    expect(listWatchlist(database, USER)[0]?.validatorName).toBe('Test Pool')
  })

  it('persists every eligible payout even when more than the inbox page size arrive', () => {
    seed(database)
    const insert = database.prepare(
      `INSERT INTO transactions
       (hash, from_address, to_address, value_luna, fee_luna, block_number, timestamp, execution_result, raw_json)
       VALUES (?, ?, ?, 1, 0, ?, ?, 'ok', '{}')`,
    )
    for (let index = 0; index < 125; index += 1) {
      insert.run(
        index.toString(16).padStart(64, '0'),
        REWARD,
        USER,
        100 + index,
        `2026-08-02T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      )
    }
    ensureUserAlerts(database, USER)
    const count = database.prepare(
      `SELECT COUNT(*) AS count FROM user_alerts
       WHERE user_address = ? AND alert_type = 'direct-payout'`,
    ).get(USER) as { count: number }
    expect(count.count).toBe(126)
  })

  it('alerts only when withdrawable state is first observed', () => {
    const insert = database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, active_balance_luna, inactive_balance_luna,
        retired_balance_luna, total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run(USER, 10, 0, 0, 10, '2026-08-01T00:00:00.000Z', 1)
    insert.run(USER, 0, 0, 10, 10, '2026-08-01T01:00:00.000Z', 2)
    insert.run(USER, 0, 0, 10, 10, '2026-08-01T02:00:00.000Z', 3)
    ensureUserAlerts(database, USER)
    const count = database.prepare(
      `SELECT COUNT(*) AS count FROM user_alerts
       WHERE user_address = ? AND alert_type = 'withdrawable'`,
    ).get(USER) as { count: number }
    expect(count.count).toBe(1)
  })

  it('keeps known deposits out of observed-growth alerts', () => {
    database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, validator_address, active_balance_luna,
        total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, VALIDATOR, 1_000, 1_000, '2026-08-01T00:00:00.000Z', 1)
    database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, validator_address, active_balance_luna,
        total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, VALIDATOR, 2_000, 2_000, '2026-08-01T01:00:00.000Z', 2)
    database.prepare(
      `INSERT INTO staking_intents
       (id, user_address, operation, params_json, status,
        created_at, expires_at, confirmed_at)
       VALUES (?, ?, 'stake', '{}', 'confirmed', ?, ?, ?)`,
    ).run(
      'known-deposit', USER,
      '2026-08-01T00:30:00.000Z',
      '2026-08-01T02:00:00.000Z',
      '2026-08-01T01:30:00.000Z',
    )

    ensureUserAlerts(database, USER)
    const rows = database.prepare(
      `SELECT title, message FROM user_alerts
       WHERE user_address = ? AND alert_type = 'position-change'`,
    ).all(USER) as Array<{ title: string; message: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Observed position change')
    expect(rows[0]?.message).toContain('known staking activity')
  })

  it('keeps delegation-change intervals as neutral position changes', () => {
    database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, validator_address, active_balance_luna,
        total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, VALIDATOR, 1_000, 1_000, '2026-08-01T00:00:00.000Z', 1)
    database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, validator_address, active_balance_luna,
        total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, REWARD, 1_000, 1_000, '2026-08-01T01:00:00.000Z', 2)

    ensureUserAlerts(database, USER)
    const rows = database.prepare(
      `SELECT title, message FROM user_alerts
       WHERE user_address = ? AND alert_type = 'position-change'`,
    ).all(USER) as Array<{ title: string; message: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Observed position change')
    expect(rows[0]?.message).toContain('delegation changed')
  })

  it('reclassifies a legacy snapshot alert without duplicating it or resetting read state', () => {
    database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, validator_address, active_balance_luna,
        total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, VALIDATOR, 1_000, 1_000, '2026-08-01T00:00:00.000Z', 1)
    const second = database.prepare(
      `INSERT INTO staker_snapshots
       (user_address, validator_address, active_balance_luna,
        total_balance_luna, observed_at, source_block)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, REWARD, 2_000, 2_000, '2026-08-01T01:00:00.000Z', 2)
    const eventKey = `position-change:snapshot:${second.lastInsertRowid}`
    database.prepare(
      `INSERT INTO user_alerts
       (user_address, event_key, alert_type, title, message, observed_at, read_at)
       VALUES (?, ?, 'position-change', 'Observed position growth',
               'An increase was observed.', ?, ?)`,
    ).run(USER, eventKey, '2026-08-01T01:00:00.000Z', '2026-08-02T00:00:00.000Z')

    ensureUserAlerts(database, USER)
    const rows = database.prepare(
      `SELECT title, message, read_at FROM user_alerts
       WHERE user_address = ? AND event_key = ?`,
    ).all(USER, eventKey) as Array<{
      title: string
      message: string
      read_at: string | null
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Observed position change')
    expect(rows[0]?.message).toContain('delegation changed')
    expect(rows[0]?.read_at).toBe('2026-08-02T00:00:00.000Z')
  })

  it('persists every post-watch validator status transition in order', () => {
    database.prepare(
      `INSERT INTO validators (address, name, is_listed)
       VALUES (?, 'Test Pool', 1)`,
    ).run(VALIDATOR)
    const result = (status: ObservationStatus, to: string) => ({
      status,
      payload: {
        window: { from: '2026-07-18T00:00:00.000Z', to, expectedWindows: 1, observedWindows: 1 },
        rate: 1,
        historyDepthDays: 14,
        everyHours: 12,
        normalizable: true,
        declaredSchedule: 'Every 12 hours',
        anchorAt: '2026-07-18T00:00:00.000Z',
        runCount: 1,
      },
    })
    persistScheduleAdherence(database, {
      validatorAddress: VALIDATOR,
      observedAt: '2026-08-01T00:00:00.000Z',
      result: result('on-schedule', '2026-08-01T00:00:00.000Z'),
    })
    const baseline = database.prepare(
      `SELECT id FROM validator_observations
       WHERE validator_address = ? AND observation_type = 'schedule-adherence'`,
    ).get(VALIDATOR) as { id: number }
    database.prepare(
      `INSERT INTO validator_watchlist
       (user_address, validator_address, created_at, last_observation_status, last_observation_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(USER, VALIDATOR, '2026-08-01T00:00:01.000Z', 'on-schedule', baseline.id)
    persistScheduleAdherence(database, {
      validatorAddress: VALIDATOR,
      observedAt: '2026-08-01T00:00:02.000Z',
      result: result('irregular', '2026-08-01T00:00:02.000Z'),
    })
    persistScheduleAdherence(database, {
      validatorAddress: VALIDATOR,
      observedAt: '2026-08-01T00:00:03.000Z',
      result: result('on-schedule', '2026-08-01T00:00:03.000Z'),
    })

    ensureUserAlerts(database, USER)
    const rows = database.prepare(
      `SELECT message FROM user_alerts
       WHERE user_address = ? AND alert_type = 'validator-status'
       ORDER BY observed_at ASC`,
    ).all(USER) as Array<{ message: string }>
    expect(rows).toHaveLength(2)
    expect(rows[0]?.message).toContain('irregular')
    expect(rows[1]?.message).toContain('on-schedule')
  })
})

describe('watchlist and alert routes', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-alert-http-'))
    database = openDatabase(join(directory, 'test.sqlite'))
    server = createServer(createApp({ database, auth: { sessionSecret: SECRET } }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test port')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('requires authentication and supports watch/unwatch', async () => {
    seed(database)
    const unauth = await fetch(`${baseUrl}/api/me/watchlist`)
    expect(unauth.status).toBe(401)
    const { cookieHeader } = mintSessionCookie(USER, { sessionSecret: SECRET })
    const headers = { Cookie: cookieHeader, 'Content-Type': 'application/json' }
    const watch = await fetch(`${baseUrl}/api/me/watchlist`, {
      method: 'POST', headers, body: JSON.stringify({ validatorAddress: ` ${VALIDATOR} ` }),
    })
    expect(watch.status).toBe(201)
    const watched = (await watch.json()) as { data: { validators: Array<{ validatorAddress: string }> } }
    expect(watched.data.validators).toHaveLength(1)
    const remove = await fetch(`${baseUrl}/api/me/watchlist/${VALIDATOR}`, { method: 'DELETE', headers })
    expect(remove.status).toBe(200)
    expect(((await remove.json()) as { data: { validators: unknown[] } }).data.validators).toHaveLength(0)
  })

  it('lists and marks alerts read', async () => {
    seed(database)
    const { cookieHeader } = mintSessionCookie(USER, { sessionSecret: SECRET })
    const headers = { Cookie: cookieHeader }
    const first = await fetch(`${baseUrl}/api/me/alerts`, { headers })
    expect(first.status).toBe(200)
    const body = (await first.json()) as { data: { alerts: Array<{ id: number; isRead: boolean }>; unreadCount: number } }
    expect(body.data.unreadCount).toBeGreaterThan(0)
    const read = await fetch(`${baseUrl}/api/me/alerts/${body.data.alerts[0]?.id}/read`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })
    expect(read.status).toBe(200)
    const readBody = (await read.json()) as { data: { alerts: Array<{ id: number; isRead: boolean }> } }
    expect(readBody.data.alerts.find((alert) => alert.id === body.data.alerts[0]?.id)?.isRead).toBe(true)
  })
})
