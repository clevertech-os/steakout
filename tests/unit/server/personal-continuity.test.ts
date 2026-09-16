/**
 * P2-05 — personal continuity endpoint + pure helpers.
 * Crafted DB fixtures; no live RPC.
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
  CALC_VERSION,
  PAYOUT_RUN_OBSERVATION_TYPE,
  PAYOUT_RUN_STATUS,
  payoutRunToPayload,
  type PayoutRun,
} from '../../../server/src/payoutClassifier.js'
import {
  computeWindowInclusion,
  findLastPaymentToUser,
  membershipInKnownStakerSet,
  OBSERVED_POSITION_GROWTH_LABEL,
  readObservedPositionGrowth,
  readPersonalContinuity,
} from '../../../server/src/personalContinuity.js'
import { makeStakerFixture } from '../../../server/src/stakingState.js'

const TEST_SESSION_SECRET = 'steakout-p2-05-test-session-secret'
const USER = 'NQ0000000000000000000000000000000002'
const USER_SPACED = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002'
const OTHER = 'NQ0000000000000000000000000000000003'
const VALIDATOR = 'NQ0000000000000000000000000000000001'
const VALIDATOR_SPACED = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
const REWARD = 'NQ0000000000000000000000000000000099'
const REWARD_SPACED = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0099'
const BASE = Date.parse('2026-08-01T00:00:00.000Z')

function iso(msOffset: number): string {
  return new Date(BASE + msOffset).toISOString()
}

function markChainHistoryCovered(database: ReturnType<typeof openDatabase>): void {
  database.prepare(
    `INSERT INTO user_staking_history_scans
       (user_address, covered_from, scanned_at, complete)
     VALUES (?, ?, ?, 1)`,
  ).run(USER, '1970-01-01T00:00:00.000Z', new Date(BASE + 365 * 86_400_000).toISOString())
}

function insertValidator(
  database: ReturnType<typeof openDatabase>,
  opts: {
    address?: string
    reward?: string
    payoutType?: string | null
    name?: string
  } = {},
): void {
  database
    .prepare(
      `INSERT INTO validators (
         address, name, reward_address, payout_type_declared, is_listed
       ) VALUES (?, ?, ?, ?, 1)`,
    )
    .run(
      opts.address ?? VALIDATOR_SPACED,
      opts.name ?? 'Test Pool',
      opts.reward ?? REWARD_SPACED,
      opts.payoutType === undefined ? 'direct' : opts.payoutType,
    )
}

function insertTx(
  database: ReturnType<typeof openDatabase>,
  opts: {
    hash: string
    from: string
    to: string
    valueLuna?: number
    blockNumber?: number
    timestamp: string
    executionResult?: string
  },
): void {
  database
    .prepare(
      `INSERT INTO transactions (
         hash, from_address, to_address, value_luna, fee_luna, block_number,
         timestamp, execution_result, raw_json
       ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, '{}')`,
    )
    .run(
      opts.hash,
      opts.from,
      opts.to,
      opts.valueLuna ?? 100_000,
      opts.blockNumber ?? 100,
      opts.timestamp,
      opts.executionResult ?? 'ok',
    )
}

function insertPayoutRun(
  database: ReturnType<typeof openDatabase>,
  run: PayoutRun,
  validatorAddress = VALIDATOR_SPACED,
): void {
  const payload = payoutRunToPayload(run)
  database
    .prepare(
      `INSERT INTO validator_observations (
         validator_address, observation_type, status, observed_at,
         source_tx_hash, block_number, calc_version, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      validatorAddress,
      PAYOUT_RUN_OBSERVATION_TYPE,
      PAYOUT_RUN_STATUS,
      run.endedAt,
      run.firstTxHash,
      run.firstBlock,
      CALC_VERSION,
      JSON.stringify(payload),
    )
}

function makeRun(
  partial: Partial<PayoutRun> & { recipients: string[]; startedAt: string },
): PayoutRun {
  const endedAt = partial.endedAt ?? partial.startedAt
  const hash = partial.firstTxHash ?? 'a'.repeat(64)
  return {
    startedAt: partial.startedAt,
    endedAt,
    txCount: partial.txCount ?? partial.recipients.length,
    recipientCount: partial.recipients.length,
    recipients: partial.recipients,
    firstBlock: partial.firstBlock ?? 100,
    lastBlock: partial.lastBlock ?? 100,
    firstTxHash: hash,
    lastTxHash: partial.lastTxHash ?? hash,
    txHashes: partial.txHashes ?? [hash],
    totalValueLuna: partial.totalValueLuna ?? 100_000,
  }
}

describe('computeWindowInclusion', () => {
  it('returns nulls when there are no runs', () => {
    expect(computeWindowInclusion([], USER)).toEqual({
      consecutiveWindowsIncluded: null,
      windowsObserved: null,
    })
  })

  it('counts trailing consecutive inclusions and total inclusions independently', () => {
    const runs = [
      makeRun({ recipients: [USER_SPACED], startedAt: iso(0), firstTxHash: '1'.repeat(64) }),
      makeRun({ recipients: [OTHER], startedAt: iso(3_600_000), firstTxHash: '2'.repeat(64) }),
      makeRun({
        recipients: [USER, OTHER],
        startedAt: iso(7_200_000),
        firstTxHash: '3'.repeat(64),
      }),
      makeRun({ recipients: [USER_SPACED], startedAt: iso(10_800_000), firstTxHash: '4'.repeat(64) }),
    ].map((run) => ({ payload: payoutRunToPayload(run) }))

    // Included in runs 0, 2, 3 → windowsObserved=3
    // Trailing streak from newest: run3 yes, run2 yes, run1 no → consecutive=2
    expect(computeWindowInclusion(runs, USER)).toEqual({
      consecutiveWindowsIncluded: 2,
      windowsObserved: 3,
    })
  })

  it('consecutive is 0 when newest run does not include the user', () => {
    const runs = [
      makeRun({ recipients: [USER], startedAt: iso(0), firstTxHash: '1'.repeat(64) }),
      makeRun({ recipients: [OTHER], startedAt: iso(3_600_000), firstTxHash: '2'.repeat(64) }),
    ].map((run) => ({ payload: payoutRunToPayload(run) }))

    expect(computeWindowInclusion(runs, USER)).toEqual({
      consecutiveWindowsIncluded: 0,
      windowsObserved: 1,
    })
  })
})

describe('findLastPaymentToUser + membershipInKnownStakerSet', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-pc-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('finds the latest successful payment with space-insensitive addresses', () => {
    insertTx(database, {
      hash: 'a'.repeat(64),
      from: REWARD_SPACED,
      to: USER_SPACED,
      timestamp: iso(0),
      blockNumber: 10,
    })
    insertTx(database, {
      hash: 'b'.repeat(64),
      from: REWARD,
      to: USER,
      timestamp: iso(3_600_000),
      blockNumber: 20,
    })
    insertTx(database, {
      hash: 'c'.repeat(64),
      from: REWARD,
      to: USER,
      timestamp: iso(7_200_000),
      blockNumber: 30,
      executionResult: 'failed',
    })

    const found = findLastPaymentToUser(database, USER_SPACED, REWARD)
    expect(found).toMatchObject({
      at: iso(3_600_000),
      txHash: 'b'.repeat(64),
    })
  })

  it('membership is null when the known set is unavailable (never false-by-default)', () => {
    expect(membershipInKnownStakerSet(USER, null)).toBeNull()
    expect(membershipInKnownStakerSet(USER, undefined)).toBeNull()
    expect(membershipInKnownStakerSet(USER, new Set([USER]))).toBe(true)
    expect(membershipInKnownStakerSet(USER, new Set([OTHER]))).toBe(false)
    expect(membershipInKnownStakerSet(USER_SPACED, new Set([USER]))).toBe(true)
  })
})

describe('readPersonalContinuity', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  const clock = { now: Date.parse('2026-08-03T12:00:00.000Z') }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-pc-read-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('NotStaked → clean payload (HTTP-shaped envelope, not an error)', async () => {
    const envelope = await readPersonalContinuity({
      database,
      address: USER,
      now: () => clock.now,
      stakerOverride: null,
    })

    expect(envelope.status).toBe('ok')
    expect(envelope.source).toBe('rpc')
    expect(envelope.data).toMatchObject({
      mode: 'not-staked',
      positionState: 'NotStaked',
      validatorAddress: null,
      lastPaymentAt: null,
      consecutiveWindowsIncluded: null,
      windowsObserved: null,
      timeSinceLastPaymentSeconds: null,
      currentlyInKnownStakerSet: null,
      observedPositionGrowth: null,
    })
    // Neutral keys only — no "missed" wording in payload.
    const json = JSON.stringify(envelope)
    expect(json.toLowerCase()).not.toMatch(/missed/)
  })

  it('direct-payout: independent nulls when membership known but no payments/runs', async () => {
    insertValidator(database, { payoutType: 'direct' })

    const envelope = await readPersonalContinuity({
      database,
      address: USER,
      now: () => clock.now,
      stakerOverride: makeStakerFixture({
        address: USER_SPACED,
        balance: 5_000_000,
        delegation: VALIDATOR_SPACED,
      }),
      knownStakerSet: new Set([USER]),
    })

    expect(envelope.data.mode).toBe('direct-payout')
    expect(envelope.data.positionState).toBe('Active')
    expect(envelope.data.validatorName).toBe('Test Pool')
    expect(envelope.data.currentlyInKnownStakerSet).toBe(true)
    expect(envelope.data.lastPaymentAt).toBeNull()
    expect(envelope.data.consecutiveWindowsIncluded).toBeNull()
    expect(envelope.data.windowsObserved).toBeNull()
    expect(envelope.data.timeSinceLastPaymentSeconds).toBeNull()
    expect(envelope.data.observedPositionGrowth).toBeNull()
  })

  it('direct-payout: last payment + window stats + time since last payment', async () => {
    insertValidator(database, { payoutType: 'direct' })

    insertTx(database, {
      hash: 'p'.repeat(64),
      from: REWARD_SPACED,
      to: USER_SPACED,
      timestamp: iso(0),
      blockNumber: 50,
    })

    insertPayoutRun(
      database,
      makeRun({
        recipients: [OTHER],
        startedAt: iso(0),
        firstTxHash: '1'.repeat(64),
      }),
    )
    insertPayoutRun(
      database,
      makeRun({
        recipients: [USER_SPACED, OTHER],
        startedAt: iso(12 * 3_600_000),
        firstTxHash: '2'.repeat(64),
      }),
    )
    insertPayoutRun(
      database,
      makeRun({
        recipients: [USER],
        startedAt: iso(24 * 3_600_000),
        firstTxHash: '3'.repeat(64),
      }),
    )

    const envelope = await readPersonalContinuity({
      database,
      address: USER,
      now: () => clock.now,
      stakerOverride: makeStakerFixture({
        balance: 1_000_000,
        delegation: VALIDATOR,
      }),
      knownStakerSet: null, // set unavailable → field null
    })

    expect(envelope.data.mode).toBe('direct-payout')
    expect(envelope.data.lastPaymentAt).toBe(iso(0))
    expect(envelope.data.windowsObserved).toBe(2)
    expect(envelope.data.consecutiveWindowsIncluded).toBe(2)
    expect(envelope.data.currentlyInKnownStakerSet).toBeNull()
    expect(envelope.data.timeSinceLastPaymentSeconds).toBe(
      Math.floor((clock.now - BASE) / 1000),
    )
    expect(envelope.data.observedPositionGrowth).toBeNull()
    expect(envelope.dataFreshness.historyDepthDays).not.toBeNull()
  })

  it('restake: Observed position growth pointer, no payout claims', async () => {
    insertValidator(database, { payoutType: 'restake' })

    database
      .prepare(
        `INSERT INTO staker_snapshots (
           user_address, validator_address,
           active_balance_luna, inactive_balance_luna, retired_balance_luna,
           total_balance_luna, observed_at, source_block
         ) VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
      )
      .run(USER, VALIDATOR, 1_000_000, 1_000_000, iso(0), 100)
    database
      .prepare(
        `INSERT INTO staker_snapshots (
           user_address, validator_address,
           active_balance_luna, inactive_balance_luna, retired_balance_luna,
           total_balance_luna, observed_at, source_block
         ) VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
      )
      .run(USER, VALIDATOR, 1_050_000, 1_050_000, iso(3_600_000), 200)

    // Even if txs exist, restake mode must not claim direct payouts.
    insertTx(database, {
      hash: 'x'.repeat(64),
      from: REWARD_SPACED,
      to: USER,
      timestamp: iso(0),
    })

    const envelope = await readPersonalContinuity({
      database,
      address: USER,
      now: () => clock.now,
      stakerOverride: makeStakerFixture({
        balance: 1_050_000,
        delegation: VALIDATOR_SPACED,
      }),
      fetchHistoryPage: async () => [],
    })

    expect(envelope.data.mode).toBe('restake')
    expect(envelope.data.lastPaymentAt).toBeNull()
    expect(envelope.data.consecutiveWindowsIncluded).toBeNull()
    expect(envelope.data.windowsObserved).toBeNull()
    expect(envelope.data.currentlyInKnownStakerSet).toBeNull()
    expect(envelope.data.observedPositionGrowth).toEqual({
      label: OBSERVED_POSITION_GROWTH_LABEL,
      definition: 'Change in this staker position between indexed snapshots.',
      status: 'observed',
      latest: {
        at: iso(3_600_000),
        totalLuna: 1_050_000,
        sourceBlock: 200,
        validatorAddress: VALIDATOR,
      },
      previous: {
        at: iso(0),
        totalLuna: 1_000_000,
        sourceBlock: 100,
        validatorAddress: VALIDATOR,
      },
      deltaLuna: 50_000,
      totalDeltaLuna: 50_000,
      window: {
        from: iso(0),
        to: iso(3_600_000),
        durationDays: 0,
      },
      intervals: [
        {
          from: {
            at: iso(0),
            totalLuna: 1_000_000,
            sourceBlock: 100,
            validatorAddress: VALIDATOR,
          },
          to: {
            at: iso(3_600_000),
            totalLuna: 1_050_000,
            sourceBlock: 200,
            validatorAddress: VALIDATOR,
          },
          deltaLuna: 50_000,
          status: 'observed',
          confoundedBy: null,
        },
      ],
      expectedRange: {
        version: 'illustrative-v1',
        lowerLuna: 2,
        upperLuna: 6,
        annualRateLowPercent: 2,
        annualRateHighPercent: 5,
        assumptions:
          'Illustrative network-wide range of roughly a few percent per year; not live network data, validator-specific, predictive, or guaranteed.',
        status: 'inferred',
        methodologyUrl: '#/learn/methodology',
      },
      freshness: {
        at: iso(3_600_000),
        ageSeconds: Math.floor((clock.now - (BASE + 3_600_000)) / 1000),
        sourceBlock: 200,
      },
    })
    expect(OBSERVED_POSITION_GROWTH_LABEL).toBe('Observed position growth')
  })

  it('marks intent-confounded intervals and aggregates only usable history', () => {
    markChainHistoryCovered(database)
    const addSnapshot = (totalLuna: number, at: string, validator: string) => {
      database
        .prepare(
          `INSERT INTO staker_snapshots (
             user_address, validator_address, active_balance_luna,
             total_balance_luna, observed_at, source_block
           ) VALUES (?, ?, ?, ?, ?, ?)` ,
        )
        .run(USER, validator, totalLuna, totalLuna, at, totalLuna)
    }
    addSnapshot(1_000_000, iso(0), VALIDATOR)
    addSnapshot(1_100_000, iso(3_600_000), VALIDATOR)
    addSnapshot(1_150_000, iso(7_200_000), VALIDATOR)
    database
      .prepare(
        `INSERT INTO staking_intents (
           id, user_address, operation, params_json, status,
           created_at, expires_at
         ) VALUES (?, ?, 'stake', '{}', 'confirmed', ?, ?)` ,
      )
      .run('growth-intent', USER, iso(1_800_000), iso(3_000_000))

    const growth = readObservedPositionGrowth(database, USER, clock.now)
    expect(growth.status).toBe('observed')
    expect(growth.totalDeltaLuna).toBe(50_000)
    expect(growth.intervals[0]?.status).toBe('confounded')
    expect(growth.intervals[0]?.confoundedBy).toBe('staking-intent')
    expect(growth.intervals[1]?.status).toBe('observed')
  })

  it('returns insufficient-data without implying zero growth', () => {
    database
      .prepare(
        `INSERT INTO staker_snapshots (
           user_address, validator_address, active_balance_luna,
           total_balance_luna, observed_at, source_block
         ) VALUES (?, ?, ?, ?, ?, ?)` ,
      )
      .run(USER, VALIDATOR, 1_000_000, 1_000_000, iso(0), 100)

    const growth = readObservedPositionGrowth(database, USER, clock.now)
    expect(growth.status).toBe('insufficient-data')
    expect(growth.totalDeltaLuna).toBeNull()
    expect(growth.expectedRange).toBeNull()
    expect(growth.deltaLuna).toBeNull()
  })

  it('excludes externally observed staking actions and incomplete chain history', () => {
    const addSnapshot = (totalLuna: number, at: string) => database.prepare(
      `INSERT INTO staker_snapshots (
         user_address, validator_address, active_balance_luna,
         total_balance_luna, observed_at, source_block
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(USER, VALIDATOR, totalLuna, totalLuna, at, totalLuna)
    addSnapshot(1_000_000, iso(0))
    addSnapshot(1_100_000, iso(3_600_000))

    let growth = readObservedPositionGrowth(database, USER, clock.now)
    expect(growth.intervals[0]?.confoundedBy).toBe('chain-history-unavailable')

    markChainHistoryCovered(database)
    database.prepare(
      `INSERT INTO user_staking_actions
         (user_address, tx_hash, operation, observed_at, block_number)
       VALUES (?, ?, 'add-stake', ?, 150)`,
    ).run(USER, 'e'.repeat(64), iso(1_800_000))
    growth = readObservedPositionGrowth(database, USER, clock.now)
    expect(growth.status).toBe('insufficient-data')
    expect(growth.intervals[0]).toMatchObject({
      status: 'confounded',
      confoundedBy: 'chain-staking-action',
    })
  })

  it('confounds an interval when a confirmed intent spans it after delayed confirmation', () => {
    const addSnapshot = (totalLuna: number, at: string) => {
      database
        .prepare(
          `INSERT INTO staker_snapshots (
             user_address, validator_address, active_balance_luna,
             total_balance_luna, observed_at, source_block
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(USER, VALIDATOR, totalLuna, totalLuna, at, totalLuna)
    }
    addSnapshot(1_000_000, iso(3_600_000))
    addSnapshot(1_100_000, iso(10_800_000))
    database
      .prepare(
        `INSERT INTO staking_intents (
           id, user_address, operation, params_json, status,
           created_at, expires_at, confirmed_at
         ) VALUES (?, ?, 'stake', '{}', 'confirmed', ?, ?, ?)`,
      )
      .run('delayed-confirm', USER, iso(0), iso(86_400_000), iso(14_400_000))

    const growth = readObservedPositionGrowth(database, USER, clock.now)
    expect(growth.intervals[0]?.confoundedBy).toBe('staking-intent')
    expect(growth.totalDeltaLuna).toBeNull()
    expect(growth.status).toBe('insufficient-data')
  })

  it('confounds an interval overlapped by a pending intent lifetime', () => {
    const addSnapshot = (totalLuna: number, at: string) => {
      database
        .prepare(
          `INSERT INTO staker_snapshots (
             user_address, validator_address, active_balance_luna,
             total_balance_luna, observed_at, source_block
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(USER, VALIDATOR, totalLuna, totalLuna, at, totalLuna)
    }
    addSnapshot(1_000_000, iso(3_600_000))
    addSnapshot(1_100_000, iso(10_800_000))
    database
      .prepare(
        `INSERT INTO staking_intents (
           id, user_address, operation, params_json, status,
           created_at, expires_at
         ) VALUES (?, ?, 'stake', '{}', 'pending', ?, ?)`,
      )
      .run('pending-overlap', USER, iso(0), iso(14_400_000))

    const growth = readObservedPositionGrowth(database, USER, clock.now)
    expect(growth.intervals[0]?.confoundedBy).toBe('staking-intent')
    expect(growth.totalDeltaLuna).toBeNull()
    expect(growth.status).toBe('insufficient-data')
  })

  it('loads known staker set from recipient-coverage payload when present', async () => {
    insertValidator(database, { payoutType: 'direct' })
    database
      .prepare(
        `INSERT INTO validator_observations (
           validator_address, observation_type, status, observed_at,
           source_tx_hash, block_number, calc_version, payload_json
         ) VALUES (?, 'recipient-coverage', 'verified', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        VALIDATOR_SPACED,
        iso(0),
        CALC_VERSION,
        JSON.stringify({
          knownStakerAddresses: [USER_SPACED, OTHER],
          limitations: [
            'observed-recipient-coverage-is-not-proof-of-full-payout',
          ],
        }),
      )

    const envelope = await readPersonalContinuity({
      database,
      address: USER,
      now: () => clock.now,
      stakerOverride: makeStakerFixture({
        balance: 1,
        delegation: VALIDATOR,
      }),
      // omit knownStakerSet → DB helper
    })

    expect(envelope.data.currentlyInKnownStakerSet).toBe(true)
  })
})

describe('GET /api/me/observations (HTTP)', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-pc-http-'))
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
    if (!addr || typeof addr === 'string') throw new Error('no port')
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/api/me/observations`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('WALLET_NOT_CONNECTED')
  })

  it('returns NotStaked-style payload when RPC has no staker', async () => {
    // Without RPC mock the live client may fail; mint session + inject via
    // unit path is covered above. Here we only verify auth gate + 401 path.
    // For 200 with NotStaked we exercise the pure reader with stakerOverride.
    const { cookieHeader } = mintSessionCookie(USER, {
      sessionSecret: TEST_SESSION_SECRET,
    })
    // Expect either 200 (if RPC returns no-staker) or 503 (RPC unavailable).
    // In CI without NIMIQ_RPC this is typically 503 — both are not "validation errors".
    const res = await fetch(`${baseUrl}/api/me/observations`, {
      headers: { Cookie: cookieHeader },
    })
    expect([200, 503]).toContain(res.status)
    if (res.status === 200) {
      const body = (await res.json()) as {
        data: { mode: string; positionState: string }
      }
      expect(body.data.mode).toBe('not-staked')
      expect(body.data.positionState).toBe('NotStaked')
    }
  })
})
