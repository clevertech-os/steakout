/**
 * P1-05 — position state normalization + staking-position read/snapshot.
 * Uses P0-04 mainnet fixture shapes + synthetic six-state cases (lifecycle
 * captures absent; field names match PlainStaker / rpc-reads.md).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { mintSessionCookie } from '../../../server/src/auth.js'
import { openDatabase } from '../../../server/src/db.js'
import {
  resetRpcClientConfig,
  setRpcClientConfig,
} from '../../../server/src/nimiq-rpc.js'
import {
  clearPositionCache,
  makeStakerFixture,
  maybeWriteStakerSnapshot,
  normalizePositionState,
  parseStakerBalances,
  POSITION_CACHE_TTL_MS,
  readStakingPosition,
  resolveValidatorName,
  SNAPSHOT_THROTTLE_MS,
} from '../../../server/src/stakingState.js'
import { createMockRpc } from '../../helpers/mockRpc.js'

const TEST_SESSION_SECRET = 'steakout-p1-05-test-session-secret'
const TEST_ADDRESS = 'NQ0000000000000000000000000000000000'
const VALIDATOR_ADDRESS = 'NQ260000000002A5YAK74QNF9MH0TE2BGVRU'
const RPC_URL = 'https://rpc.example.test'

function spaced(address: string): string {
  // NQ + 32 hex-ish chars → user-friendly groups of 4
  const clean = address.replace(/\s+/g, '').toUpperCase()
  return clean.replace(/(.{4})/g, '$1 ').trim()
}

describe('normalizePositionState (six states)', () => {
  it('NotStaked: null staker (P0-04 no-staker path)', () => {
    expect(normalizePositionState({ staker: null })).toBe('NotStaked')
  })

  it('NotStaked: zero balances', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({ balance: 0, inactiveBalance: 0, retiredBalance: 0 }),
      }),
    ).toBe('NotStaked')
  })

  it('Pending: hasPendingTx overrides chain state', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({ balance: 1_000_000, delegation: VALIDATOR_ADDRESS }),
        hasPendingTx: true,
      }),
    ).toBe('Pending')
    expect(
      normalizePositionState({
        staker: null,
        hasPendingTx: true,
      }),
    ).toBe('Pending')
  })

  it('Active: positive active balance, no inactive/retired', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({
          balance: 5_000_000,
          inactiveBalance: 0,
          retiredBalance: 0,
          delegation: VALIDATOR_ADDRESS,
        }),
      }),
    ).toBe('Active')
  })

  it('Active: partial set-active (active + inactive, no retired)', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({
          balance: 2_000_000,
          inactiveBalance: 1_000_000,
          retiredBalance: 0,
          delegation: VALIDATOR_ADDRESS,
        }),
      }),
    ).toBe('Active')
  })

  it('Inactive: only inactive balance', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({
          balance: 0,
          inactiveBalance: 3_000_000,
          retiredBalance: 0,
          inactiveFrom: 57_000_000,
        }),
      }),
    ).toBe('Inactive')
  })

  it('Retiring: retired + remaining active/inactive', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({
          balance: 500_000,
          inactiveBalance: 0,
          retiredBalance: 1_000_000,
        }),
      }),
    ).toBe('Retiring')
    expect(
      normalizePositionState({
        staker: makeStakerFixture({
          balance: 0,
          inactiveBalance: 200_000,
          retiredBalance: 800_000,
        }),
      }),
    ).toBe('Retiring')
  })

  it('Withdrawable: retired-only (Core: immediately removable)', () => {
    expect(
      normalizePositionState({
        staker: makeStakerFixture({
          balance: 0,
          inactiveBalance: 0,
          retiredBalance: 4_000_000,
        }),
      }),
    ).toBe('Withdrawable')
  })

  it('never maps unreadable zero-total garbage to Active', () => {
    const state = normalizePositionState({
      staker: makeStakerFixture({ balance: 0, inactiveBalance: 0, retiredBalance: 0 }),
    })
    expect(state).not.toBe('Active')
  })
})

describe('parseStakerBalances', () => {
  it('sums buckets and nulls empty delegation', () => {
    const balances = parseStakerBalances(
      makeStakerFixture({
        balance: 10,
        inactiveBalance: 20,
        retiredBalance: 30,
        delegation: null,
      }),
    )
    expect(balances).toEqual({
      activeLuna: 10,
      inactiveLuna: 20,
      retiredLuna: 30,
      totalLuna: 60,
      delegation: null,
    })
  })

  it('returns null when balance is not a finite number', () => {
    expect(
      parseStakerBalances({
        address: TEST_ADDRESS,
        balance: Number.NaN,
        delegation: null,
        inactiveBalance: 0,
        inactiveFrom: null,
        retiredBalance: 0,
      }),
    ).toBeNull()
    expect(
      parseStakerBalances({
        address: TEST_ADDRESS,
        balance: Number.POSITIVE_INFINITY,
        delegation: null,
        inactiveBalance: 0,
        inactiveFrom: null,
        retiredBalance: 0,
      }),
    ).toBeNull()
  })

  it('returns null when balance is a non-number (unreadable payload)', () => {
    expect(
      parseStakerBalances({
        address: TEST_ADDRESS,
        // Force garbage shape — RPC should never do this; fail closed.
        balance: 'lots' as unknown as number,
        delegation: null,
        inactiveBalance: 0,
        inactiveFrom: null,
        retiredBalance: 0,
      }),
    ).toBeNull()
  })
})

describe('staker_snapshots throttle + validator name', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  const clock = { now: Date.parse('2026-08-03T12:00:00.000Z') }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-snap-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('writes a snapshot with source_block and throttles within one hour', () => {
    const first = maybeWriteStakerSnapshot(database, {
      userAddress: TEST_ADDRESS,
      validatorAddress: VALIDATOR_ADDRESS,
      activeLuna: 100,
      inactiveLuna: 0,
      retiredLuna: 0,
      totalLuna: 100,
      sourceBlock: 57_873_410,
      nowMs: clock.now,
    })
    expect(first).toBe(true)

    const second = maybeWriteStakerSnapshot(database, {
      userAddress: TEST_ADDRESS,
      validatorAddress: VALIDATOR_ADDRESS,
      activeLuna: 110,
      inactiveLuna: 0,
      retiredLuna: 0,
      totalLuna: 110,
      sourceBlock: 57_873_500,
      nowMs: clock.now + 30 * 60 * 1000,
    })
    expect(second).toBe(false)

    const third = maybeWriteStakerSnapshot(database, {
      userAddress: TEST_ADDRESS,
      validatorAddress: VALIDATOR_ADDRESS,
      activeLuna: 120,
      inactiveLuna: 0,
      retiredLuna: 0,
      totalLuna: 120,
      sourceBlock: 57_874_000,
      nowMs: clock.now + SNAPSHOT_THROTTLE_MS + 1,
    })
    expect(third).toBe(true)

    const rows = database
      .prepare(
        `SELECT source_block, active_balance_luna FROM staker_snapshots
         WHERE user_address = ? ORDER BY id`,
      )
      .all(TEST_ADDRESS) as Array<{ source_block: number; active_balance_luna: number }>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source_block: 57_873_410, active_balance_luna: 100 })
    expect(rows[1]).toMatchObject({ source_block: 57_874_000, active_balance_luna: 120 })
  })

  it('resolveValidatorName returns null when validators table is empty', () => {
    expect(resolveValidatorName(database, VALIDATOR_ADDRESS)).toBeNull()
    expect(resolveValidatorName(database, null)).toBeNull()
  })

  it('resolveValidatorName matches spaced registry addresses', () => {
    database
      .prepare(
        `INSERT INTO validators (address, name, is_listed) VALUES (?, ?, 1)`,
      )
      .run(spaced(VALIDATOR_ADDRESS), 'Acme Validator')
    expect(resolveValidatorName(database, spaced(VALIDATOR_ADDRESS))).toBe('Acme Validator')
    expect(resolveValidatorName(database, VALIDATOR_ADDRESS)).toBe('Acme Validator')
  })
})

describe('readStakingPosition', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    clearPositionCache()
    directory = mkdtempSync(join(tmpdir(), 'steakout-pos-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    clearPositionCache()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('P0-04 no-staker fixture → NotStaked + snapshot + envelope', async () => {
    const clock = { now: Date.parse('2026-08-03T15:00:00.000Z') }
    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      now: () => clock.now,
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => ({
        address: spaced(TEST_ADDRESS),
        balance: 0,
        type: 'basic',
      }),
      getStaker: async () => {
        throw new Error(
          'RPC getStakerByAddress returned an error: Internal error: No staker with address: NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
        )
      },
      getBlock: async () => 57_873_410,
    })

    expect(envelope).toMatchObject({
      source: 'rpc',
      status: 'ok',
      dataFreshness: { ageSeconds: 0 },
      data: {
        state: 'NotStaked',
        accountBalanceLuna: 0,
        htlcBalanceLuna: 0,
        walletBalanceLuna: 0,
        htlcCount: 0,
        staker: {
          activeLuna: 0,
          inactiveLuna: 0,
          retiredLuna: 0,
          totalLuna: 0,
          delegation: null,
          validatorName: null,
        },
        retire: { withdrawableAt: null },
        lastRewardObservation: null,
      },
    })
    expect(envelope.updatedAt).toBe('2026-08-03T15:00:00.000Z')

    const snaps = database
      .prepare(`SELECT COUNT(*) AS n, source_block FROM staker_snapshots WHERE user_address = ?`)
      .get(TEST_ADDRESS) as { n: number; source_block: number }
    expect(snaps.n).toBe(1)
    expect(snaps.source_block).toBe(57_873_410)
  })

  it('Active with registry name when validators row exists', async () => {
    database
      .prepare(`INSERT INTO validators (address, name, is_listed) VALUES (?, ?, 1)`)
      .run(spaced(VALIDATOR_ADDRESS), 'Listed Pool')

    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      bypassCache: true,
      skipHtlcScan: true,
      hasPendingTx: false,
      getAccount: async () => ({
        address: spaced(TEST_ADDRESS),
        balance: 50_000,
        type: 'basic',
      }),
      getStaker: async () =>
        makeStakerFixture({
          balance: 9_000_000,
          inactiveBalance: 0,
          retiredBalance: 0,
          delegation: spaced(VALIDATOR_ADDRESS),
        }),
      getBlock: async () => 100,
    })

    expect(envelope.data.state).toBe('Active')
    expect(envelope.data.staker.validatorName).toBe('Listed Pool')
    expect(envelope.data.staker.activeLuna).toBe(9_000_000)
    expect(envelope.data.accountBalanceLuna).toBe(50_000)
    expect(envelope.data.walletBalanceLuna).toBe(50_000)
    expect(envelope.data.htlcBalanceLuna).toBe(0)
  })

  it('walletBalanceLuna includes open HTLC as sender (Pay-aligned total)', async () => {
    const htlcAddr = 'NQ26 J7L5 8FX6 T8RT T58G 5DE1 U0MF VGLR P0T1'
    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      bypassCache: true,
      skipHtlcScan: false,
      getAccount: async (addr) => {
        const compact = addr.replace(/\s+/g, '')
        if (compact === htlcAddr.replace(/\s+/g, '')) {
          return {
            address: htlcAddr,
            balance: 33_000_000_000,
            type: 'htlc',
            sender: spaced(TEST_ADDRESS),
            recipient: 'NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P',
          }
        }
        return {
          address: spaced(TEST_ADDRESS),
          balance: 0,
          type: 'basic',
        }
      },
      getTransactions: async () => [
        {
          hash: 'bb'.repeat(32),
          from: spaced(TEST_ADDRESS),
          to: htlcAddr,
          value: 33_000_000_000,
          fee: 0,
          executionResult: true,
        },
      ],
      getStaker: async () => {
        throw new Error(
          'RPC getStakerByAddress returned an error: Internal error: No staker with address: NQ00',
        )
      },
      getBlock: async () => 1,
    })

    expect(envelope.data.state).toBe('NotStaked')
    expect(envelope.data.accountBalanceLuna).toBe(0)
    expect(envelope.data.htlcBalanceLuna).toBe(33_000_000_000)
    expect(envelope.data.walletBalanceLuna).toBe(33_000_000_000)
    expect(envelope.data.htlcCount).toBe(1)
  })

  it('null validator name when registry empty but position still returned', async () => {
    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => ({
        address: spaced(TEST_ADDRESS),
        balance: 1,
        type: 'basic',
      }),
      getStaker: async () =>
        makeStakerFixture({
          balance: 1_000,
          delegation: spaced(VALIDATOR_ADDRESS),
        }),
      getBlock: async () => 1,
    })
    expect(envelope.data.state).toBe('Active')
    expect(envelope.data.staker.validatorName).toBeNull()
    expect(envelope.data.staker.delegation).toBe(spaced(VALIDATOR_ADDRESS))
  })

  it('partial when account read fails but staker succeeds', async () => {
    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => {
        throw new Error('account down')
      },
      getStaker: async () =>
        makeStakerFixture({
          balance: 0,
          inactiveBalance: 2_000,
          retiredBalance: 0,
        }),
      getBlock: async () => 1,
    })
    expect(envelope.status).toBe('partial')
    expect(envelope.data.accountBalanceLuna).toBeNull()
    expect(envelope.data.state).toBe('Inactive')
  })

  it('Withdrawable and Retiring from synthetic balances', async () => {
    const withdrawable = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => ({ address: TEST_ADDRESS, balance: 0, type: 'basic' }),
      getStaker: async () =>
        makeStakerFixture({ balance: 0, inactiveBalance: 0, retiredBalance: 7 }),
      getBlock: async () => 1,
    })
    expect(withdrawable.data.state).toBe('Withdrawable')

    const retiring = await readStakingPosition({
      database,
      address: 'NQ1111111111111111111111111111111111',
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => ({
        address: 'NQ1111111111111111111111111111111111',
        balance: 0,
        type: 'basic',
      }),
      getStaker: async () =>
        makeStakerFixture({ balance: 1, inactiveBalance: 0, retiredBalance: 7 }),
      getBlock: async () => 1,
    })
    expect(retiring.data.state).toBe('Retiring')
  })

  it('Pending from pending staking_intents row', async () => {
    const nowMs = Date.parse('2026-08-03T18:00:00.000Z')
    database
      .prepare(
        `INSERT INTO staking_intents (id, user_address, operation, params_json, status, expires_at)
         VALUES ('intent-1', ?, 'stake', '{}', 'pending', ?)`,
      )
      .run(TEST_ADDRESS, new Date(nowMs + 15 * 60_000).toISOString())

    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      now: () => nowMs,
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => ({ address: TEST_ADDRESS, balance: 0, type: 'basic' }),
      getStaker: async () => {
        throw new Error('No staker with address: ' + TEST_ADDRESS)
      },
      getBlock: async () => 1,
    })
    expect(envelope.data.state).toBe('Pending')
  })

  it('short-TTL cache returns source=cache within TTL', async () => {
    let stakerCalls = 0
    const clock = { now: 1_000_000 }
    const opts = {
      database,
      address: TEST_ADDRESS,
      now: () => clock.now,
      getAccount: async () => ({ address: TEST_ADDRESS, balance: 0, type: 'basic' }),
      getStaker: async () => {
        stakerCalls += 1
        return makeStakerFixture({ balance: 42, delegation: null })
      },
      getBlock: async () => 9,
    }

    const first = await readStakingPosition(opts)
    expect(first.source).toBe('rpc')
    expect(stakerCalls).toBe(1)

    clock.now += POSITION_CACHE_TTL_MS / 2
    const second = await readStakingPosition(opts)
    expect(second.source).toBe('cache')
    expect(stakerCalls).toBe(1)
    expect(second.data.staker.activeLuna).toBe(42)

    clock.now += POSITION_CACHE_TTL_MS
    const third = await readStakingPosition(opts)
    expect(third.source).toBe('rpc')
    expect(stakerCalls).toBe(2)
  })

  it('hard staker RPC failure throws PositionReadError (not Active)', async () => {
    await expect(
      readStakingPosition({
        database,
        address: TEST_ADDRESS,
        bypassCache: true,
      skipHtlcScan: true,
        getAccount: async () => ({ address: TEST_ADDRESS, balance: 0, type: 'basic' }),
        getStaker: async () => {
          throw new Error('RPC getStakerByAddress timed out after 10000ms')
        },
        getBlock: async () => 1,
      }),
    ).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE', httpStatus: 503 })
  })

  it('unreadable staker balances → envelope status unavailable (not Active)', async () => {
    const envelope = await readStakingPosition({
      database,
      address: TEST_ADDRESS,
      bypassCache: true,
      skipHtlcScan: true,
      getAccount: async () => ({ address: TEST_ADDRESS, balance: 99, type: 'basic' }),
      getStaker: async () =>
        ({
          address: TEST_ADDRESS,
          balance: Number.NaN,
          delegation: VALIDATOR_ADDRESS,
          inactiveBalance: 0,
          inactiveFrom: null,
          retiredBalance: 0,
        }) as ReturnType<typeof makeStakerFixture>,
      getBlock: async () => 1,
    })
    expect(envelope.status).toBe('unavailable')
    expect(envelope.data.state).toBe('NotStaked')
    expect(envelope.data.staker.activeLuna).toBe(0)
    expect(envelope.data.staker.totalLuna).toBe(0)
    // Account still readable → balance preserved on partial-read path fields
    expect(envelope.data.accountBalanceLuna).toBe(99)
  })

  it('fixture-backed mockRpc no-staker path through real RPC client', async () => {
    const rpc = createMockRpc({
      fixtures: {
        getAccountByAddress: 'rpc/p0-04-account-by-address-mainnet.json',
        getStakerByAddress: 'rpc/p0-04-staker-by-address-mainnet.json',
        getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json',
      },
    })
    setRpcClientConfig({
      fetchImpl: rpc.fetch as unknown as typeof fetch,
      maxAttempts: 1,
      sleep: async () => undefined,
    })
    process.env.NIMIQ_RPC_URL = RPC_URL

    try {
      const envelope = await readStakingPosition({
        database,
        address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
        bypassCache: true,
      skipHtlcScan: true,
        hasPendingTx: false,
      })
      expect(envelope.data.state).toBe('NotStaked')
      expect(envelope.data.accountBalanceLuna).toBe(0)
      expect(envelope.source).toBe('rpc')
      expect(rpc.getCallCount('getStakerByAddress')).toBe(1)
    } finally {
      resetRpcClientConfig()
      delete process.env.NIMIQ_RPC_URL
    }
  })
})

describe('GET /api/me/staking-position', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    clearPositionCache()
    directory = mkdtempSync(join(tmpdir(), 'steakout-pos-http-'))
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
    if (!addr || typeof addr === 'string') throw new Error('expected TCP address')
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterEach(async () => {
    clearPositionCache()
    resetRpcClientConfig()
    delete process.env.NIMIQ_RPC_URL
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('requires session (401 WALLET_NOT_CONNECTED)', async () => {
    const response = await fetch(`${baseUrl}/api/me/staking-position`)
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('WALLET_NOT_CONNECTED')
  })

  it('returns envelope + short Cache-Control when authenticated', async () => {
    const rpc = createMockRpc({
      fixtures: {
        getAccountByAddress: 'rpc/p0-04-account-by-address-mainnet.json',
        getStakerByAddress: 'rpc/p0-04-staker-by-address-mainnet.json',
        getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json',
      },
    })
    setRpcClientConfig({
      fetchImpl: rpc.fetch as unknown as typeof fetch,
      maxAttempts: 1,
      sleep: async () => undefined,
    })
    process.env.NIMIQ_RPC_URL = RPC_URL

    const { cookieHeader } = mintSessionCookie(TEST_ADDRESS, {
      sessionSecret: TEST_SESSION_SECRET,
    })
    const response = await fetch(`${baseUrl}/api/me/staking-position`, {
      headers: { cookie: cookieHeader },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(/private/)
    expect(response.headers.get('cache-control')).toMatch(/max-age=10/)

    const body = (await response.json()) as {
      updatedAt: string
      source: string
      status: string
      dataFreshness: { ageSeconds: number }
      data: { state: string }
    }
    expect(body.source).toBe('rpc')
    expect(body.status).toBe('ok')
    expect(body.data.state).toBe('NotStaked')
    expect(typeof body.updatedAt).toBe('string')
    expect(body.dataFreshness.ageSeconds).toBe(0)
  })
})
