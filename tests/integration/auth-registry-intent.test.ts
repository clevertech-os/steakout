/**
 * P1-15 — Integration: auth, registry, intent/confirm, RPC fixture normalization.
 * Offline only: real crypto for auth; injected fetchTx / mockRpc; fixture registry sync.
 * No live network or device.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BufferUtils, Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/src/app.js'
import {
  buildChallengeMessage,
  COOKIE_NAME,
  mintSessionCookie,
} from '../../server/src/auth.js'
import { openDatabase } from '../../server/src/db.js'
import {
  fetchTransaction,
  getAccountByAddress,
  getActiveValidators,
  getBlockNumber,
  getStakerByAddress,
  getValidatorByAddress,
  isStakerNotFoundError,
  resetRpcClientConfig,
  resetRpcMetrics,
  setRpcClientConfig,
} from '../../server/src/nimiq-rpc.js'
import { clearRateLimitBuckets } from '../../server/src/rate-limit.js'
import { clearPublicResponseCache } from '../../server/src/responseCache.js'
import type { NimiqTransaction } from '../../server/src/nimiq-rpc.js'
import {
  clearPositionCache,
  type StakingPositionEnvelope,
} from '../../server/src/stakingState.js'
import { syncValidators } from '../../server/src/validatorSync.js'
import type { ValidatorsFetch } from '../../server/src/validators-api.js'
import { normalizeAddress } from '../../server/src/addresses.js'
import { createMockRpc } from '../helpers/mockRpc.js'

// ---------------------------------------------------------------------------
// Shared constants / helpers
// ---------------------------------------------------------------------------

const TEST_SESSION_SECRET = 'steakout-p1-15-integration-session-secret'
const FIXTURE_PRIVATE_KEY_HEX = '00'.repeat(32)
const MSG_PREFIX = '\x16Nimiq Signed Message:\n'
const VALIDATOR_ADDRESS = 'NQ260000000002A5YAK74QNF9MH0TE2BGVRU'
const TX_HASH = '07f7a5e236aad83e3631c0544ab4756cba091ebf5ced6593669b750c8afa8a73'
const FIXED_NOW = Date.parse('2026-08-03T18:00:00.000Z')
const REGISTRY_STAMP = '2026-08-03T12:00:00.000Z'
const RPC_URL = 'https://rpc.p1-15.example.test'

const registryDir = resolve(process.cwd(), 'tests/fixtures/registry')
const knownFixture = JSON.parse(
  readFileSync(join(registryDir, 'p0-05-validators-known-mainnet.json'), 'utf8'),
) as unknown[]
const observableFixture = JSON.parse(
  readFileSync(join(registryDir, 'p0-05-validators-observable-mainnet.json'), 'utf8'),
) as unknown[]

const databases: Array<{ close: () => void }> = []
const temporaryDirectories: string[] = []
const servers: Server[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  clearRateLimitBuckets()
  clearPublicResponseCache()
  clearPositionCache()
  resetRpcClientConfig()
  resetRpcMetrics()
  for (const server of servers.splice(0)) {
    server.close()
  }
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function deriveFixtureWallet() {
  const keyPair = KeyPair.derive(PrivateKey.fromHex(FIXTURE_PRIVATE_KEY_HEX))
  const publicKeyHex = keyPair.publicKey.toHex()
  const address = normalizeAddress(keyPair.publicKey.toAddress().toUserFriendlyAddress())
  return { keyPair, publicKeyHex, address }
}

function signChallengeMessage(message: string, privateKeyHex = FIXTURE_PRIVATE_KEY_HEX) {
  const keyPair = KeyPair.derive(PrivateKey.fromHex(privateKeyHex))
  const data = MSG_PREFIX + message.length + message
  const hash = Hash.computeSha256(BufferUtils.fromUtf8(data))
  const signature = keyPair.sign(hash)
  return {
    publicKey: keyPair.publicKey.toHex(),
    signature: signature.toHex(),
  }
}

function extractSessionCookie(setCookie: string | string[] | null): string | null {
  if (!setCookie) return null
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie]
  for (const header of headers) {
    const match = header.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
    if (match?.[1]) return `${COOKIE_NAME}=${match[1]}`
  }
  return null
}

function openTempDb(prefix = 'steakout-p1-15-'): ReturnType<typeof openDatabase> {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  const database = openDatabase(join(directory, 'test.sqlite'))
  databases.push(database)
  return database
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('expected TCP listen address')
  return { baseUrl: `http://127.0.0.1:${addr.port}`, server }
}

function notStakedEnvelope(addressBalance = 1_000_000): StakingPositionEnvelope {
  return {
    updatedAt: new Date(FIXED_NOW).toISOString(),
    source: 'rpc',
    status: 'ok',
    dataFreshness: { ageSeconds: 0 },
    data: {
      state: 'NotStaked',
      accountBalanceLuna: addressBalance,
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
        activeLuna: 1_000_000,
        inactiveLuna: 0,
        retiredLuna: 0,
        totalLuna: 1_000_000,
        delegation: VALIDATOR_ADDRESS,
        validatorName: 'Listed Pool',
        ...partial,
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
    from: deriveFixtureWallet().address,
    to: VALIDATOR_ADDRESS,
    value: 1_000_000,
    fee: 0,
    executionResult: true,
    ...partial,
  }
}

function fixtureFetcher(): ValidatorsFetch {
  return async (input) => {
    const url = String(input)
    const onlyKnown = url.includes('only-known=true')
    return {
      ok: true,
      status: 200,
      json: async () => (onlyKnown ? knownFixture : observableFixture),
    } as Response
  }
}

function seedValidator(database: ReturnType<typeof openDatabase>): void {
  database
    .prepare(`INSERT INTO validators (address, name, is_listed) VALUES (?, ?, 1)`)
    .run(VALIDATOR_ADDRESS, 'Listed Pool')
}

// ---------------------------------------------------------------------------
// 1. Auth: challenge → verify → session (real Nimiq crypto, no wallet fixture)
// ---------------------------------------------------------------------------

describe('P1-15 auth challenge → verify → session', () => {
  let baseUrl: string
  let clock: { now: number }
  let fixture: ReturnType<typeof deriveFixtureWallet>

  beforeEach(async () => {
    clearRateLimitBuckets()
    const database = openTempDb('steakout-p1-15-auth-')
    clock = { now: FIXED_NOW }
    fixture = deriveFixtureWallet()
    const app = createApp({
      database,
      auth: {
        sessionSecret: TEST_SESSION_SECRET,
        now: () => clock.now,
      },
    })
    ;({ baseUrl } = await listen(app))
  })

  it('challenge → sign → verify → session cookie → GET /api/me', async () => {
    const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: fixture.address }),
    })
    expect(challengeRes.status).toBe(200)
    const challenge = (await challengeRes.json()) as {
      challengeId: string
      message: string
      expiresAt: string
    }
    expect(challenge.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(challenge.message).toBe(
      buildChallengeMessage(challenge.challengeId, fixture.address),
    )

    const signed = signChallengeMessage(challenge.message)
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: signed.signature,
        publicKey: signed.publicKey,
      }),
    })
    expect(verifyRes.status).toBe(200)
    const verified = (await verifyRes.json()) as {
      address: string
      sessionExpiresAt: string
    }
    expect(verified.address).toBe(fixture.address)

    const setCookie = verifyRes.headers.getSetCookie?.() ?? []
    const cookieHeader =
      extractSessionCookie(setCookie.length ? setCookie : verifyRes.headers.get('set-cookie'))
    expect(cookieHeader).toBeTruthy()

    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { cookie: cookieHeader! },
    })
    expect(meRes.status).toBe(200)
    const me = (await meRes.json()) as { address: string }
    expect(me.address).toBe(fixture.address)
  })

  it('rejection codes: CHALLENGE_EXPIRED, SIGNATURE_REJECTED, WALLET_NOT_CONNECTED', async () => {
    // Reused challenge → CHALLENGE_EXPIRED
    const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: fixture.address }),
    })
    const challenge = (await challengeRes.json()) as { challengeId: string; message: string }
    const signed = signChallengeMessage(challenge.message)

    const first = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: signed.signature,
        publicKey: signed.publicKey,
      }),
    })
    expect(first.status).toBe(200)

    const reuse = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: signed.signature,
        publicKey: signed.publicKey,
      }),
    })
    expect(reuse.status).toBe(401)
    expect(((await reuse.json()) as { error: { code: string } }).error.code).toBe(
      'CHALLENGE_EXPIRED',
    )

    // Tampered signature → SIGNATURE_REJECTED
    const challenge2Res = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: fixture.address }),
    })
    const challenge2 = (await challenge2Res.json()) as { challengeId: string; message: string }
    const good = signChallengeMessage(challenge2.message)
    const tampered = good.signature.replace(/0/g, '1').replace(/1/g, '0')
    const badSig = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge2.challengeId,
        signature: tampered,
        publicKey: good.publicKey,
      }),
    })
    expect(badSig.status).toBe(401)
    expect(((await badSig.json()) as { error: { code: string } }).error.code).toBe(
      'SIGNATURE_REJECTED',
    )

    // No session → WALLET_NOT_CONNECTED
    const meRes = await fetch(`${baseUrl}/api/me`)
    expect(meRes.status).toBe(401)
    expect(((await meRes.json()) as { error: { code: string } }).error.code).toBe(
      'WALLET_NOT_CONNECTED',
    )
  })
})

// ---------------------------------------------------------------------------
// 2. Intent → confirm polling (pending → confirmed, failed, mismatch)
//    Auth via minted session cookie (pragmatic; full challenge covered above).
// ---------------------------------------------------------------------------

describe('P1-15 intent → confirm (mocked chain tx)', () => {
  let baseUrl: string
  let database: ReturnType<typeof openDatabase>
  let userAddress: string
  let fetchTxImpl: (hash: string) => Promise<NimiqTransaction | null>
  let positionImpl: () => Promise<StakingPositionEnvelope>

  function cookie(): string {
    return mintSessionCookie(userAddress, {
      sessionSecret: TEST_SESSION_SECRET,
      now: () => FIXED_NOW,
    }).cookieHeader
  }

  async function createIntent(valueLuna = 1_000_000): Promise<string> {
    const res = await fetch(`${baseUrl}/api/staking/intent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookie(),
      },
      body: JSON.stringify({
        operation: 'new-staker',
        params: { valueLuna, delegation: VALIDATOR_ADDRESS },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { intentId: string }
    return body.intentId
  }

  async function confirm(intentId: string, txHash = TX_HASH) {
    return fetch(`${baseUrl}/api/staking/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookie(),
      },
      body: JSON.stringify({ intentId, txHash }),
    })
  }

  beforeEach(async () => {
    clearRateLimitBuckets()
    clearPositionCache()
    database = openTempDb('steakout-p1-15-intent-')
    seedValidator(database)
    userAddress = deriveFixtureWallet().address
    fetchTxImpl = async () => null
    positionImpl = async () => notStakedEnvelope()

    const app = createApp({
      database,
      auth: { sessionSecret: TEST_SESSION_SECRET, now: () => FIXED_NOW },
      staking: {
        now: () => FIXED_NOW,
        readPosition: async () => positionImpl(),
        fetchTx: async (hash) => fetchTxImpl(hash),
      },
    })
    ;({ baseUrl } = await listen(app))
  })

  it('intent create → confirm TX_PENDING → confirm success', async () => {
    const intentId = await createIntent(1_000_000)

    // Pending: tx not yet visible
    fetchTxImpl = async () => null
    const pendingRes = await confirm(intentId)
    expect(pendingRes.status).toBe(202)
    const pendingBody = (await pendingRes.json()) as {
      error: { code: string; retryAfterSeconds?: number }
    }
    expect(pendingBody.error.code).toBe('TX_PENDING')
    expect(pendingBody.error.retryAfterSeconds).toBeGreaterThan(0)

    // Intent still pending in DB
    const rowPending = database
      .prepare(`SELECT status FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string }
    expect(rowPending.status).toBe('pending')

    // Confirmed on chain + position reflects Active
    fetchTxImpl = async () =>
      makeTx({ from: userAddress, value: 1_000_000, executionResult: true })
    positionImpl = async () =>
      activeEnvelope({
        activeLuna: 1_000_000,
        totalLuna: 1_000_000,
        delegation: VALIDATOR_ADDRESS,
      })

    const okRes = await confirm(intentId)
    expect(okRes.status).toBe(200)
    const okBody = (await okRes.json()) as {
      status: string
      position: StakingPositionEnvelope
    }
    expect(okBody.status).toBe('confirmed')
    expect(okBody.position.data.state).toBe('Active')

    const rowOk = database
      .prepare(`SELECT status, tx_hash FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string; tx_hash: string }
    expect(rowOk.status).toBe('confirmed')
    expect(rowOk.tx_hash).toBe(TX_HASH)
  })

  it('confirm TX_FAILED when executionResult is false', async () => {
    const intentId = await createIntent(1_000_000)
    fetchTxImpl = async () =>
      makeTx({ from: userAddress, value: 1_000_000, executionResult: false })

    const res = await confirm(intentId)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TX_FAILED')

    const row = database
      .prepare(`SELECT status FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string }
    expect(row.status).toBe('failed')
  })

  it('confirm TX_MISMATCH on amount or sender mismatch', async () => {
    const intentId = await createIntent(1_000_000)

    // Wrong amount
    fetchTxImpl = async () => makeTx({ from: userAddress, value: 999 })
    const amountRes = await confirm(intentId)
    expect(amountRes.status).toBe(422)
    expect(((await amountRes.json()) as { error: { code: string } }).error.code).toBe(
      'TX_MISMATCH',
    )

    // Intent remains pending after mismatch (does not mark failed)
    const row = database
      .prepare(`SELECT status FROM staking_intents WHERE id = ?`)
      .get(intentId) as { status: string }
    expect(row.status).toBe('pending')

    // Wrong sender
    fetchTxImpl = async () =>
      makeTx({ from: 'NQ1111111111111111111111111111111111', value: 1_000_000 })
    const senderRes = await confirm(intentId)
    expect(senderRes.status).toBe(422)
    expect(((await senderRes.json()) as { error: { code: string } }).error.code).toBe(
      'TX_MISMATCH',
    )
  })

  it('confirm INTENT_NOT_FOUND for unknown intentId', async () => {
    const res = await confirm('99999999-9999-9999-9999-999999999999')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'INTENT_NOT_FOUND',
    )
  })

  it('staking routes require auth (WALLET_NOT_CONNECTED)', async () => {
    const intent = await fetch(`${baseUrl}/api/staking/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'new-staker',
        params: { valueLuna: 1, delegation: VALIDATOR_ADDRESS },
      }),
    })
    expect(intent.status).toBe(401)
    expect(((await intent.json()) as { error: { code: string } }).error.code).toBe(
      'WALLET_NOT_CONNECTED',
    )
  })
})

// ---------------------------------------------------------------------------
// 3. Registry: fixture sync → GET /api/validators list
// ---------------------------------------------------------------------------

describe('P1-15 registry fixture ingestion → list API', () => {
  it('syncs known+observable fixtures then serves normalized list', async () => {
    const database = openTempDb('steakout-p1-15-reg-')
    const result = await syncValidators({
      database,
      now: () => REGISTRY_STAMP,
      logger: () => {},
      fetchOptions: {
        apiUrl: 'https://registry.example.test/api/v1/validators',
        fetcher: fixtureFetcher(),
        resolveRewardAddress: async (address) => address,
      },
    })

    expect(result.upserted).toBe(78)
    expect(result.knownOnly.validators).toHaveLength(24)
    expect(result.allObservable.validators).toHaveLength(78)

    const app = createApp({ database })
    const { baseUrl } = await listen(app)

    const listRes = await fetch(`${baseUrl}/api/validators`)
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      source: string
      status: string
      data: {
        validators: Array<{
          address: string
          name: string | null
          isListed: boolean
          officialScore: number | null
        }>
      }
    }
    expect(listBody.source).toBe('registry')
    expect(listBody.status).toBe('ok')
    expect(listBody.data.validators).toHaveLength(78)
    // Listed subset present
    const listed = listBody.data.validators.filter((v) => v.isListed)
    expect(listed.length).toBe(24)
    // No fabricated official scores of -1
    expect(
      listBody.data.validators.every(
        (v) => v.officialScore === null || v.officialScore >= 0,
      ),
    ).toBe(true)

    // Detail for a known listed address from fixtures
    const sample = listed[0]
    expect(sample).toBeDefined()
    if (!sample) return
    const detailRes = await fetch(
      `${baseUrl}/api/validators/${encodeURIComponent(sample.address)}`,
    )
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as {
      data: { address: string; isListed: boolean }
    }
    expect(detail.data.address).toBe(sample.address)
    expect(detail.data.isListed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. RPC normalization from P0-04 fixtures via mockRpc (no live network)
// ---------------------------------------------------------------------------

describe('P1-15 RPC fixture normalization (mockRpc)', () => {
  beforeEach(() => {
    resetRpcClientConfig()
    resetRpcMetrics()
    setRpcClientConfig({
      maxAttempts: 2,
      retryBaseMs: 1,
      retryMaxMs: 2,
      retryJitter: 0,
      sleep: async () => undefined,
    })
  })

  it('normalizes account, validator, active validators, tx, block from P0-04', async () => {
    const rpc = createMockRpc({
      fixtures: {
        getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json',
        getValidatorByAddress: 'rpc/p0-04-validator-by-address-mainnet.json',
        getActiveValidators: 'rpc/p0-04-active-validators-mainnet.json',
        getAccountByAddress: 'rpc/p0-04-account-by-address-mainnet.json',
        getStakerByAddress: 'rpc/p0-04-staker-by-address-mainnet.json',
        getTransactionByHash: 'rpc/p0-04-transaction-by-hash-mainnet.json',
      },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    const block = await getBlockNumber(RPC_URL)
    expect(typeof block).toBe('number')
    expect(block).toBeGreaterThan(0)

    const validator = await getValidatorByAddress(VALIDATOR_ADDRESS, RPC_URL)
    expect(validator.address).toMatch(/^NQ/i)
    expect(typeof validator.balance).toBe('number')
    expect(validator.rewardAddress).toMatch(/^NQ/i)

    const active = await getActiveValidators(RPC_URL)
    expect(active.length).toBeGreaterThan(0)
    expect(active[0]?.address).toMatch(/^NQ/i)

    const account = await getAccountByAddress(
      'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      RPC_URL,
    )
    expect(account).toMatchObject({
      balance: expect.any(Number),
      type: expect.any(String),
    })

    // Captured staker fixture is "not found" error envelope → client maps correctly
    await expect(
      getStakerByAddress('NQ00 0000 0000 0000 0000 0000 0000 0000 0000', RPC_URL),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error && isStakerNotFoundError(error.message),
    )

    const tx = await fetchTransaction(TX_HASH, RPC_URL)
    expect(tx).not.toBeNull()
    expect(tx).toMatchObject({
      hash: TX_HASH,
      from: expect.stringMatching(/^NQ/i),
      value: expect.any(Number),
      executionResult: true,
    })

    expect(rpc.getCallCount('getBlockNumber')).toBe(1)
    expect(rpc.getCallCount('getTransactionByHash')).toBe(1)
  })
})
