/**
 * P3-04 — Aggregate telemetry: metrics table, counters, public endpoint, no addresses.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { openDatabase } from '../../../server/src/db.js'
import {
  buildPublicMetrics,
  computeIndexerHistoryDepthDays,
  getMetric,
  incrementMetric,
  METRIC_KEYS,
  publicMetricsContainsAddresses,
} from '../../../server/src/metrics.js'
import { clearPublicResponseCache } from '../../../server/src/responseCache.js'

const TEST_SESSION_SECRET = 'steakout-p3-04-metrics-secret'
const FIXTURE_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

interface TestContext {
  directory: string
  database: ReturnType<typeof openDatabase>
  baseUrl: string
  server: Server
}

async function startApp(): Promise<TestContext> {
  clearPublicResponseCache()
  const directory = mkdtempSync(join(tmpdir(), 'steakout-metrics-'))
  const database = openDatabase(join(directory, 'test.sqlite'))
  const app = createApp({
    database,
    auth: { sessionSecret: TEST_SESSION_SECRET },
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
  }
}

async function stopApp(ctx: TestContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ctx.server.close((err) => (err ? reject(err) : resolve()))
  })
  ctx.database.close()
  rmSync(ctx.directory, { recursive: true, force: true })
}

function seedValidator(database: ReturnType<typeof openDatabase>, address = FIXTURE_ADDRESS) {
  database
    .prepare(
      `INSERT INTO validators (
         address, name, is_listed, official_score, stake_luna, registry_updated_at
       ) VALUES (?, ?, 1, 90, 1000, ?)`,
    )
    .run(address, 'Test Pool', new Date().toISOString())
}

describe('metrics counters + buildPublicMetrics', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-metrics-unit-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates metrics table and increments counters', () => {
    expect(getMetric(database, METRIC_KEYS.authConnects)).toBe(0)
    incrementMetric(database, METRIC_KEYS.authConnects)
    incrementMetric(database, METRIC_KEYS.authConnects, 2)
    expect(getMetric(database, METRIC_KEYS.authConnects)).toBe(3)
  })

  it('builds aggregates with zeros and disclosure; never addresses', () => {
    const payload = buildPublicMetrics(database, { nowMs: Date.parse('2026-08-03T12:00:00.000Z') })
    expect(payload.disclosure).toMatch(/aggregate/i)
    expect(payload.metrics.distinctConnectedWallets).toBe(0)
    expect(payload.metrics.authConnects).toBe(0)
    expect(payload.metrics.repeatSessions).toBe(0)
    expect(payload.metrics.validatorProfileViews).toBe(0)
    expect(payload.metrics.publicProfileShares).toBe(0)
    expect(payload.metrics.stakingIntents).toBe(0)
    expect(payload.metrics.stakingConfirmed).toBe(0)
    expect(payload.metrics.indexerHistoryDepthDays).toBe(0)
    expect(publicMetricsContainsAddresses(payload)).toBe(false)
    // Shape: only SPEC-aligned keys
    expect(Object.keys(payload.metrics).sort()).toEqual(
      [
        'authConnects',
        'distinctConnectedWallets',
        'indexerHistoryDepthDays',
        'publicProfileShares',
        'repeatSessions',
        'stakingConfirmed',
        'stakingIntents',
        'validatorProfileViews',
      ].sort(),
    )
  })

  it('counts distinct users and staking intent rows without exposing addresses', () => {
    database
      .prepare(
        `INSERT INTO users (address, public_key, created_at, last_seen_at)
         VALUES (?, 'pk', datetime('now'), datetime('now'))`,
      )
      .run('NQ07 1111 1111 1111 1111 1111 1111 1111 1111')
    database
      .prepare(
        `INSERT INTO users (address, public_key, created_at, last_seen_at)
         VALUES (?, 'pk', datetime('now'), datetime('now'))`,
      )
      .run('NQ07 2222 2222 2222 2222 2222 2222 2222 2222')
    database
      .prepare(
        `INSERT INTO staking_intents (
           id, user_address, operation, params_json, status, expires_at
         ) VALUES ('i1', 'NQ07 1111 1111 1111 1111 1111 1111 1111 1111', 'stake', '{}', 'pending', datetime('now')),
                  ('i2', 'NQ07 2222 2222 2222 2222 2222 2222 2222 2222', 'stake', '{}', 'confirmed', datetime('now'))`,
      )
      .run()

    const payload = buildPublicMetrics(database)
    expect(payload.metrics.distinctConnectedWallets).toBe(2)
    expect(payload.metrics.stakingIntents).toBe(2)
    expect(payload.metrics.stakingConfirmed).toBe(1)
    expect(publicMetricsContainsAddresses(payload)).toBe(false)
    expect(JSON.stringify(payload)).not.toContain('NQ07 1111')
    expect(JSON.stringify(payload)).not.toContain('NQ07 2222')
  })

  it('computes indexer history depth from earliest transaction', () => {
    const nowMs = Date.parse('2026-08-03T00:00:00.000Z')
    const tenDaysAgo = new Date(nowMs - 10 * 86_400_000).toISOString()
    database
      .prepare(
        `INSERT INTO transactions (
           hash, from_address, to_address, value_luna, fee_luna,
           block_number, timestamp, execution_result, raw_json
         ) VALUES ('h1', 'NQ07 A', 'NQ07 B', 1, 0, 1, ?, 'ok', '{}')`,
      )
      .run(tenDaysAgo)
    expect(computeIndexerHistoryDepthDays(database, nowMs)).toBe(10)
    expect(buildPublicMetrics(database, { nowMs }).metrics.indexerHistoryDepthDays).toBe(10)
  })
})

describe('GET /api/metrics/public + profile view counter', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await startApp()
  })

  afterEach(async () => {
    await stopApp(ctx)
  })

  it('returns public aggregates with disclosure and no addresses', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/metrics/public`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ReturnType<typeof buildPublicMetrics>
    expect(body.disclosure).toMatch(/aggregate counts only/i)
    expect(body.metrics).toBeDefined()
    expect(publicMetricsContainsAddresses(body)).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/\bNQ\d{2}\s/)
  })

  it('increments validator profile views on detail 200', async () => {
    seedValidator(ctx.database)
    const before = getMetric(ctx.database, METRIC_KEYS.validatorProfileViews)
    const res = await fetch(
      `${ctx.baseUrl}/api/validators/${encodeURIComponent(FIXTURE_ADDRESS)}`,
    )
    expect(res.status).toBe(200)
    const after = getMetric(ctx.database, METRIC_KEYS.validatorProfileViews)
    expect(after).toBe(before + 1)

    const metricsRes = await fetch(`${ctx.baseUrl}/api/metrics/public`)
    const body = (await metricsRes.json()) as ReturnType<typeof buildPublicMetrics>
    expect(body.metrics.validatorProfileViews).toBe(after)
    expect(publicMetricsContainsAddresses(body)).toBe(false)
  })

  it('does not increment profile views on 404', async () => {
    const before = getMetric(ctx.database, METRIC_KEYS.validatorProfileViews)
    const res = await fetch(
      `${ctx.baseUrl}/api/validators/${encodeURIComponent(FIXTURE_ADDRESS)}`,
    )
    expect(res.status).toBe(404)
    expect(getMetric(ctx.database, METRIC_KEYS.validatorProfileViews)).toBe(before)
  })
})
