/**
 * P1-04 — registry sync upsert + GET /api/validators[/:address]
 * Fixture-based; live network is mocked via injected fetcher / reward resolver.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { openDatabase } from '../../../server/src/db.js'
import { clearRateLimitBuckets } from '../../../server/src/rate-limit.js'
import { clearPublicResponseCache } from '../../../server/src/responseCache.js'
import {
  compareValidators,
  listValidators,
  mergeSnapshots,
  syncValidators,
  toListItem,
  toProfile,
  type ValidatorRow,
  type ValidatorSort,
} from '../../../server/src/validatorSync.js'
import type { ValidatorsFetch } from '../../../server/src/validators-api.js'

const fixtureDirectory = resolve(process.cwd(), 'tests/fixtures/registry')
const knownFixture = JSON.parse(
  readFileSync(join(fixtureDirectory, 'p0-05-validators-known-mainnet.json'), 'utf8'),
) as unknown[]
const observableFixture = JSON.parse(
  readFileSync(join(fixtureDirectory, 'p0-05-validators-observable-mainnet.json'), 'utf8'),
) as unknown[]

const STAMP = '2026-08-03T12:00:00.000Z'

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

interface TestHttp {
  directory: string
  database: ReturnType<typeof openDatabase>
  baseUrl: string
  server: Server
}

async function startApp(seed = true): Promise<TestHttp> {
  clearRateLimitBuckets()
  clearPublicResponseCache()
  const directory = mkdtempSync(join(tmpdir(), 'steakout-vsync-'))
  const database = openDatabase(join(directory, 'test.sqlite'))
  if (seed) {
    await syncValidators({
      database,
      now: () => STAMP,
      logger: () => {},
      fetchOptions: {
        apiUrl: 'https://registry.example.test/api/v1/validators',
        fetcher: fixtureFetcher(),
        resolveRewardAddress: async (address) => `REWARD-${address.slice(0, 8)}`,
      },
    })
  }
  const app = createApp({ database })
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

describe('validatorSync upsert', () => {
  it('upserts all-observable validators with schedule_every_hours and registry_updated_at', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'steakout-vsync-db-'))
    const database = openDatabase(join(directory, 'test.sqlite'))
    try {
      const result = await syncValidators({
        database,
        now: () => STAMP,
        logger: () => {},
        fetchOptions: {
          apiUrl: 'https://registry.example.test/api/v1/validators',
          fetcher: fixtureFetcher(),
          resolveRewardAddress: async (address) => address,
        },
      })

      expect(result.upserted).toBe(78)
      expect(result.allObservable.validators).toHaveLength(78)
      expect(result.knownOnly.validators).toHaveLength(24)

      const rows = database.prepare('SELECT * FROM validators').all() as ValidatorRow[]
      expect(rows).toHaveLength(78)
      expect(rows.every((row) => row.registry_updated_at === STAMP)).toBe(true)

      const listed = rows.filter((row) => row.is_listed === 1)
      expect(listed).toHaveLength(24)

      const withSchedule = rows.filter((row) => row.schedule_every_hours !== null)
      // Known-only fixture: 12 normalizable schedules (METHODOLOGY §4.2 calc_version 2:
      // hour-level cron + every N hours/daily forms).
      expect(withSchedule.length).toBe(12)
      expect(
        rows.find((row) => row.payout_schedule_declared === 'Every 12 hours')?.schedule_every_hours,
      ).toBe(12)
      expect(
        rows.find((row) => row.payout_schedule_declared === '0 * * * *')?.schedule_every_hours,
      ).toBe(1)
      expect(
        rows.find((row) => row.payout_schedule_declared === '0 */6 * * *')?.schedule_every_hours,
      ).toBe(6)

      // Score -1/missing already null at normalize; no numeric -1 in DB.
      expect(rows.every((row) => row.official_score === null || row.official_score >= 0)).toBe(true)

      // Reward addresses resolved for new validators.
      expect(rows.filter((row) => row.reward_address !== null).length).toBe(78)
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('backfills reward addresses only when missing on re-sync', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'steakout-vsync-rw-'))
    const database = openDatabase(join(directory, 'test.sqlite'))
    const resolutions: string[] = []
    try {
      await syncValidators({
        database,
        now: () => STAMP,
        logger: () => {},
        fetchOptions: {
          apiUrl: 'https://registry.example.test/api/v1/validators',
          fetcher: fixtureFetcher(),
          resolveRewardAddress: async (address) => {
            resolutions.push(address)
            return `R1-${address.slice(0, 6)}`
          },
        },
      })
      const firstPass = resolutions.length
      expect(firstPass).toBe(78)

      resolutions.length = 0
      await syncValidators({
        database,
        now: () => '2026-08-03T13:00:00.000Z',
        logger: () => {},
        fetchOptions: {
          apiUrl: 'https://registry.example.test/api/v1/validators',
          fetcher: fixtureFetcher(),
          resolveRewardAddress: async (address) => {
            resolutions.push(address)
            return `R2-${address.slice(0, 6)}`
          },
        },
      })
      // Existing rewards kept — no second resolution pass for known rows.
      expect(resolutions).toHaveLength(0)

      const sample = database.prepare(
        'SELECT reward_address FROM validators LIMIT 1',
      ).get() as { reward_address: string }
      expect(sample.reward_address.startsWith('R1-')).toBe(true)
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('mergeSnapshots prefers known-only listed metadata over all-observable', () => {
    const knownOnly = {
      mode: 'known-only' as const,
      source: 'test',
      sourceTimestamp: STAMP,
      validators: [
        {
          address: 'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4',
          name: 'Keyring listed',
          website: null,
          description: null,
          fee: '0.05',
          payoutType: 'restake' as const,
          payoutSchedule: 'Every 12 hours',
          scheduleEveryHours: 12,
          officialScore: 0.9,
          dominanceRatio: 0.01,
          stakeLuna: 1,
          stakersCount: 1,
          rewardAddress: null,
          isListed: true,
          sourceTimestamp: STAMP,
        },
      ],
      rewardAddressResolution: { attempted: 0, resolved: 0, unavailable: 0 },
    }
    const allObservable = {
      mode: 'all-observable' as const,
      source: 'test',
      sourceTimestamp: STAMP,
      validators: [
        {
          ...knownOnly.validators[0]!,
          name: 'Keyring unlisted copy',
          isListed: false,
        },
        {
          address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001',
          name: 'Unlisted only',
          website: null,
          description: null,
          fee: null,
          payoutType: 'unknown' as const,
          payoutSchedule: null,
          scheduleEveryHours: null,
          officialScore: null,
          dominanceRatio: null,
          stakeLuna: null,
          stakersCount: null,
          rewardAddress: null,
          isListed: false,
          sourceTimestamp: STAMP,
        },
      ],
      rewardAddressResolution: { attempted: 0, resolved: 0, unavailable: 0 },
    }

    const merged = mergeSnapshots(knownOnly, allObservable)
    expect(merged).toHaveLength(2)
    expect(merged.find((v) => v.name === 'Keyring listed')?.isListed).toBe(true)
    expect(merged.find((v) => v.name === 'Unlisted only')?.isListed).toBe(false)
  })
})

