/**
 * P2-10 — personal + network activity timelines.
 * Crafted DB fixtures; no live RPC.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listDirectPayoutItems,
  listSnapshotChangeItems,
  listStakingIntentItems,
  readNetworkActivity,
  readPersonalActivity,
} from '../../../server/src/activity.js'
import { createApp } from '../../../server/src/app.js'
import { mintSessionCookie } from '../../../server/src/auth.js'
import { openDatabase } from '../../../server/src/db.js'
import {
  CALC_VERSION,
  PAYOUT_RUN_OBSERVATION_TYPE,
  PAYOUT_RUN_STATUS,
  payoutRunToPayload,
  type PayoutRun,
} from '../../../server/src/payoutClassifier.js'
import { OBSERVED_POSITION_GROWTH_LABEL } from '../../../server/src/personalContinuity.js'

const TEST_SESSION_SECRET = 'steakout-p2-10-test-session-secret'
const USER = 'NQ0000000000000000000000000000000002'
const USER_SPACED = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002'
const OTHER = 'NQ0000000000000000000000000000000003'
const VALIDATOR = 'NQ0000000000000000000000000000000001'
const VALIDATOR_SPACED = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ0000000000000000000000000000000099'
const REWARD_SPACED = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0099'
const BASE = Date.parse('2026-08-01T00:00:00.000Z')

function iso(msOffset: number): string {
  return new Date(BASE + msOffset).toISOString()
}

function insertValidator(
  database: ReturnType<typeof openDatabase>,
  opts: {
    address?: string
    reward?: string
    name?: string
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO validators (
         address, name, reward_address, payout_type_declared, is_listed
       ) VALUES (?, ?, ?, 'direct', 1)`,
    )
    .run(
      opts.address ?? VALIDATOR_SPACED,
      opts.name ?? 'Test Pool',
      opts.reward ?? REWARD_SPACED,
    )
}

function insertTx(
  database: ReturnType<typeof openDatabase>,
  opts: {
    hash: string
    from: string
    to: string
    valueLuna?: number
    blockNumber?: number
    timestamp: string
    executionResult?: string
  },
): void {
  database
    .prepare(
      `INSERT INTO transactions (
         hash, from_address, to_address, value_luna, fee_luna, block_number,
         timestamp, execution_result, raw_json
       ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, '{}')`,
    )
    .run(
      opts.hash,
      opts.from,
      opts.to,
      opts.valueLuna ?? 100_000,
      opts.blockNumber ?? 100,
      opts.timestamp,
      opts.executionResult ?? 'ok',
    )
}

function insertSnapshot(
  database: ReturnType<typeof openDatabase>,
  opts: {
    user: string
    totalLuna: number
    at: string
    validator?: string | null
  },
): void {
  database
    .prepare(
      `INSERT INTO staker_snapshots (
         user_address, validator_address,
         active_balance_luna, inactive_balance_luna, retired_balance_luna,
         total_balance_luna, observed_at, source_block
       ) VALUES (?, ?, ?, 0, 0, ?, ?, 1)`,
    )
    .run(
      opts.user,
      opts.validator ?? VALIDATOR_SPACED,
      opts.totalLuna,
      opts.totalLuna,
      opts.at,
    )
}

function insertIntent(
  database: ReturnType<typeof openDatabase>,
  opts: {
    id: string
    user: string
    operation: string
    status: string
    createdAt: string
    confirmedAt?: string | null
    txHash?: string | null
    params?: Record<string, unknown>
  },
): void {
  database
    .prepare(
      `INSERT INTO staking_intents (
         id, user_address, operation, params_json, status, tx_hash,
         created_at, expires_at, confirmed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.user,
      opts.operation,
      JSON.stringify(opts.params ?? { valueLuna: 500_000 }),
      opts.status,
      opts.txHash ?? null,
      opts.createdAt,
      iso(86_400_000),
      opts.confirmedAt ?? null,
    )
}

function insertPayoutRun(
  database: ReturnType<typeof openDatabase>,
  run: PayoutRun,
  validatorAddress = VALIDATOR_SPACED,
): void {
  const payload = payoutRunToPayload(run)
  database
    .prepare(
      `INSERT INTO validator_observations (
         validator_address, observation_type, status, observed_at,
         source_tx_hash, block_number, calc_version, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      validatorAddress,
      PAYOUT_RUN_OBSERVATION_TYPE,
      PAYOUT_RUN_STATUS,
      run.endedAt,
      run.firstTxHash,
      run.firstBlock,
      CALC_VERSION,
      JSON.stringify(payload),
    )
}

describe('listDirectPayoutItems', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-act-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('returns observed payouts from reward addresses only', () => {
    insertValidator(database)
    insertTx(database, {
      hash: 'a'.repeat(64),
      from: REWARD_SPACED,
      to: USER_SPACED,
      timestamp: iso(0),
      valueLuna: 250_000,
    })
    // Unrelated sender — not a known reward address
    insertTx(database, {
      hash: 'b'.repeat(64),
      from: OTHER,
      to: USER,
      timestamp: iso(3_600_000),
    })
    // Failed execution — excluded
    insertTx(database, {
      hash: 'c'.repeat(64),
      from: REWARD,
      to: USER,
      timestamp: iso(7_200_000),
      executionResult: 'failed',
    })

    const items = listDirectPayoutItems(database, USER, 50)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'direct-payout',
      at: iso(0),
      txHash: 'a'.repeat(64),
      amountLuna: 250_000,
      status: 'observed',
      label: 'Observed direct payout',
    })
    expect(items[0]?.validatorAddress?.replace(/\s+/g, '')).toBe(VALIDATOR)
  })
})

describe('listSnapshotChangeItems', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-snap-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('labels positive deltas as Observed position growth, never payout', () => {
    insertSnapshot(database, {
      user: USER_SPACED,
      totalLuna: 1_000_000,
      at: iso(0),
    })
    insertSnapshot(database, {
      user: USER,
      totalLuna: 1_050_000,
      at: iso(3_600_000),
    })
    insertSnapshot(database, {
      user: USER,
      totalLuna: 900_000,
      at: iso(7_200_000),
    })

    const items = listSnapshotChangeItems(database, USER, 50)
    expect(items).toHaveLength(2)

    const growth = items.find((i) => i.type === 'observed-position-growth')
    expect(growth).toMatchObject({
      type: 'observed-position-growth',
      amountLuna: 50_000,
      label: OBSERVED_POSITION_GROWTH_LABEL,
      growthLabel: OBSERVED_POSITION_GROWTH_LABEL,
      status: 'observed',
    })
    expect(growth?.label.toLowerCase()).not.toContain('payout')

    const change = items.find((i) => i.type === 'position-change')
    expect(change).toMatchObject({
      type: 'position-change',
      amountLuna: -150_000,
      label: 'Observed position change',
    })
  })

  it('skips zero deltas and single snapshots', () => {
    insertSnapshot(database, {
      user: USER,
      totalLuna: 100,
      at: iso(0),
    })
    expect(listSnapshotChangeItems(database, USER, 50)).toHaveLength(0)

    insertSnapshot(database, {
      user: USER,
      totalLuna: 100,
      at: iso(3_600_000),
    })
    expect(listSnapshotChangeItems(database, USER, 50)).toHaveLength(0)
  })
})

describe('listStakingIntentItems + merge', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-intent-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('includes intents and merges sources newest-first', () => {
    insertValidator(database)
    insertTx(database, {
      hash: 'd'.repeat(64),
      from: REWARD,
      to: USER,
      timestamp: iso(1_000_000),
      valueLuna: 10_000,
    })
    insertIntent(database, {
      id: 'intent-1',
      user: USER_SPACED,
      operation: 'stake',
      status: 'confirmed',
      createdAt: iso(0),
      confirmedAt: iso(2_000_000),
      txHash: 'e'.repeat(64),
      params: { valueLuna: 500_000, delegation: VALIDATOR },
    })
    insertSnapshot(database, {
      user: USER,
      totalLuna: 1_000_000,
      at: iso(500_000),
    })
    insertSnapshot(database, {
      user: USER,
      totalLuna: 1_100_000,
      at: iso(1_500_000),
    })

    const envelope = readPersonalActivity({
      database,
      address: USER,
      now: () => BASE + 10_000_000,
    })

    expect(envelope.source).toBe('indexer')
    expect(envelope.status).toBe('ok')
    expect(envelope.data.items.length).toBeGreaterThanOrEqual(3)

    const types = envelope.data.items.map((i) => i.type)
    expect(types).toContain('direct-payout')
    expect(types).toContain('observed-position-growth')
    expect(types).toContain('staking-intent')

    // Newest first
    for (let i = 1; i < envelope.data.items.length; i += 1) {
      const prev = Date.parse(envelope.data.items[i - 1]!.at)
      const curr = Date.parse(envelope.data.items[i]!.at)
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })

  it('returns empty timeline with ok status when nothing observed', () => {
    const envelope = readPersonalActivity({
      database,
      address: USER,
      now: () => BASE,
    })
    expect(envelope.data.items).toEqual([])
    expect(envelope.status).toBe('ok')
  })
})

describe('readNetworkActivity', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-net-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('lists recent payout-run summaries', () => {
    insertValidator(database)
    insertPayoutRun(database, {
      startedAt: iso(0),
      endedAt: iso(60_000),
      txCount: 3,
      recipientCount: 2,
      recipients: [USER, OTHER],
      firstBlock: 10,
      lastBlock: 12,
      firstTxHash: 'f'.repeat(64),
      lastTxHash: '0'.repeat(64),
      txHashes: ['f'.repeat(64), '0'.repeat(64)],
      totalValueLuna: 300_000,
    })

    const envelope = readNetworkActivity({
      database,
      now: () => BASE + 3_600_000,
    })
    expect(envelope.status).toBe('ok')
    expect(envelope.data.items).toHaveLength(1)
    expect(envelope.data.items[0]).toMatchObject({
      type: 'payout-run',
      label: 'Observed payout run',
      amountLuna: 300_000,
      txCount: 3,
      recipientCount: 2,
      status: PAYOUT_RUN_STATUS,
    })
  })

  it('unavailable when no runs indexed', () => {
    const envelope = readNetworkActivity({ database, now: () => BASE })
    expect(envelope.status).toBe('unavailable')
    expect(envelope.data.items).toEqual([])
  })
})

describe('HTTP routes', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-act-http-'))
    database = openDatabase(join(directory, 'test.sqlite'))
    const app = createApp({
      database,
      auth: { sessionSecret: TEST_SESSION_SECRET },
    })
    server = createServer(app)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('GET /api/me/activity requires session', async () => {
    const res = await fetch(`${baseUrl}/api/me/activity`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('WALLET_NOT_CONNECTED')
  })

  it('GET /api/me/activity returns timeline for authenticated user', async () => {
    insertValidator(database)
    insertTx(database, {
      hash: 'a'.repeat(64),
      from: REWARD,
      to: USER,
      timestamp: iso(0),
      valueLuna: 42_000,
    })

    const { cookieHeader } = mintSessionCookie(USER, {
      sessionSecret: TEST_SESSION_SECRET,
    })
    const res = await fetch(`${baseUrl}/api/me/activity`, {
      headers: { Cookie: cookieHeader },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { items: Array<{ type: string; amountLuna: number }> }
    }
    expect(body.data.items.some((i) => i.type === 'direct-payout')).toBe(true)
    expect(body.data.items[0]?.amountLuna).toBe(42_000)
  })

  it('GET /api/activity/network is public', async () => {
    insertValidator(database)
    insertPayoutRun(database, {
      startedAt: iso(0),
      endedAt: iso(30_000),
      txCount: 1,
      recipientCount: 1,
      recipients: [USER],
      firstBlock: 1,
      lastBlock: 1,
      firstTxHash: '1'.repeat(64),
      lastTxHash: '1'.repeat(64),
      txHashes: ['1'.repeat(64)],
      totalValueLuna: 100_000,
    })

    const res = await fetch(`${baseUrl}/api/activity/network`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { items: Array<{ type: string }> }
    }
    expect(body.data.items[0]?.type).toBe('payout-run')
  })
})
