/**
 * Wallet challenge/verify auth + signed httpOnly session cookies.
 * P1-02 — API.md §4, SECURITY.md §3, DATA-MODEL.md auth_challenges.
 *
 * Flow:
 * 1. POST /api/auth/challenge — store single-use challenge (5 min), return message to sign
 * 2. POST /api/auth/verify — verify Nimiq signed-message, bind pubkey→address, set cookie
 * 3. GET /api/me — read session cookie
 *
 * Non-custodial: never accepts keys/seeds. Client-supplied address is not identity
 * until the signature over the challenge message verifies and binds the public key.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import type Database from 'better-sqlite3'
import { isValidNimiqAddress, normalizeAddress } from './addresses.js'
import { publicKeyBindingResult } from './auth-wallet.js'
import { verifyHubSignedMessage } from './hub-signature.js'
import { incrementMetric, METRIC_KEYS } from './metrics.js'
import { rateLimit } from './rate-limit.js'

const COOKIE_NAME = 'steakout_session'
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

export interface AuthOptions {
  database: Database.Database
  /** Override SESSION_SECRET (tests). */
  sessionSecret?: string
  challengeTtlMs?: number
  sessionTtlMs?: number
  /** Challenge rate limit (per IP). */
  challengeRateMax?: number
  challengeRateWindowMs?: number
  /** Challenge rate limit (per address). */
  challengeAddressRateMax?: number
  challengeAddressRateWindowMs?: number
  /** Verify rate limit (per IP). */
  verifyRateMax?: number
  verifyRateWindowMs?: number
  /** Clock injection for expiry tests. */
  now?: () => number
  /**
   * Inject signature verification (unit tests). Defaults to real hub verify.
   * Return false → SIGNATURE_REJECTED; throw → treated as rejected.
   */
  verifySignature?: (message: string, publicKeyHex: string, signatureHex: string) => boolean
}

export interface SessionPayload {
  address: string
  iat: number
  exp: number
  /** Random nonce so identical (address,exp) payloads differ. */
  n: string
}

function truthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function resolveSessionSecret(override?: string): string {
  const explicit = override?.trim() || process.env.SESSION_SECRET?.trim()
  if (explicit) return explicit
  if (IS_PRODUCTION) {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production')
  }
  // Dev-only fallback so local boots work; never used in production.
  return 'steakout-dev-session-secret-not-for-production'
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromB64url(value: string): Buffer | null {
  try {
    const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad
    return Buffer.from(b64, 'base64')
  } catch {
    return null
  }
}

function signPayload(payload: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(body).digest()
  return `${body}.${b64url(sig)}`
}

function verifySignedToken(token: string, secret: string, nowMs: number): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sigB64] = parts
  if (!body || !sigB64) return null
  const expected = createHmac('sha256', secret).update(body).digest()
  const got = fromB64url(sigB64)
  if (!got || got.length !== expected.length) return null
  if (!timingSafeEqual(got, expected)) return null
  const raw = fromB64url(body)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw.toString('utf8')) as SessionPayload
    if (!payload || typeof payload !== 'object') return null
    if (typeof payload.address !== 'string' || !isValidNimiqAddress(payload.address)) return null
    if (typeof payload.exp !== 'number' || payload.exp < nowMs) return null
    if (typeof payload.iat !== 'number') return null
    return {
      address: normalizeAddress(payload.address),
      iat: payload.iat,
      exp: payload.exp,
      n: typeof payload.n === 'string' ? payload.n : '',
    }
  } catch {
    return null
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(val)
    } catch {
      out[key] = val
    }
  }
  return out
}

function cookieSecure(): boolean {
  return IS_PRODUCTION || truthy(process.env.SESSION_COOKIE_SECURE)
}

function buildSetCookie(token: string, maxAgeMs: number): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ]
  if (cookieSecure()) parts.push('Secure')
  return parts.join('; ')
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({
    error: {
      code,
      message,
      ...extra,
    },
  })
}

/** Build the exact string the client must pass to `nimiq.sign()` / Hub signMessage. */
export function buildChallengeMessage(challengeId: string, address: string): string {
  return `Steakout sign-in:${challengeId}:${normalizeAddress(address)}`
}