describe('validator list/detail serialization', () => {
  const baseRow = (overrides: Partial<ValidatorRow> = {}): ValidatorRow => ({
    address: 'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4',
    name: 'Keyring',
    website: 'https://example.test',
    description: 'desc',
    logo_url: null,
    fee_declared: '0.05',
    payout_type_declared: 'restake',
    payout_schedule_declared: 'Every 12 hours',
    schedule_every_hours: 12,
    reward_address: 'NQ11 REWARD ADDR',
    official_score: 0.99,
    dominance_ratio: 0.02,
    stake_luna: 1000,
    stakers_count: 10,
    is_listed: 1,
    registry_updated_at: STAMP,
    ...overrides,
  })

  it('toListItem matches API.md §3 shape with stubbed observation', () => {
    const item = toListItem(baseRow())
    expect(item).toEqual({
      address: 'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4',
      name: 'Keyring',
      isListed: true,
      logoUrl: null,
      website: 'https://example.test',
      officialScore: 0.99,
      stakeLuna: 1000,
      dominanceRatio: 0.02,
      stakersCount: 10,
      declared: {
        fee: '0.05',
        payoutType: 'restake',
        payoutSchedule: 'Every 12 hours',
        scheduleNormalized: { everyHours: 12 },
        // Keyring min payout from server/config/min-payout-declarations.json
        minPayout: { nim: 10, kind: 'fixed', confidence: 'high' },
      },
      observation: {
        status: 'insufficient-data',
        lastObservedAt: null,
        historyDepthDays: 0,
        observedWindows: null,
        expectedWindows: null,
      },
      observedPaymentFloor: {
        minNim: null,
        p5Nim: null,
        sampleSize: 0,
        recipientCount: 0,
        historyDepthDays: null,
        status: 'unavailable',
        computedAt: new Date(0).toISOString(),
      },
      registryUpdatedAt: STAMP,
      // Keyring is on the committed canary probe roster (server/config/probe-roster.public.json).
      canaryConfigured: true,
    })
  })

  it('maps null official score and missing scheduleNormalized correctly', () => {
    const item = toListItem(baseRow({
      official_score: null,
      schedule_every_hours: null,
      payout_schedule_declared: '0 * * * *',
      is_listed: 0,
    }))
    expect(item.officialScore).toBeNull()
    expect(item.isListed).toBe(false)
    expect(item.declared.scheduleNormalized).toBeNull()
    expect(item.declared.payoutSchedule).toBe('0 * * * *')
  })

  it('toProfile adds website, description, reward explorer link, registryUpdatedAt, canaryProbe', () => {
    const profile = toProfile(baseRow({
      reward_address: 'NQ37 6EL5 BP9K XL1A 3ED0 L3EC NPR5 C9D3 BRKG',
    }))
    expect(profile.website).toBe('https://example.test')
    expect(profile.description).toBe('desc')
    expect(profile.rewardAddress).toBe('NQ37 6EL5 BP9K XL1A 3ED0 L3EC NPR5 C9D3 BRKG')
    expect(profile.rewardExplorerUrl).toBe(
      'https://nimiq.watch/#NQ376EL5BP9KXL1A3ED0L3ECNPR5C9D3BRKG',
    )
    expect(profile.scoreComponents).toBeNull()
    expect(profile.registryUpdatedAt).toBe(STAMP)
    expect(profile.canaryProbe).toBeDefined()
    expect(typeof profile.canaryConfigured).toBe('boolean')
    expect(profile.canaryProbe.configured).toBe(profile.canaryConfigured)
  })

  it('compareValidators implements all sort options', () => {
    const a = baseRow({
      address: 'NQAA',
      official_score: 0.5,
      dominance_ratio: 0.1,
      stake_luna: 100,
      payout_type_declared: 'direct',
      is_listed: 1,
      schedule_every_hours: 12,
    })
    const b = baseRow({
      address: 'NQBB',
      official_score: 0.9,
      dominance_ratio: 0.01,
      stake_luna: 500,
      payout_type_declared: 'restake',
      is_listed: 0,
      schedule_every_hours: null,
    })
    const sorts: ValidatorSort[] = [
      'recommended', 'score', 'dominance', 'stake', 'direct-payout', 'restake', 'new',
    ]
    for (const sort of sorts) {
      const cmp = compareValidators(a, b, sort)
      expect(typeof cmp).toBe('number')
      expect(Number.isNaN(cmp)).toBe(false)
    }
    expect(compareValidators(a, b, 'score')).toBeGreaterThan(0) // b higher score → a after b when sorting a-b
    // Actually compare returns a-b style: positive means a > b for sort placement depends on Array.sort
    // score: higher first → nullsLastCompare desc: b(0.9) vs a(0.5) → a-b = positive means a sorts after b. Good.
    expect(compareValidators(a, b, 'dominance')).toBeGreaterThan(0) // a has higher dominance → after when asc
    expect(compareValidators(a, b, 'stake')).toBeGreaterThan(0) // a has lower stake → after when desc
    expect(compareValidators(a, b, 'direct-payout')).toBeLessThan(0) // direct before restake
    expect(compareValidators(a, b, 'restake')).toBeGreaterThan(0) // restake first → b before a
    expect(compareValidators(a, b, 'recommended')).toBeLessThan(0) // listed first
  })

  it('recommended sort uses live observation status when other keys match (P2-09)', () => {
    const a = baseRow({
      address: 'NQAA',
      official_score: 0.5,
      dominance_ratio: 0.05,
      stake_luna: 100,
      payout_type_declared: 'direct',
      is_listed: 1,
      schedule_every_hours: 12,
    })
    const b = baseRow({
      address: 'NQBB',
      official_score: 0.5,
      dominance_ratio: 0.05,
      stake_luna: 100,
      payout_type_declared: 'direct',
      is_listed: 1,
      schedule_every_hours: 12,
    })
    // on-schedule ranks before insufficient-data
    expect(
      compareValidators(a, b, 'recommended', {
        statusA: 'on-schedule',
        statusB: 'insufficient-data',
      }),
    ).toBeLessThan(0)
    // irregular ranks after mostly-on-schedule
    expect(
      compareValidators(a, b, 'recommended', {
        statusA: 'irregular',
        statusB: 'mostly-on-schedule',
      }),
    ).toBeGreaterThan(0)
    // unavailable ranks after insufficient-data
    expect(
      compareValidators(a, b, 'recommended', {
        statusA: 'unavailable',
        statusB: 'insufficient-data',
      }),
    ).toBeGreaterThan(0)
  })
})

