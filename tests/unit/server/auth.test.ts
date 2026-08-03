/**
 * P1-02 auth: challenge → verify → session → /api/me
 * Real Nimiq signed-message crypto via @nimiq/core (deterministic zero key).
 * P0-02 wallet fixture directory is not present — gap noted in task Notes.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BufferUtils, Hash, KeyPair, PrivateKey } from '@nimiq/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import {
  buildChallengeMessage,
  COOKIE_NAME,
  mintSessionCookie,
} from '../../../server/src/auth.js'
import { addressFromPublicKeyHex, publicKeyBindingResult } from '../../../server/src/auth-wallet.js'
import { openDatabase } from '../../../server/src/db.js'
import { verifyHubSignedMessage } from '../../../server/src/hub-signature.js'
import { clearRateLimitBuckets } from '../../../server/src/rate-limit.js'
import { normalizeAddress } from '../../../server/src/addresses.js'

/** Deterministic test wallet (private key all zeros). Not a real user key. */
const FIXTURE_PRIVATE_KEY_HEX = '00'.repeat(32)
const MSG_PREFIX = '\x16Nimiq Signed Message:\n'
const TEST_SESSION_SECRET = 'steakout-p1-02-test-session-secret'

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

interface TestContext {
  directory: string
  database: ReturnType<typeof openDatabase>
  baseUrl: string
  server: Server
  clock: { now: number }
  fixture: ReturnType<typeof deriveFixtureWallet>
}

async function startTestApp(
  authOverrides: Record<string, unknown> = {},
): Promise<TestContext> {
  clearRateLimitBuckets()
  const directory = mkdtempSync(join(tmpdir(), 'steakout-auth-'))
  const database = openDatabase(join(directory, 'test.sqlite'))
  const clock = { now: Date.now() }
  const fixture = deriveFixtureWallet()
  const app = createApp({
    database,
    auth: {
      sessionSecret: TEST_SESSION_SECRET,
      now: () => clock.now,
      ...authOverrides,
    },
  })
  const server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP address')
  return {
    directory,
    database,
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    clock,
    fixture,
  }
}

async function stopTestApp(ctx: TestContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ctx.server.close((error) => (error ? reject(error) : resolve()))
  })
  ctx.database.close()
  rmSync(ctx.directory, { recursive: true, force: true })
  clearRateLimitBuckets()
}

