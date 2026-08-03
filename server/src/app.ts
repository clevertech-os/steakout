import cors from 'cors'
import express from 'express'
import type Database from 'better-sqlite3'
import {
  handlePersonalActivity,
  mountNetworkActivityApi,
} from './activity.js'
import { mountAuth, type AuthOptions } from './auth.js'
import { mountDiagnostics } from './diagnostics.js'
import { applySecurityHeaders } from './http-headers.js'
import { getBlockNumber, getRpcHealth, getRpcMetrics, toRpcApiError } from './nimiq-rpc.js'
import type { IndexerHealth } from './payoutIndexer.js'
import { mountObservationsApi } from './observationsApi.js'
import {
  ContinuityReadError,
  readPersonalContinuity,
} from './personalContinuity.js'
import { rateLimit } from './rate-limit.js'
import {
  PositionReadError,
  positionCacheControlHeader,
  readStakingPosition,
} from './stakingState.js'
import { mountValidatorsApi } from './validatorSync.js'

export interface AppOptions {
  database: Database.Database
  getIndexerHealth?: () => IndexerHealth
  /** Auth overrides (tests). Merged with `{ database }`. */
  auth?: Omit<AuthOptions, 'database'>
  /** Diagnostics token override (tests). Defaults to DIAGNOSTICS_TOKEN env. */
  diagnosticsToken?: string | null
}

/**
 * Rate-limit layers (P1-02 / P2-13, SECURITY.md §4):
 * - Global `/api`: 300 req / 60s per IP (moderate).
 * - Auth challenge: 12 / 60s per IP + 12 / 60s per address (strict).
 * - Auth verify: 24 / 60s per IP (strict).
 * - Staking tree `/api/staking`: 60 / 60s per IP (strict; intent/confirm land later).
 * Auth + staking limits stack on top of the global bucket.
 */
export function createApp(options: AppOptions) {
  const app = express()
  const configuredOrigins = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim())

  applySecurityHeaders(app)
  app.use(
    cors({
      credentials: true,
      origin: configuredOrigins?.length ? configuredOrigins : true,
    }),
  )
  app.use(express.json({ limit: '32kb' }))

  // Moderate global API limit (auth endpoints apply stricter limits themselves).
  app.use('/api', rateLimit(300, 60_000, { scope: 'api-global' }))
  // Stricter ceiling for staking mutations once P1-06 / P2-11 mount under /api/staking.
  app.use('/api/staking', rateLimit(60, 60_000, { scope: 'staking' }))

  mountAuth(app, {
    database: options.database,
    ...options.auth,
  })

  // P1-04 — public registry list/detail (no auth). Observation fields from P2-03 when present.
  mountValidatorsApi(app, options.database)

  // P2-06 — observations evidence, network summary, explorer redirect (no auth).
  mountObservationsApi(app, options.database)

  // P2-10 — public network activity feed (recent payout runs).
  mountNetworkActivityApi(app, options.database)

  // P2-13 — token-gated operator diagnostics (excluded from public API docs).
  mountDiagnostics(app, {
    database: options.database,
    getIndexerHealth: options.getIndexerHealth,
    token: options.diagnosticsToken,
  })

  // P1-05 — authenticated position (requireAuth already applied to /api/me/*).
  app.get('/api/me/staking-position', async (request, response) => {
    const address = response.locals.address as string | undefined
    if (!address) {
      response.status(401).json({
        error: {
          code: 'WALLET_NOT_CONNECTED',
          message: 'No valid wallet session.',
        },
      })
      return
    }
    try {
      const envelope = await readStakingPosition({
        database: options.database,
        address,
      })
      response.setHeader('Cache-Control', positionCacheControlHeader())
      response.json(envelope)
    } catch (error) {
      if (error instanceof PositionReadError) {
        response.status(error.httpStatus).json({
          error: { code: error.code, message: error.message },
        })
        return
      }
      const apiError = toRpcApiError(error)
      response.status(apiError.httpStatus).json({ error: apiError })
    }
  })

  // P2-05 — personal continuity (direct-payout windows + restake growth pointer).
  app.get('/api/me/observations', async (_request, response) => {
    const address = response.locals.address as string | undefined
    if (!address) {
      response.status(401).json({
        error: {
          code: 'WALLET_NOT_CONNECTED',
          message: 'No valid wallet session.',
        },
      })
      return
    }
    try {
      const envelope = await readPersonalContinuity({
        database: options.database,
        address,
      })
      // Short private cache; continuity is user-specific and indexer-backed.
      response.setHeader('Cache-Control', 'private, max-age=15')
      response.json(envelope)
    } catch (error) {
      if (error instanceof ContinuityReadError) {
        response.status(error.httpStatus).json({
          error: { code: error.code, message: error.message },
        })
        return
      }
      const apiError = toRpcApiError(error)
      response.status(apiError.httpStatus).json({ error: apiError })
    }
  })

  // P2-10 — personal activity timeline (direct payouts, snapshot growth, intents).
  app.get('/api/me/activity', (request, response) => {
    handlePersonalActivity(options.database, request, response)
  })

  app.get('/api/health', async (_request, response) => {
    const indexer = options.getIndexerHealth?.()
    const network = process.env.NIMIQ_NETWORK ?? 'main'
    // Do not block liveness on full RPC retry/backoff (can take minutes under rate limit).
    // Prefer a short race so Railway healthchecks and operators always get a fast response.
    let blockNumber: number | null = null
    try {
      blockNumber = await Promise.race([
        getBlockNumber(),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 2_500)
        }),
      ])
    } catch {
      // Health stays 200; RPC unavailability is reflected via null block + rpc health.
    }
    const rpcHealth = getRpcHealth()
    // process up ≠ chain up. mode is ok only when live RPC succeeds on primary.
    const mode: 'ok' | 'degraded' =
      rpcHealth.available && !rpcHealth.degraded ? 'ok' : 'degraded'
    response.json({
      ok: true,
      network,
      blockNumber,
      mode,
      features: {
        // Position / confirm / block probe require live RPC (503 when down).
        liveChainReads: rpcHealth.liveReads,
        // Public validators list/detail/observations serve SQLite regardless.
        registryReads: true,
      },
      indexer: indexer ?? null,
      rpc: {
        ...getRpcMetrics(),
        available: rpcHealth.available,
        degraded: rpcHealth.degraded,
        activeSource: rpcHealth.activeSource,
        activeHost: rpcHealth.activeHost,
        primaryConfigured: rpcHealth.primaryConfigured,
        fallbackConfigured: rpcHealth.fallbackConfigured,
        lastSuccessAt: rpcHealth.lastSuccessAt,
        liveReads: rpcHealth.liveReads,
      },
    })
  })

  app.get('/api/spike/block-number', async (_request, response) => {
    try {
      const blockNumber = await getBlockNumber()

      response.json({
        updatedAt: new Date().toISOString(),
        source: 'rpc',
        status: 'ok',
        dataFreshness: { ageSeconds: 0 },
        data: { blockNumber },
      })
    } catch (error) {
      const apiError = toRpcApiError(error)
      response.status(503).json({ error: apiError })
    }
  })

  return app
}