describe('GET /api/validators', () => {
  const contexts: TestHttp[] = []

  afterEach(async () => {
    while (contexts.length > 0) {
      const ctx = contexts.pop()
      if (ctx) await closeApp(ctx)
    }
  })

  it('returns envelope + list items matching API.md; includes unlisted when listed=false', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)

    const response = await fetch(`${ctx.baseUrl}/api/validators`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      updatedAt: string
      source: string
      status: string
      dataFreshness: { ageSeconds: number }
      data: { validators: Array<Record<string, unknown>> }
    }

    expect(body.source).toBe('registry')
    expect(body.status).toBe('ok')
    expect(body.updatedAt).toBe(STAMP)
    expect(typeof body.dataFreshness.ageSeconds).toBe('number')
    expect(body.data.validators).toHaveLength(78)

    const unlisted = body.data.validators.filter((v) => v.isListed === false)
    expect(unlisted.length).toBe(54)

    for (const item of body.data.validators) {
      expect(item).toMatchObject({
        isListed: expect.any(Boolean),
        observation: {
          status: 'insufficient-data',
          lastObservedAt: null,
          historyDepthDays: 0,
        },
      })
      expect(item.registryUpdatedAt).toBe(STAMP)
      expect(item.officialScore === null || typeof item.officialScore === 'number').toBe(true)
      if (typeof item.officialScore === 'number') {
        expect(item.officialScore).not.toBe(-1)
      }
      const declared = item.declared as Record<string, unknown>
      expect(['direct', 'restake', 'unknown']).toContain(declared.payoutType)
    }
  })

  it('listed=true returns only listed validators', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)

    const response = await fetch(`${ctx.baseUrl}/api/validators?listed=true`)
    const body = await response.json() as { data: { validators: Array<{ isListed: boolean }> } }
    expect(body.data.validators).toHaveLength(24)
    expect(body.data.validators.every((v) => v.isListed)).toBe(true)
  })

  it('all sort options return 200 with stable non-empty lists', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)

    const sorts: ValidatorSort[] = [
      'recommended', 'score', 'dominance', 'stake', 'direct-payout', 'restake', 'new',
    ]
    for (const sort of sorts) {
      const response = await fetch(`${ctx.baseUrl}/api/validators?sort=${sort}`)
      expect(response.status).toBe(200)
      const body = await response.json() as { data: { validators: unknown[] } }
      expect(body.data.validators.length).toBe(78)
    }

    // score: first with score should be highest
    const scoreRes = await fetch(`${ctx.baseUrl}/api/validators?sort=score&listed=true`)
    const scoreBody = await scoreRes.json() as {
      data: { validators: Array<{ officialScore: number | null }> }
    }
    const withScores = scoreBody.data.validators.filter((v) => v.officialScore !== null)
    for (let i = 1; i < withScores.length; i += 1) {
      expect(withScores[i - 1]!.officialScore!).toBeGreaterThanOrEqual(withScores[i]!.officialScore!)
    }

    // direct-payout: directs first
    const directRes = await fetch(`${ctx.baseUrl}/api/validators?sort=direct-payout`)
    const directBody = await directRes.json() as {
      data: { validators: Array<{ declared: { payoutType: string } }> }
    }
    const firstDirectIdx = directBody.data.validators.findIndex(
      (v) => v.declared.payoutType === 'direct',
    )
    const firstRestakeIdx = directBody.data.validators.findIndex(
      (v) => v.declared.payoutType === 'restake',
    )
    if (firstDirectIdx >= 0 && firstRestakeIdx >= 0) {
      expect(firstDirectIdx).toBeLessThan(firstRestakeIdx)
    }
  })

  it('rejects invalid sort', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)
    const response = await fetch(`${ctx.baseUrl}/api/validators?sort=apy`)
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION')
  })

  it('GET /api/validators/:address returns full profile; compact address works', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)

    const spaced = 'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4'
    const compact = spaced.replace(/\s+/g, '')

    const bySpaced = await fetch(
      `${ctx.baseUrl}/api/validators/${encodeURIComponent(spaced)}`,
    )
    expect(bySpaced.status).toBe(200)
    const spacedBody = await bySpaced.json() as {
      source: string
      data: {
        address: string
        website: string | null
        description: string | null
        rewardAddress: string | null
        rewardExplorerUrl: string | null
        scoreComponents: null
        registryUpdatedAt: string
        observation: { status: string }
        isListed: boolean
      }
    }
    expect(spacedBody.source).toBe('registry')
    expect(spacedBody.data.address).toBe(spaced)
    expect(spacedBody.data.isListed).toBe(true)
    expect(spacedBody.data.registryUpdatedAt).toBe(STAMP)
    expect(spacedBody.data.observation.status).toBe('insufficient-data')
    expect(spacedBody.data.scoreComponents).toBeNull()
    expect(spacedBody.data.rewardAddress).toBeTruthy()
    expect(spacedBody.data.rewardExplorerUrl).toMatch(/^https:\/\/nimiq\.watch\//)

    const byCompact = await fetch(`${ctx.baseUrl}/api/validators/${compact}`)
    expect(byCompact.status).toBe(200)
    const compactBody = await byCompact.json() as { data: { address: string } }
    expect(compactBody.data.address).toBe(spaced)
  })

  it('returns VALIDATOR_NOT_FOUND for unknown address', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)
    // Valid shape, not in registry
    const response = await fetch(
      `${ctx.baseUrl}/api/validators/NQ0000000000000000000000000000000000`,
    )
    expect(response.status).toBe(404)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATOR_NOT_FOUND')
  })

  it('empty DB yields status unavailable and empty list', async () => {
    const ctx = await startApp(false)
    contexts.push(ctx)
    const response = await fetch(`${ctx.baseUrl}/api/validators`)
    const body = await response.json() as {
      status: string
      data: { validators: unknown[] }
    }
    expect(body.status).toBe('unavailable')
    expect(body.data.validators).toEqual([])
  })

  it('listValidators helper applies listed filter without HTTP', async () => {
    const ctx = await startApp(true)
    contexts.push(ctx)
    const all = listValidators(ctx.database, { sort: 'stake' })
    const listed = listValidators(ctx.database, { sort: 'stake', listed: true })
    expect(all.length).toBe(78)
    expect(listed.length).toBe(24)
    expect(listed.every((v) => v.isListed)).toBe(true)
    // stake desc
    for (let i = 1; i < listed.length; i += 1) {
      const prev = listed[i - 1]!.stakeLuna
      const cur = listed[i]!.stakeLuna
      if (prev !== null && cur !== null) {
        expect(prev).toBeGreaterThanOrEqual(cur)
      }
    }
  })

  /**
   * P3-03 — registry reads must not require live RPC.
   * Seed SQLite only; unset RPC env; list + detail still 200 with registry envelope.
   */
  it('serves list/detail from SQLite with no live RPC configured', async () => {
    const prevRpc = process.env.NIMIQ_RPC_URL
    const prevFallback = process.env.NIMIQ_RPC_URL_FALLBACK
    delete process.env.NIMIQ_RPC_URL
    delete process.env.NIMIQ_RPC_URL_FALLBACK

    try {
      const ctx = await startApp(true)
      contexts.push(ctx)

      const listRes = await fetch(`${ctx.baseUrl}/api/validators`)
      expect(listRes.status).toBe(200)
      const listBody = await listRes.json() as {
        source: string
        status: string
        data: { validators: unknown[] }
      }
      expect(listBody.source).toBe('registry')
      expect(listBody.status).toBe('ok')
      expect(listBody.data.validators.length).toBe(78)

      const spaced = 'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4'
      const detailRes = await fetch(
        `${ctx.baseUrl}/api/validators/${encodeURIComponent(spaced)}`,
      )
      expect(detailRes.status).toBe(200)
      const detailBody = await detailRes.json() as {
        source: string
        data: { address: string }
      }
      expect(detailBody.source).toBe('registry')
      expect(detailBody.data.address).toBe(spaced)

      // Health stays up; live chain reads flagged off when RPC never succeeds.
      const healthRes = await fetch(`${ctx.baseUrl}/api/health`)
      expect(healthRes.status).toBe(200)
      const health = await healthRes.json() as {
        ok: boolean
        blockNumber: number | null
        mode: string
        features: { liveChainReads: boolean; registryReads: boolean }
        rpc: { available: boolean; liveReads: boolean }
      }
      expect(health.ok).toBe(true)
      expect(health.blockNumber).toBeNull()
      expect(health.mode).toBe('degraded')
      expect(health.features.registryReads).toBe(true)
      expect(health.features.liveChainReads).toBe(false)
      expect(health.rpc.available).toBe(false)
      expect(health.rpc.liveReads).toBe(false)
    } finally {
      if (prevRpc !== undefined) process.env.NIMIQ_RPC_URL = prevRpc
      else delete process.env.NIMIQ_RPC_URL
      if (prevFallback !== undefined) process.env.NIMIQ_RPC_URL_FALLBACK = prevFallback
      else delete process.env.NIMIQ_RPC_URL_FALLBACK
    }
  })
})