function upsertUser(database: Database.Database, address: string, publicKey: string, nowIso: string): void {
  database
    .prepare(
      `INSERT INTO users (address, public_key, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         public_key = excluded.public_key,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(address, publicKey, nowIso, nowIso)
}

export interface MountAuthResult {
  /** Require a valid session; sets res.locals.address + sessionExpiresAt. */
  requireAuth: (req: Request, res: Response, next: NextFunction) => void
  /** Optional session; never 401s. */
  optionalAuth: (req: Request, res: Response, next: NextFunction) => void
  readSession: (req: Request) => SessionPayload | null
  cookieName: string
}

/**
 * Mount auth routes and return middleware for protected paths.
 * Routes: POST /api/auth/challenge, POST /api/auth/verify, GET /api/me
 */
export function mountAuth(app: Express, options: AuthOptions): MountAuthResult {
  const database = options.database
  const secret = resolveSessionSecret(options.sessionSecret)
  const challengeTtlMs = options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  const now = options.now ?? (() => Date.now())
  const verifySignature = options.verifySignature ?? verifyHubSignedMessage

  const challengeRateMax = options.challengeRateMax ?? 12
  const challengeRateWindowMs = options.challengeRateWindowMs ?? 60_000
  const challengeAddressRateMax = options.challengeAddressRateMax ?? 12
  const challengeAddressRateWindowMs = options.challengeAddressRateWindowMs ?? 60_000
  const verifyRateMax = options.verifyRateMax ?? 24
  const verifyRateWindowMs = options.verifyRateWindowMs ?? 60_000

  const challengeIpLimit = rateLimit(challengeRateMax, challengeRateWindowMs, {
    scope: 'auth-challenge-ip',
  })
  const challengeAddressLimit = rateLimit(challengeAddressRateMax, challengeAddressRateWindowMs, {
    scope: 'auth-challenge-address',
    keyFn: (req) => {
      const body = req.body as { address?: unknown }
      const raw = typeof body?.address === 'string' ? body.address : ''
      return isValidNimiqAddress(raw) ? `addr:${normalizeAddress(raw)}` : `addr:invalid`
    },
  })
  const verifyIpLimit = rateLimit(verifyRateMax, verifyRateWindowMs, {
    scope: 'auth-verify-ip',
  })

  function readSession(req: Request): SessionPayload | null {
    const cookies = parseCookies(
      typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
    )
    const raw = cookies[COOKIE_NAME]
    if (!raw) return null
    return verifySignedToken(raw, secret, now())
  }

  function setSessionCookie(res: Response, address: string): SessionPayload {
    const iat = now()
    const exp = iat + sessionTtlMs
    const payload: SessionPayload = {
      address: normalizeAddress(address),
      iat,
      exp,
      n: randomBytes(8).toString('hex'),
    }
    const token = signPayload(payload, secret)
    res.append('Set-Cookie', buildSetCookie(token, sessionTtlMs))
    return payload
  }

  /** Rolling refresh when more than half the TTL has elapsed. */
  function maybeRefreshSession(res: Response, session: SessionPayload): SessionPayload {
    const remaining = session.exp - now()
    if (remaining <= sessionTtlMs / 2) {
      return setSessionCookie(res, session.address)
    }
    return session
  }

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const session = readSession(req)
    if (!session) {
      sendError(res, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.')
      return
    }
    const refreshed = maybeRefreshSession(res, session)
    res.locals.address = refreshed.address
    res.locals.sessionExpiresAt = new Date(refreshed.exp).toISOString()
    next()
  }

  function optionalAuth(req: Request, res: Response, next: NextFunction): void {
    const session = readSession(req)
    if (session) {
      const refreshed = maybeRefreshSession(res, session)
      res.locals.address = refreshed.address
      res.locals.sessionExpiresAt = new Date(refreshed.exp).toISOString()
    }
    next()
  }

  const authRouter = Router()

  authRouter.post('/challenge', challengeIpLimit, challengeAddressLimit, (req, res) => {
    const body = req.body as { address?: unknown }
    const rawAddress = typeof body?.address === 'string' ? body.address : ''
    if (!isValidNimiqAddress(rawAddress)) {
      sendError(res, 400, 'VALIDATION', 'A valid Nimiq address is required.')
      return
    }

    const address = normalizeAddress(rawAddress)
    const challengeId = randomUUID()
    const expiresAtMs = now() + challengeTtlMs
    const expiresAt = new Date(expiresAtMs).toISOString()
    const message = buildChallengeMessage(challengeId, address)
    const createdAt = new Date(now()).toISOString()

    database
      .prepare(
        `INSERT INTO auth_challenges (id, address, message, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(challengeId, address, message, createdAt, expiresAt)

    res.json({ challengeId, message, expiresAt })
  })

  authRouter.post('/verify', verifyIpLimit, (req, res) => {
    const body = req.body as {
      challengeId?: unknown
      signature?: unknown
      publicKey?: unknown
    }
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : ''
    const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
    const publicKey = typeof body.publicKey === 'string' ? body.publicKey.trim() : ''

    if (!challengeId || !signature || !publicKey) {
      sendError(res, 400, 'VALIDATION', 'challengeId, signature, and publicKey are required.')
      return
    }

    // Reject obvious key-material fields if a client ever sends them.
    const rawBody = req.body as Record<string, unknown>
    if (rawBody.privateKey != null || rawBody.seedPhrase != null || rawBody.seed != null) {
      sendError(res, 400, 'VALIDATION', 'Key material is not accepted.')
      return
    }

    const row = database
      .prepare(
        `SELECT id, address, message, expires_at AS expiresAt, used_at AS usedAt
         FROM auth_challenges WHERE id = ?`,
      )
      .get(challengeId) as
      | { id: string; address: string; message: string; expiresAt: string; usedAt: string | null }
      | undefined

    if (!row) {
      sendError(res, 401, 'CHALLENGE_EXPIRED', 'Challenge not found or already consumed.')
      return
    }
    if (row.usedAt) {
      sendError(res, 401, 'CHALLENGE_EXPIRED', 'Challenge has already been used.')
      return
    }
    const expiresMs = Date.parse(row.expiresAt)
    if (!Number.isFinite(expiresMs) || expiresMs < now()) {
      sendError(res, 401, 'CHALLENGE_EXPIRED', 'Challenge has expired.')
      return
    }

    let valid = false
    try {
      valid = verifySignature(row.message, publicKey, signature)
    } catch {
      valid = false
    }
    if (!valid) {
      sendError(res, 401, 'SIGNATURE_REJECTED', 'Signature verification failed.')
      return
    }

    const binding = publicKeyBindingResult(publicKey, row.address)
    if (binding !== 'match') {
      // Pubkey does not own the challenged address — never authenticate on client address alone.
      sendError(res, 401, 'SIGNATURE_REJECTED', 'Public key does not match the challenged address.')
      return
    }

    const usedAt = new Date(now()).toISOString()
    const mark = database
      .prepare(
        `UPDATE auth_challenges SET used_at = ?
         WHERE id = ? AND used_at IS NULL AND expires_at >= ?`,
      )
      .run(usedAt, challengeId, usedAt)
    if (mark.changes !== 1) {
      sendError(res, 401, 'CHALLENGE_EXPIRED', 'Challenge has already been used or expired.')
      return
    }

    const address = normalizeAddress(row.address)
    // P3-04: aggregate auth counters (no addresses stored in metrics).
    const existingUser = database
      .prepare(`SELECT 1 AS ok FROM users WHERE address = ?`)
      .get(address) as { ok: number } | undefined
    upsertUser(database, address, publicKey, usedAt)
    try {
      incrementMetric(database, METRIC_KEYS.authConnects)
      if (existingUser) {
        incrementMetric(database, METRIC_KEYS.repeatSessions)
      }
    } catch {
      // Metrics must never break auth.
    }
    const session = setSessionCookie(res, address)
    res.json({
      address,
      sessionExpiresAt: new Date(session.exp).toISOString(),
    })
  })

  app.use('/api/auth', authRouter)

  app.get('/api/me', (req: Request, res: Response) => {
    const session = readSession(req)
    if (!session) {
      sendError(res, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.')
      return
    }
    const refreshed = maybeRefreshSession(res, session)
    res.json({
      address: refreshed.address,
      sessionExpiresAt: new Date(refreshed.exp).toISOString(),
    })
  })

  // Guard future authenticated route trees (P1-05, P1-06, …).
  // `/api/me` itself is handled above; this covers `/api/me/*` subpaths.
  app.use('/api/me/', requireAuth)
  app.use('/api/staking', requireAuth)

  return {
    requireAuth,
    optionalAuth,
    readSession,
    cookieName: COOKIE_NAME,
  }
}

/** Test helper: mint a signed session cookie value without going through verify. */
export function mintSessionCookie(
  address: string,
  options: { sessionSecret?: string; sessionTtlMs?: number; now?: () => number } = {},
): { cookieHeader: string; expiresAt: string } {
  const secret = resolveSessionSecret(options.sessionSecret)
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  const nowMs = (options.now ?? (() => Date.now()))()
  const payload: SessionPayload = {
    address: normalizeAddress(address),
    iat: nowMs,
    exp: nowMs + sessionTtlMs,
    n: randomBytes(8).toString('hex'),
  }
  const token = signPayload(payload, secret)
  return {
    cookieHeader: `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    expiresAt: new Date(payload.exp).toISOString(),
  }
}

export { COOKIE_NAME, DEFAULT_CHALLENGE_TTL_MS, DEFAULT_SESSION_TTL_MS }
