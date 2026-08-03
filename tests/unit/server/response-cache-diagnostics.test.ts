/**
 * P2-13 — public response cache hit/miss + token-gated diagnostics.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { openDatabase } from '../../../server/src/db.js'
import {
  addressFingerprint,
  buildDiagnosticsPayload,
} from '../../../server/src/diagnostics.js'
import {
  buildPublicCacheKey,
  clearPublicResponseCache,
  getCachedPublicResponse,
  publicResponseCacheStats,
  setCachedPublicResponse,
} from '../../../server/src/responseCache.js'
import { clearRateLimitBuckets } from '../../../server/src/rate-limit.js'

const VALIDATOR = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0099'

interface TestHttp {
  directory: string
  database: ReturnType<typeof openDatabase>
  baseUrl: string
  server: Server
}

function insertValidator(database: ReturnType<typeof openDatabase>): void {
  database.prepare(`
    INSERT INTO validators (
      address, name, reward_address, is_listed,
      payout_schedule_declared, schedule_every_hours,
      stake_luna, dominance_ratio, registry_updated_at
    ) VALUES (?, ?, ?, 1, 'Every 12 hours', 12, 1000, 0.01, ?)
  `).run(VALIDATOR, 'Cache Test Validator', REWARD, '2026-08-01T00:00:00.000Z')
}

async function startApp(options: {
  diagnosticsToken?: string | null
} = {}): Promise<TestHttp> {
  clearRateLimitBuckets()
  clearPublicResponseCache()
  const directory = mkdtempSync(join(tmpdir(), 'steakout-p213-'))
  const database = openDatabase(join(directory, 'test.sqlite'))
  insertValidator(database)
  const app = createApp({
    database,
    getIndexerHealth: () => ({
      lastRunAt: '2026-08-03T12:00:00.000Z',
      addressesIndexed: 1,
      lagBlocks: 12,
      cycleCount: 3,
      lastCycle: {
        addressCount: 1,
        fetched: 10,
        inserted: 2,
        errorCount: 0,
        durationMs: 450,
      },
    }),
    diagnosticsToken:
      options.diagnosticsToken === undefined ? 'test-diag-token' : options.diagnosticsToken,
  })
  const server = createServer(app)
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP address')
  return {
    directory,
    database,
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  }
}

async function closeApp(ctx: TestHttp): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    ctx.server.close((error) => (error ? reject(error) : resolveClose()))
  })
  ctx.database.close()
  rmSync(ctx.directory, { recursive: true, force: true })
  clearPublicResponseCache()
  clearRateLimitBuckets()
}

describe('responseCache unit', () => {
  afterEach(() => {
    clearPublicResponseCache()
  })

  it('hits within TTL and misses after expiry', () => {
    const key = buildPublicCacheKey('/api/validators/x', { sort: 'stake' }, 'wm-1')
    setCachedPublicResponse(key, { ok: true }, { nowMs: 1_000, ttlMs: 100 })
    expect(getCachedPublicResponse(key, 1_050)).toEqual({ body: { ok: true }, status: 200 })
    expect(getCachedPublicResponse(key, 1_200)).toBeNull()
    const stats = publicResponseCacheStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it('different watermarks are distinct keys (invalidation on advance)', () => {
    const a = buildPublicCacheKey('/api/validators', { listed: 'false' }, 'wm-old')
    const b = buildPublicCacheKey('/api/validators', { listed: 'false' }, 'wm-new')
    expect(a).not.toBe(b)
    setCachedPublicResponse(a, { v: 1 })
    expect(getCachedPublicResponse(b)).toBeNull()
    expect(getCachedPublicResponse(a)?.body).toEqual({ v: 1 })
  })
})

describe('public validators cache (HTTP)', () => {
  afterEach(async () => {
    // closed per-test
  })

  it('repeated profile requests hit cache within TTL', async () => {
    const ctx = await startApp()
    try {
      const path = `/api/validators/${encodeURIComponent(VALIDATOR)}`
      const first = await fetch(`${ctx.baseUrl}${path}`)
      expect(first.status).toBe(200)
      expect(first.headers.get('x-cache')).toBe('MISS')
      const body1 = await first.json() as { data: { address: string } }
      expect(body1.data.address).toBeTruthy()

      const second = await fetch(`${ctx.baseUrl}${path}`)
      expect(second.status).toBe(200)
      expect(second.headers.get('x-cache')).toBe('HIT')
      const body2 = await second.json() as { data: { address: string } }
      expect(body2).toEqual(body1)

      const stats = publicResponseCacheStats()
      expect(stats.hits).toBeGreaterThanOrEqual(1)
      expect(stats.misses).toBeGreaterThanOrEqual(1)
    } finally {
      await closeApp(ctx)
    }
  })

  it('watermark advance causes cache miss', async () => {
    const ctx = await startApp()
    try {
      const path = `/api/validators/${encodeURIComponent(VALIDATOR)}`
      const first = await fetch(`${ctx.baseUrl}${path}`)
      expect(first.headers.get('x-cache')).toBe('MISS')
      await first.json()

      // Simulate indexer advancing the watermark (new cursor updated_at).
      ctx.database.prepare(`
        INSERT INTO index_cursors (source, address, last_block, last_tx_hash, updated_at)
        VALUES ('rpc:test', ?, 100, NULL, ?)
      `).run(REWARD, new Date().toISOString())

      const after = await fetch(`${ctx.baseUrl}${path}`)
      expect(after.status).toBe(200)
      expect(after.headers.get('x-cache')).toBe('MISS')
    } finally {
      await closeApp(ctx)
    }
  })

  it('observations endpoint caches hits', async () => {
    const ctx = await startApp()
    try {
      const path = `/api/validators/${encodeURIComponent(VALIDATOR)}/observations`
      const first = await fetch(`${ctx.baseUrl}${path}`)
      expect(first.status).toBe(200)
      expect(first.headers.get('x-cache')).toBe('MISS')
      await first.json()

      const second = await fetch(`${ctx.baseUrl}${path}`)
      expect(second.status).toBe(200)
      expect(second.headers.get('x-cache')).toBe('HIT')
    } finally {
      await closeApp(ctx)
    }
  })
})

describe('GET /api/diagnostics', () => {
  it('returns 401 without token', async () => {
    const ctx = await startApp({ diagnosticsToken: 'secret-token' })
    try {
      const res = await fetch(`${ctx.baseUrl}/api/diagnostics`)
      expect(res.status).toBe(401)
      const body = await res.json() as { error: { code: string } }
      expect(body.error.code).toBe('UNAUTHORIZED')
    } finally {
      await closeApp(ctx)
    }
  })

  it('returns 401 with wrong token', async () => {
    const ctx = await startApp({ diagnosticsToken: 'secret-token' })
    try {
      const res = await fetch(`${ctx.baseUrl}/api/diagnostics`, {
        headers: { Authorization: 'Bearer wrong' },
      })
      expect(res.status).toBe(401)
    } finally {
      await closeApp(ctx)
    }
  })

  it('returns 503 when diagnostics token is not configured', async () => {
    const ctx = await startApp({ diagnosticsToken: null })
    try {
      const res = await fetch(`${ctx.baseUrl}/api/diagnostics?token=anything`)
      expect(res.status).toBe(503)
      const body = await res.json() as { error: { code: string } }
      expect(body.error.code).toBe('UNAVAILABLE')
    } finally {
      await closeApp(ctx)
    }
  })

  it('returns payload with Bearer token and no raw addresses/secrets', async () => {
    const ctx = await startApp({ diagnosticsToken: 'secret-token' })
    try {
      ctx.database.prepare(`
        INSERT INTO index_cursors (source, address, last_block, last_tx_hash, updated_at)
        VALUES ('rpc:test', ?, 42, 'abcd', '2026-08-03T10:00:00.000Z')
      `).run(REWARD)

      const res = await fetch(`${ctx.baseUrl}/api/diagnostics`, {
        headers: { Authorization: 'Bearer secret-token' },
      })
      expect(res.status).toBe(200)
      const body = await res.json() as {
        ok: boolean
        indexer: {
          health: { cycleCount: number; lastCycle: { durationMs: number } }
          configuredAddressCount: number
          cursors: { count: number; addresses: Array<{ id: string; lastBlock: number }> }
        }
        rpc: { calls: number }
        database: { tables: Record<string, number> }
        responseCache: { hits: number }
      }

      expect(body.ok).toBe(true)
      expect(body.indexer.health.cycleCount).toBe(3)
      expect(body.indexer.health.lastCycle.durationMs).toBe(450)
      expect(body.indexer.cursors.count).toBe(1)
      expect(body.indexer.cursors.addresses[0].id).toBe(addressFingerprint(REWARD))
      expect(body.indexer.cursors.addresses[0].lastBlock).toBe(42)
      expect(body.database.tables.validators).toBe(1)
      expect(body.rpc).toBeDefined()
      expect(body.responseCache).toBeDefined()

      const serialized = JSON.stringify(body)
      // No raw reward/user addresses, no token/secret leakage.
      expect(serialized).not.toContain(REWARD)
      expect(serialized).not.toContain(VALIDATOR)
      expect(serialized).not.toContain('secret-token')
      expect(serialized).not.toMatch(/SESSION_SECRET|privateKey|seedPhrase/i)
    } finally {
      await closeApp(ctx)
    }
  })

  it('accepts ?token= query param', async () => {
    const ctx = await startApp({ diagnosticsToken: 'query-token' })
    try {
      const res = await fetch(`${ctx.baseUrl}/api/diagnostics?token=query-token`)
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(true)
    } finally {
      await closeApp(ctx)
    }
  })

  it('buildDiagnosticsPayload fingerprints cursors without addresses', () => {
    const directory = mkdtempSync(join(tmpdir(), 'steakout-diag-'))
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      insertValidator(database)
      database.prepare(`
        INSERT INTO index_cursors (source, address, last_block, last_tx_hash, updated_at)
        VALUES ('rpc:test', ?, 7, NULL, '2026-08-03T11:00:00.000Z')
      `).run(REWARD)

      const payload = buildDiagnosticsPayload(database)
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain(REWARD)
      const cursors = (payload.indexer as { cursors: { addresses: Array<{ id: string }> } }).cursors
      expect(cursors.addresses).toHaveLength(1)
      expect(cursors.addresses[0].id).toBe(addressFingerprint(REWARD))
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