describe('hub-signature + auth-wallet', () => {
  it('verifies a real Hub-style signed message', () => {
    const { publicKeyHex, address } = deriveFixtureWallet()
    const message = buildChallengeMessage('test-challenge-id', address)
    const { publicKey, signature } = signChallengeMessage(message)
    expect(publicKey).toBe(publicKeyHex)
    expect(verifyHubSignedMessage(message, publicKey, signature)).toBe(true)
    expect(verifyHubSignedMessage(message + 'x', publicKey, signature)).toBe(false)
  })

  it('binds public key to derived address', () => {
    const { publicKeyHex, address } = deriveFixtureWallet()
    expect(addressFromPublicKeyHex(publicKeyHex)).toBe(address)
    expect(publicKeyBindingResult(publicKeyHex, address)).toBe('match')
    expect(publicKeyBindingResult(publicKeyHex, 'NQ00AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('mismatch')
    expect(publicKeyBindingResult('not-a-key', address)).toBe('invalid')
  })
})

describe('auth HTTP flow', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await startTestApp()
  })

  afterEach(async () => {
    await stopTestApp(ctx)
  })

  it('challenge → verify → session cookie → /api/me', async () => {
    const challengeRes = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ctx.fixture.address }),
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
      buildChallengeMessage(challenge.challengeId, ctx.fixture.address),
    )
    expect(Date.parse(challenge.expiresAt)).toBeGreaterThan(ctx.clock.now)

    const signed = signChallengeMessage(challenge.message)
    const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
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
    expect(verified.address).toBe(ctx.fixture.address)
    expect(Date.parse(verified.sessionExpiresAt)).toBeGreaterThan(ctx.clock.now)

    const setCookie = verifyRes.headers.getSetCookie?.() ?? []
    const cookieHeader =
      extractSessionCookie(setCookie.length ? setCookie : verifyRes.headers.get('set-cookie'))
    expect(cookieHeader).toBeTruthy()
    expect(setCookie.join(';') || verifyRes.headers.get('set-cookie') || '').toMatch(/HttpOnly/i)
    expect(setCookie.join(';') || verifyRes.headers.get('set-cookie') || '').toMatch(/SameSite=Lax/i)

    const meRes = await fetch(`${ctx.baseUrl}/api/me`, {
      headers: { cookie: cookieHeader! },
    })
    expect(meRes.status).toBe(200)
    const me = (await meRes.json()) as { address: string; sessionExpiresAt: string }
    expect(me.address).toBe(ctx.fixture.address)
    expect(me.sessionExpiresAt).toBe(verified.sessionExpiresAt)

    const user = ctx.database
      .prepare('SELECT address, public_key FROM users WHERE address = ?')
      .get(ctx.fixture.address) as { address: string; public_key: string }
    expect(user.public_key).toBe(signed.publicKey)
  })

  it('rejects reused challenges with CHALLENGE_EXPIRED', async () => {
    const challengeRes = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ctx.fixture.address }),
    })
    const challenge = (await challengeRes.json()) as { challengeId: string; message: string }
    const signed = signChallengeMessage(challenge.message)

    const first = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: signed.signature,
        publicKey: signed.publicKey,
      }),
    })
    expect(first.status).toBe(200)

    const second = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: signed.signature,
        publicKey: signed.publicKey,
      }),
    })
    expect(second.status).toBe(401)
    const body = (await second.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CHALLENGE_EXPIRED')
  })

  it('rejects expired challenges with CHALLENGE_EXPIRED', async () => {
    const challengeRes = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ctx.fixture.address }),
    })
    const challenge = (await challengeRes.json()) as { challengeId: string; message: string }
    const signed = signChallengeMessage(challenge.message)

    // Advance past 5-minute default TTL.
    ctx.clock.now += 6 * 60 * 1000

    const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: signed.signature,
        publicKey: signed.publicKey,
      }),
    })
    expect(verifyRes.status).toBe(401)
    const body = (await verifyRes.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CHALLENGE_EXPIRED')
  })

  it('rejects tampered signatures with SIGNATURE_REJECTED', async () => {
    const challengeRes = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ctx.fixture.address }),
    })
    const challenge = (await challengeRes.json()) as { challengeId: string; message: string }
    const signed = signChallengeMessage(challenge.message)
    const tampered = signed.signature.replace(/0/g, '1').replace(/1/g, '0')

    const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature: tampered,
        publicKey: signed.publicKey,
      }),
    })
    expect(verifyRes.status).toBe(401)
    const body = (await verifyRes.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SIGNATURE_REJECTED')
  })

  it('never authenticates a client-supplied address without valid key binding', async () => {
    // Challenge fixture address, but present a different keypair's signature material
    // (verification may fail or binding fails — either way no session).
    const other = KeyPair.generate()
    const challengeRes = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ctx.fixture.address }),
    })
    const challenge = (await challengeRes.json()) as { challengeId: string; message: string }
    // Sign with the *correct* message using the *other* key — crypto ok, binding fails.
    const data = MSG_PREFIX + challenge.message.length + challenge.message
    const hash = Hash.computeSha256(BufferUtils.fromUtf8(data))
    const signature = other.sign(hash).toHex()

    const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signature,
        publicKey: other.publicKey.toHex(),
      }),
    })
    expect(verifyRes.status).toBe(401)
    const body = (await verifyRes.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SIGNATURE_REJECTED')
    expect(verifyRes.headers.get('set-cookie')).toBeNull()

    const meRes = await fetch(`${ctx.baseUrl}/api/me`)
    expect(meRes.status).toBe(401)
    const meBody = (await meRes.json()) as { error: { code: string } }
    expect(meBody.error.code).toBe('WALLET_NOT_CONNECTED')
  })

  it('returns WALLET_NOT_CONNECTED without a session cookie', async () => {
    const meRes = await fetch(`${ctx.baseUrl}/api/me`)
    expect(meRes.status).toBe(401)
    const body = (await meRes.json()) as { error: { code: string } }
    expect(body.error.code).toBe('WALLET_NOT_CONNECTED')
  })

  it('accepts a minted session cookie on /api/me', async () => {
    const { cookieHeader, expiresAt } = mintSessionCookie(ctx.fixture.address, {
      sessionSecret: TEST_SESSION_SECRET,
      now: () => ctx.clock.now,
    })
    const meRes = await fetch(`${ctx.baseUrl}/api/me`, {
      headers: { cookie: cookieHeader },
    })
    expect(meRes.status).toBe(200)
    const me = (await meRes.json()) as { address: string; sessionExpiresAt: string }
    expect(me.address).toBe(ctx.fixture.address)
    expect(me.sessionExpiresAt).toBe(expiresAt)
  })

  it('sets security headers on API responses', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    // helmet default; exact set may vary by version
    expect(res.headers.get('x-powered-by')).toBeNull()
  })

  it('guards /api/staking/* with WALLET_NOT_CONNECTED', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/staking/intent`, { method: 'POST' })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('WALLET_NOT_CONNECTED')
  })
})

describe('auth rate limits', () => {
  it('returns 429 RATE_LIMITED with retryAfterSeconds after threshold', async () => {
    const ctx = await startTestApp({
      challengeRateMax: 2,
      challengeRateWindowMs: 60_000,
      challengeAddressRateMax: 100,
      challengeAddressRateWindowMs: 60_000,
    })
    try {
      for (let i = 0; i < 2; i++) {
        const ok = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: ctx.fixture.address }),
        })
        expect(ok.status).toBe(200)
      }
      const limited = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: ctx.fixture.address }),
      })
      expect(limited.status).toBe(429)
      const body = (await limited.json()) as {
        error: { code: string; retryAfterSeconds: number }
      }
      expect(body.error.code).toBe('RATE_LIMITED')
      expect(body.error.retryAfterSeconds).toBeGreaterThan(0)
      expect(limited.headers.get('retry-after')).toBeTruthy()
    } finally {
      await stopTestApp(ctx)
    }
  })
})

describe('auth with mocked verify', () => {
  it('supports injected verifySignature for unit paths without live signing', async () => {
    const { publicKeyHex, address } = deriveFixtureWallet()
    const ctx = await startTestApp({
      verifySignature: (message: string, publicKey: string, _signature: string) => {
        return message.includes(address) && publicKey === publicKeyHex
      },
    })
    try {
      const challengeRes = await fetch(`${ctx.baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      const challenge = (await challengeRes.json()) as { challengeId: string; message: string }

      const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          signature: '00'.repeat(64),
          publicKey: publicKeyHex,
        }),
      })
      expect(verifyRes.status).toBe(200)
      const verified = (await verifyRes.json()) as { address: string }
      expect(verified.address).toBe(address)
    } finally {
      await stopTestApp(ctx)
    }
  })
})
