/**
 * P1-06 — staking intent create + chain matcher confirm.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { mintSessionCookie } from '../../../server/src/auth.js'
import { openDatabase } from '../../../server/src/db.js'
import type { NimiqTransaction } from '../../../server/src/nimiq-rpc.js'
import {
  confirmStakingIntent,
  countPendingIntents,
  createStakingIntent,
  INTENT_TTL_MS,
  normalizeProviderTxRef,
  StakingIntentError,
} from '../../../server/src/stakingIntents.js'
import {
  clearPositionCache,
  type StakingPositionEnvelope,
} from '../../../server/src/stakingState.js'

const TEST_SESSION_SECRET = 'steakout-p1-06-test-session-secret'
const TEST_ADDRESS = 'NQ0000000000000000000000000000000000'
const OTHER_ADDRESS = 'NQ1111111111111111111111111111111111'
const VALIDATOR_ADDRESS = 'NQ260000000002A5YAK74QNF9MH0TE2BGVRU'
const TX_HASH = '07f7a5e236aad83e3631c0544ab4756cba091ebf5ced6593669b750c8afa8a73'

const FIXED_NOW = Date.parse('2026-08-03T18:00:00.000Z')

function notStakedEnvelope(): StakingPositionEnvelope {
  return {
    updatedAt: new Date(FIXED_NOW).toISOString(),
    source: 'rpc',
    status: 'ok',
    dataFreshness: { ageSeconds: 0 },
    data: {
      state: 'NotStaked',
      accountBalanceLuna: 1_000_000,
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
  }
}

function activeEnvelope(
  partial?: Partial<StakingPositionEnvelope['data']['staker']>,
): StakingPositionEnvelope {
  return {
    updatedAt: new Date(FIXED_NOW).toISOString(),
    source: 'rpc',
    status: 'ok',
    dataFreshness: { ageSeconds: 0 },
    data: {
      state: 'Active',
      accountBalanceLuna: 50_000,
      staker: {
        activeLuna: 5_000_000,
        inactiveLuna: 0,
        retiredLuna: 0,
        totalLuna: 5_000_000,
        delegation: VALIDATOR_ADDRESS,
        validatorName: 'Listed Pool',
        ...partial,
      },
      retire: { withdrawableAt: null },
      lastRewardObservation: null,
    },
  }
}

function withdrawableEnvelope(): StakingPositionEnvelope {
  return {
    updatedAt: new Date(FIXED_NOW).toISOString(),
    source: 'rpc',
    status: 'ok',
    dataFreshness: { ageSeconds: 0 },
    data: {
      state: 'Withdrawable',
      accountBalanceLuna: 0,
      staker: {
        activeLuna: 0,
        inactiveLuna: 0,
        retiredLuna: 2_000_000,
        totalLuna: 2_000_000,
        delegation: null,
        validatorName: null,
      },
      retire: { withdrawableAt: null },
      lastRewardObservation: null,
    },
  }
}

function retiringEnvelope(): StakingPositionEnvelope {
  return {
    updatedAt: new Date(FIXED_NOW).toISOString(),
    source: 'rpc',
    status: 'ok',
    dataFreshness: { ageSeconds: 0 },
    data: {
      state: 'Retiring',
      accountBalanceLuna: 0,
      staker: {
        activeLuna: 1_000_000,
        inactiveLuna: 0,
        retiredLuna: 1_000_000,
        totalLuna: 2_000_000,
        delegation: VALIDATOR_ADDRESS,
        validatorName: null,
      },
      retire: { withdrawableAt: null },
      lastRewardObservation: null,
    },
  }
}

function makeTx(partial: Partial<NimiqTransaction> = {}): NimiqTransaction {
  return {
    hash: TX_HASH,
    blockNumber: 57_873_360,
    timestamp: 1_785_734_307_433,
    confirmations: 50,
    from: TEST_ADDRESS,
    to: VALIDATOR_ADDRESS,
    value: 1_000_000,
    fee: 0,
    executionResult: true,
    ...partial,
  }
}

describe('normalizeProviderTxRef', () => {
  it('accepts 64-hex hash with optional 0x', () => {
    expect(normalizeProviderTxRef(TX_HASH)).toBe(TX_HASH)
    expect(normalizeProviderTxRef(`0x${TX_HASH}`)).toBe(TX_HASH)
    expect(normalizeProviderTxRef(`0X${TX_HASH.toUpperCase()}`)).toBe(TX_HASH)
  })

  it('accepts object with hash field', () => {
    expect(normalizeProviderTxRef({ hash: TX_HASH })).toBe(TX_HASH)
    expect(normalizeProviderTxRef({ txHash: `0x${TX_HASH}` })).toBe(TX_HASH)
  })

  it('rejects non-hash / serialized blobs with VALIDATION', () => {
    expect(() => normalizeProviderTxRef('not-a-hash')).toThrow(StakingIntentError)
    try {
      normalizeProviderTxRef('aabbcc')
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION', httpStatus: 400 })
      expect(String((error as Error).message)).toMatch(/device evidence|P0-03/i)
    }
    expect(() => normalizeProviderTxRef({ serialized: 'deadbeef' })).toThrow(
      StakingIntentError,
    )
  })
})

describe('createStakingIntent', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    clearPositionCache()
    directory = mkdtempSync(join(tmpdir(), 'steakout-intent-'))
    database = openDatabase(join(directory, 'test.sqlite'))
    database
      .prepare(
        `INSERT INTO validators (address, name, is_listed) VALUES (?, ?, 1)`,
      )
      .run(VALIDATOR_ADDRESS, 'Listed Pool')
  })

  afterEach(() => {
    clearPositionCache()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('happy path: new-staker creates pending intent with review summary', async () => {
    const result = await createStakingIntent(
      {
        database,
        now: () => FIXED_NOW,
        readPosition: async () => notStakedEnvelope(),
      },
      TEST_ADDRESS,
      {
        operation: 'new-staker',
        params: { valueLuna: 1_000_000, delegation: VALIDATOR_ADDRESS },
      },
    )

    expect(result.intentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(result.expiresAt).toBe(new Date(FIXED_NOW + INTENT_TTL_MS).toISOString())
    expect(result.summary.operation).toBe('new-staker')
    expect(result.summary.operationLabel).toBe('Create staker')
    expect(result.summary.amountLuna).toBe(1_000_000)
    expect(result.summary.amountNim).toBe(10)
    expect(result.summary.validatorAddress).toBe(VALIDATOR_ADDRESS)
    expect(result.summary.validatorName).toBe('Listed Pool')
    expect(result.summary.fromState).toBe('NotStaked')
    expect(result.summary.toStateHint).toBe('Active')
    expect(result.summary.waitingPeriodNote).toBeNull()
    expect(result.summary.networkNote).toMatch(/mainnet|testnet|network/i)

    expect(countPendingIntents(database, TEST_ADDRESS, FIXED_NOW)).toBe(1)
    const row = database
      .prepare(`SELECT status, operation, params_json FROM staking_intents WHERE id = ?`)
      .get(result.intentId) as {
      status: string
      operation: string
      params_json: string
    }
    expect(row.status).toBe('pending')
    expect(row.operation).toBe('new-staker')
    expect(JSON.parse(row.params_json)).toEqual({
      valueLuna: 1_000_000,
      delegation: VALIDATOR_ADDRESS,
    })
  })

  it('precondition fail: stake without staker', async () => {
    await expect(
      createStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        { operation: 'stake', params: { valueLuna: 100 } },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      httpStatus: 400,
      message: expect.stringMatching(/existing staker|create staker/i),
    })
  })

  it('precondition fail: new-staker when already Active', async () => {
    await expect(
      createStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          readPosition: async () => activeEnvelope(),
        },
        TEST_ADDRESS,
        {
          operation: 'new-staker',
          params: { valueLuna: 100, delegation: VALIDATOR_ADDRESS },
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', httpStatus: 400 })
  })

  it('precondition fail: remove while Retiring (not ready)', async () => {
    await expect(
      createStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          readPosition: async () => retiringEnvelope(),
        },
        TEST_ADDRESS,
        { operation: 'remove', params: { valueLuna: 1_000_000 } },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/not yet ready|Withdrawable/i),
    })
  })

  it('remove allowed when Withdrawable', async () => {
    const result = await createStakingIntent(
      {
        database,
        now: () => FIXED_NOW,
        readPosition: async () => withdrawableEnvelope(),
      },
      TEST_ADDRESS,
      { operation: 'remove', params: { valueLuna: 2_000_000 } },
    )
    expect(result.summary.operation).toBe('remove')
    expect(result.summary.toStateHint).toBe('NotStaked')
    expect(result.summary.waitingPeriodNote).toMatch(/Withdrawable/i)
  })

  it('rejects invalid operation and amounts', async () => {
    await expect(
      createStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        { operation: 'nope', params: {} },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    await expect(
      createStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        {
          operation: 'new-staker',
          params: { valueLuna: 0, delegation: VALIDATOR_ADDRESS },
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    await expect(
      createStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        {
          operation: 'new-staker',
          params: { valueLuna: 100, delegation: 'not-an-address' },
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('confirmStakingIntent', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    clearPositionCache()
    directory = mkdtempSync(join(tmpdir(), 'steakout-confirm-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    clearPositionCache()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  async function seedPendingIntent(
    params: {
      user?: string
      operation?: string
      paramsJson?: string
      expiresAt?: string
      status?: string
    } = {},
  ): Promise<string> {
    const id = '11111111-1111-1111-1111-111111111111'
    database
      .prepare(
        `INSERT INTO staking_intents (
           id, user_address, operation, params_json, status, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.user ?? TEST_ADDRESS,
        params.operation ?? 'new-staker',
        params.paramsJson ??
          JSON.stringify({
            valueLuna: 1_000_000,
            delegation: VALIDATOR_ADDRESS,
          }),
        params.status ?? 'pending',
        params.expiresAt ?? new Date(FIXED_NOW + INTENT_TTL_MS).toISOString(),
      )
    return id
  }

  it('tx not found → TX_PENDING 202', async () => {
    const intentId = await seedPendingIntent()
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () => null,
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'TX_PENDING',
      httpStatus: 202,
    })

    const row = database
      .prepare(`SELECT status FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string }
    expect(row.status).toBe('pending')
  })

  it('confirm match → confirmed + position envelope', async () => {
    const intentId = await seedPendingIntent()
    const after = activeEnvelope({
      activeLuna: 1_000_000,
      totalLuna: 1_000_000,
      delegation: VALIDATOR_ADDRESS,
    })

    const result = await confirmStakingIntent(
      {
        database,
        now: () => FIXED_NOW,
        fetchTx: async () => makeTx({ value: 1_000_000, from: TEST_ADDRESS }),
        readPosition: async () => after,
      },
      TEST_ADDRESS,
      { intentId, txHash: `0x${TX_HASH}` },
    )

    expect(result.status).toBe('confirmed')
    expect(result.blockNumber).toBe(57_873_360)
    expect(result.position.data.state).toBe('Active')
    expect(result.position.data.staker.activeLuna).toBe(1_000_000)

    const row = database
      .prepare(
        `SELECT status, tx_hash, confirmed_at FROM staking_intents WHERE id = ?`,
      )
      .get(intentId) as {
      status: string
      tx_hash: string
      confirmed_at: string
    }
    expect(row.status).toBe('confirmed')
    expect(row.tx_hash).toBe(TX_HASH)
    expect(row.confirmed_at).toBe(new Date(FIXED_NOW).toISOString())
  })

  it('amount mismatch → TX_MISMATCH', async () => {
    const intentId = await seedPendingIntent()
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () => makeTx({ value: 999, from: TEST_ADDRESS }),
          readPosition: async () => activeEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'TX_MISMATCH',
      httpStatus: 422,
      message: expect.stringMatching(/amount/i),
    })
  })

  it('from-address mismatch → TX_MISMATCH', async () => {
    const intentId = await seedPendingIntent()
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () =>
            makeTx({ value: 1_000_000, from: OTHER_ADDRESS }),
          readPosition: async () => activeEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'TX_MISMATCH',
      httpStatus: 422,
      message: expect.stringMatching(/sender/i),
    })
  })

  it('executionResult false → TX_FAILED and status failed', async () => {
    const intentId = await seedPendingIntent()
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () =>
            makeTx({ value: 1_000_000, executionResult: false }),
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'TX_FAILED',
      httpStatus: 422,
    })

    const row = database
      .prepare(`SELECT status, tx_hash FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string; tx_hash: string }
    expect(row.status).toBe('failed')
    expect(row.tx_hash).toBe(TX_HASH)
  })

  it('expired intent → INTENT_NOT_FOUND and status expired', async () => {
    const intentId = await seedPendingIntent({
      expiresAt: new Date(FIXED_NOW - 1_000).toISOString(),
    })
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () => makeTx(),
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'INTENT_NOT_FOUND',
      httpStatus: 404,
    })

    const row = database
      .prepare(`SELECT status FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string }
    expect(row.status).toBe('expired')
  })

  it('replay confirmed intent rejected', async () => {
    const intentId = await seedPendingIntent({ status: 'confirmed' })
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () => makeTx(),
          readPosition: async () => activeEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/already been confirmed|cannot be reused/i),
    })
  })

  it('cross-user intent use → INTENT_NOT_FOUND', async () => {
    const intentId = await seedPendingIntent({ user: OTHER_ADDRESS })
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () => makeTx({ from: TEST_ADDRESS }),
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        { intentId, txHash: TX_HASH },
      ),
    ).rejects.toMatchObject({
      code: 'INTENT_NOT_FOUND',
      httpStatus: 404,
    })
  })

  it('unknown intentId → INTENT_NOT_FOUND', async () => {
    await expect(
      confirmStakingIntent(
        {
          database,
          now: () => FIXED_NOW,
          fetchTx: async () => makeTx(),
          readPosition: async () => notStakedEnvelope(),
        },
        TEST_ADDRESS,
        {
          intentId: '99999999-9999-9999-9999-999999999999',
          txHash: TX_HASH,
        },
      ),
    ).rejects.toMatchObject({ code: 'INTENT_NOT_FOUND', httpStatus: 404 })
  })
})

describe('HTTP POST /api/staking/intent|confirm', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  let server: Server
  let baseUrl: string
  let fetchTxImpl: () => Promise<NimiqTransaction | null>
  let positionImpl: () => Promise<StakingPositionEnvelope>

  beforeEach(async () => {
    clearPositionCache()
    directory = mkdtempSync(join(tmpdir(), 'steakout-intent-http-'))
    database = openDatabase(join(directory, 'test.sqlite'))
    fetchTxImpl = async () => null
    positionImpl = async () => notStakedEnvelope()

    const app = createApp({
      database,
      auth: { sessionSecret: TEST_SESSION_SECRET },
      staking: {
        now: () => FIXED_NOW,
        readPosition: async () => positionImpl(),
        fetchTx: async () => fetchTxImpl(),
      },
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function cookieFor(address = TEST_ADDRESS): string {
    return mintSessionCookie(address, {
      sessionSecret: TEST_SESSION_SECRET,
      now: () => FIXED_NOW,
    }).cookieHeader
  }

  it('requires auth on intent and confirm', async () => {
    const intent = await fetch(`${baseUrl}/api/staking/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'new-staker',
        params: { valueLuna: 1, delegation: VALIDATOR_ADDRESS },
      }),
    })
    expect(intent.status).toBe(401)

    const confirm = await fetch(`${baseUrl}/api/staking/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentId: 'x', txHash: TX_HASH }),
    })
    expect(confirm.status).toBe(401)
  })

  it('intent → confirm pending → confirm success over HTTP', async () => {
    positionImpl = async () => notStakedEnvelope()
    const intentRes = await fetch(`${baseUrl}/api/staking/intent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieFor(),
      },
      body: JSON.stringify({
        operation: 'new-staker',
        params: { valueLuna: 1_000_000, delegation: VALIDATOR_ADDRESS },
      }),
    })
    expect(intentRes.status).toBe(200)
    const intentBody = (await intentRes.json()) as {
      intentId: string
      summary: { amountLuna: number }
    }
    expect(intentBody.summary.amountLuna).toBe(1_000_000)

    fetchTxImpl = async () => null
    const pendingRes = await fetch(`${baseUrl}/api/staking/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieFor(),
      },
      body: JSON.stringify({
        intentId: intentBody.intentId,
        txHash: TX_HASH,
      }),
    })
    expect(pendingRes.status).toBe(202)
    const pendingBody = (await pendingRes.json()) as {
      error: { code: string; retryAfterSeconds?: number }
    }
    expect(pendingBody.error.code).toBe('TX_PENDING')
    expect(pendingBody.error.retryAfterSeconds).toBeGreaterThan(0)

    fetchTxImpl = async () => makeTx({ value: 1_000_000, from: TEST_ADDRESS })
    positionImpl = async () =>
      activeEnvelope({
        activeLuna: 1_000_000,
        totalLuna: 1_000_000,
        delegation: VALIDATOR_ADDRESS,
      })

    const okRes = await fetch(`${baseUrl}/api/staking/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieFor(),
      },
      body: JSON.stringify({
        intentId: intentBody.intentId,
        txHash: TX_HASH,
      }),
    })
    expect(okRes.status).toBe(200)
    const okBody = (await okRes.json()) as {
      status: string
      position: StakingPositionEnvelope
    }
    expect(okBody.status).toBe('confirmed')
    expect(okBody.position.data.state).toBe('Active')

    // Replay
    const replay = await fetch(`${baseUrl}/api/staking/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieFor(),
      },
      body: JSON.stringify({
        intentId: intentBody.intentId,
        txHash: TX_HASH,
      }),
    })
    expect(replay.status).toBe(400)
    const replayBody = (await replay.json()) as { error: { code: string } }
    expect(replayBody.error.code).toBe('VALIDATION')
  })
})
