/**
 * P2-13 — Token-gated indexer / RPC / DB diagnostics.
 *
 * GET /api/diagnostics — Bearer DIAGNOSTICS_TOKEN or ?token=
 * No user addresses, session material, secrets, or full reward addresses.
 * Cursor rows use a short address fingerprint only.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { getIndexerWatermarkIso } from './freshness.js'
import { getRpcHealth, getRpcMetrics } from './nimiq-rpc.js'
import type { IndexerHealth } from './payoutIndexer.js'
import { configuredRewardAddresses } from './payoutIndexer.js'
import { publicResponseCacheStats } from './responseCache.js'

export interface DiagnosticsOptions {
  database: Database.Database
  getIndexerHealth?: () => IndexerHealth
  /** Override token (tests). Defaults to process.env.DIAGNOSTICS_TOKEN. */
  token?: string | null
}

const DIAG_TABLES = [
  'users',
  'validators',
  'transactions',
  'validator_observations',
  'staker_snapshots',
  'index_cursors',
  'staking_intents',
  'auth_challenges',
] as const

/** Short non-reversible fingerprint for operator correlation without PII. */
export function addressFingerprint(address: string): string {
  return createHash('sha256').update(address.trim().toUpperCase()).digest('hex').slice(0, 12)
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization
  if (typeof header === 'string') {
    const match = /^Bearer\s+(\S+)/i.exec(header.trim())
    if (match?.[1]) return match[1]
  }
  const queryToken = req.query.token
  if (typeof queryToken === 'string' && queryToken.length > 0) return queryToken
  if (Array.isArray(queryToken) && typeof queryToken[0] === 'string' && queryToken[0].length > 0) {
    return queryToken[0]
  }
  return null
}

function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    // Constant-time-ish reject: still compare equal-length buffers of zeros.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32))
    return false
  }
  return timingSafeEqual(a, b)
}

function tableRowCounts(database: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const table of DIAG_TABLES) {
    try {
      const row = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      counts[table] = row.n
    } catch {
      counts[table] = -1
    }
  }
  return counts
}

interface CursorSummaryRow {
  source: string
  address: string
  last_block: number
  updated_at: string
}

export function buildDiagnosticsPayload(
  database: Database.Database,
  options: {
    getIndexerHealth?: () => IndexerHealth
  } = {},
): Record<string, unknown> {
  const watermark = getIndexerWatermarkIso(database)
  const cursorRows = database.prepare(`
    SELECT source, address, last_block, updated_at
    FROM index_cursors
    ORDER BY updated_at DESC
  `).all() as CursorSummaryRow[]

  // Count configured addresses only — never list raw reward addresses.
  let configuredAddressCount = 0
  try {
    configuredAddressCount = configuredRewardAddresses(database).length
  } catch {
    configuredAddressCount = 0
  }

  const indexer = options.getIndexerHealth?.() ?? null
  const rpc = getRpcMetrics()
  const rpcHealth = getRpcHealth()
  // Average latency without exposing raw logs.
  const rpcSummary = {
    calls: rpc.calls,
    successes: rpc.successes,
    errors: rpc.errors,
    retries: rpc.retries,
    avgLatencyMs:
      rpc.successes > 0 ? Math.round(rpc.totalLatencyMs / rpc.successes) : null,
    lastCallAt: rpc.lastCallAt,
    lastErrorAt: rpc.lastErrorAt,
    // Truncate error message; never echo secrets if somehow present.
    lastErrorMessage: rpc.lastErrorMessage
      ? rpc.lastErrorMessage.slice(0, 200)
      : null,
    available: rpcHealth.available,
    degraded: rpcHealth.degraded,
    activeSource: rpcHealth.activeSource,
    activeHost: rpcHealth.activeHost,
    primaryConfigured: rpcHealth.primaryConfigured,
    fallbackConfigured: rpcHealth.fallbackConfigured,
    lastSuccessAt: rpcHealth.lastSuccessAt,
    liveReads: rpcHealth.liveReads,
    byMethod: Object.fromEntries(
      Object.entries(rpc.byMethod).map(([method, m]) => [
        method,
        {
          calls: m.calls,
          successes: m.successes,
          errors: m.errors,
          retries: m.retries,
          avgLatencyMs:
            m.successes > 0 ? Math.round(m.totalLatencyMs / m.successes) : null,
        },
      ]),
    ),
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    network: process.env.NIMIQ_NETWORK ?? 'main',
    indexer: {
      enabled: process.env.INDEXER_ENABLED === 'true',
      health: indexer,
      watermark,
      configuredAddressCount,
      cursors: {
        count: cursorRows.length,
        /** Per-address summary: fingerprint only — no full addresses or tx hashes. */
        addresses: cursorRows.map((row) => ({
          id: addressFingerprint(row.address),
          source: row.source,
          lastBlock: row.last_block,
          updatedAt: row.updated_at,
        })),
      },
    },
    rpc: rpcSummary,
    database: {
      tables: tableRowCounts(database),
    },
    responseCache: publicResponseCacheStats(),
  }
}

export function mountDiagnostics(app: Express, options: DiagnosticsOptions): void {
  const resolveToken = (): string | null => {
    if (options.token !== undefined) {
      const t = options.token?.trim()
      return t && t.length > 0 ? t : null
    }
    const env = process.env.DIAGNOSTICS_TOKEN?.trim()
    return env && env.length > 0 ? env : null
  }

  app.get('/api/diagnostics', (req: Request, res: Response) => {
    const expected = resolveToken()
    if (!expected) {
      res.status(503).json({
        error: {
          code: 'UNAVAILABLE',
          message: 'Diagnostics is not configured.',
        },
      })
      return
    }

    const provided = extractToken(req)
    if (!provided || !tokensEqual(provided, expected)) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid diagnostics token required.',
        },
      })
      return
    }

    const payload = buildDiagnosticsPayload(options.database, {
      getIndexerHealth: options.getIndexerHealth,
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json(payload)
  })
}
