/**
 * Background canary staker snapshots for restake/unknown coverage.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  buildCanaryCoverageSummary,
  loadProbeRoster,
  resetProbeRosterCache,
} from '../../../server/src/probeRoster.js'
import {
  rosterMatchesProcessNetwork,
  runCanarySnapshotCycle,
  snapshotEligibleProbes,
} from '../../../server/src/probeSnapshots.js'
import { makeStakerFixture, SNAPSHOT_THROTTLE_MS } from '../../../server/src/stakingState.js'

const tempDirs: string[] = []
const databases: Array<{ close: () => void }> = []

afterEach(() => {
  resetProbeRosterCache()
  for (const database of databases.splice(0)) database.close()
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const DIRECT_VALIDATOR = 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV'
const RESTAKE_VALIDATOR = 'NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU'
const UNKNOWN_VALIDATOR = 'NQ38 VK34 DRBL S3CN M9KM 8UJN 9JY2 2KFN VQQH'
const DIRECT_PROBE = 'NQ87 C59A QLHE 8E2K 2N3G MAMY SV8P SKY6 BKL3'
const RESTAKE_PROBE = 'NQ35 8D30 B07F L1CY UJ3C FE0J 80XV G40M 9FV8'
const UNKNOWN_PROBE = 'NQ27 MJ19 11DG 522N RN4D BP9H 623S QRJM EVT4'

function writeRoster(probes: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), 'steakout-canary-snap-'))
  tempDirs.push(directory)
  const path = join(directory, 'roster.json')
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      kind: 'steakout-probe-roster-public',
      batchId: 'test-batch',
      network: 'main',
      createdAt: '2026-08-04T00:00:00.000Z',
      probes,
    }),
  )
  return path
}

function defaultProbes() {
  return [
    {
      probeId: 'direct',
      probeAddress: DIRECT_PROBE,
      validatorAddress: DIRECT_VALIDATOR,
      payoutType: 'direct',
    },
    {
      probeId: 'restake',
      probeAddress: RESTAKE_PROBE,
      validatorAddress: RESTAKE_VALIDATOR,
      payoutType: 'restake',
    },
    {
      probeId: 'unknown',
      probeAddress: UNKNOWN_PROBE,
      validatorAddress: UNKNOWN_VALIDATOR,
      payoutType: 'unknown',
    },
  ]
}

describe('canary probe snapshots', () => {
  it('treats main / mainnet as the same network', () => {
    expect(rosterMatchesProcessNetwork('main', 'mainnet')).toBe(true)
    expect(rosterMatchesProcessNetwork('main', 'testnet')).toBe(false)
  })

  it('selects restake and unknown probes only', () => {
    const path = writeRoster(defaultProbes())
    const roster = loadProbeRoster({ path, reload: true })
    const eligible = snapshotEligibleProbes(roster)
    expect(eligible.map((probe) => probe.probeId)).toEqual(['restake', 'unknown'])
  })

  it('skips RPC when roster network does not match NIMIQ_NETWORK', async () => {
    const previous = process.env.NIMIQ_NETWORK
    process.env.NIMIQ_NETWORK = 'testnet'
    try {
      const path = writeRoster(defaultProbes())
      const roster = loadProbeRoster({ path, reload: true })
      const directory = mkdtempSync(join(tmpdir(), 'steakout-canary-db-'))
      tempDirs.push(directory)
      const database = openDatabase(join(directory, 'test.sqlite'))
      databases.push(database)
      let stakerCalls = 0
      const result = await runCanarySnapshotCycle({
        database,
        roster,
        getStaker: async () => {
          stakerCalls += 1
          return makeStakerFixture({ address: RESTAKE_PROBE, balance: 99_900_000 })
        },
        getBlock: async () => 1,
      })
      expect(result.skippedNetwork).toBe(true)
      expect(result.considered).toBe(0)
      expect(stakerCalls).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.NIMIQ_NETWORK
      else process.env.NIMIQ_NETWORK = previous
    }
  })

  it('writes restake/unknown snapshots and flips coverage to observed', async () => {
    const previous = process.env.NIMIQ_NETWORK
    process.env.NIMIQ_NETWORK = 'main'
    try {
    const path = writeRoster(defaultProbes())
    const roster = loadProbeRoster({ path, reload: true })
    const directory = mkdtempSync(join(tmpdir(), 'steakout-canary-db-'))
    tempDirs.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    databases.push(database)
    database
      .prepare(
        'INSERT INTO validators (address, reward_address, is_listed) VALUES (?, ?, 1)',
      )
      .run(DIRECT_VALIDATOR, DIRECT_VALIDATOR)
    database
      .prepare(
        'INSERT INTO validators (address, reward_address, is_listed) VALUES (?, ?, 1)',
      )
      .run(RESTAKE_VALIDATOR, RESTAKE_VALIDATOR)

    const nowMs = Date.parse('2026-09-17T18:00:00.000Z')
    const first = await runCanarySnapshotCycle({
      database,
      roster,
      nowMs,
      getBlock: async () => 58_000_000,
      getStaker: async (address) => {
        if (address === RESTAKE_PROBE) {
          return makeStakerFixture({
            address: RESTAKE_PROBE,
            balance: 99_900_000,
            delegation: RESTAKE_VALIDATOR,
          })
        }
        if (address === UNKNOWN_PROBE) {
          return makeStakerFixture({
            address: UNKNOWN_PROBE,
            balance: 99_900_000,
            delegation: UNKNOWN_VALIDATOR,
          })
        }
        throw new Error(`unexpected probe ${address}`)
      },
    })
    expect(first).toMatchObject({
      considered: 2,
      written: 2,
      skippedThrottle: 0,
      skippedNoStaker: 0,
      skippedNetwork: false,
      errors: 0,
    })

    const summary = buildCanaryCoverageSummary(database)
    expect(summary.statuses).toEqual({ pending: 1, observed: 2, unavailable: 0 })

    const throttled = await runCanarySnapshotCycle({
      database,
      roster,
      nowMs: nowMs + 30 * 60 * 1000,
      getBlock: async () => 58_000_100,
      getStaker: async (address) =>
        makeStakerFixture({ address, balance: 100_000_000 }),
    })
    expect(throttled.written).toBe(0)
    expect(throttled.skippedThrottle).toBe(2)

    const later = await runCanarySnapshotCycle({
      database,
      roster,
      nowMs: nowMs + SNAPSHOT_THROTTLE_MS + 1,
      getBlock: async () => 58_001_000,
      getStaker: async (address) =>
        makeStakerFixture({ address, balance: 100_100_000 }),
    })
    expect(later.written).toBe(2)
    } finally {
      if (previous === undefined) delete process.env.NIMIQ_NETWORK
      else process.env.NIMIQ_NETWORK = previous
    }
  })

  it('counts missing stakers without writing rows', async () => {
    const path = writeRoster(defaultProbes())
    const roster = loadProbeRoster({ path, reload: true })
    const directory = mkdtempSync(join(tmpdir(), 'steakout-canary-db-'))
    tempDirs.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    databases.push(database)
    const result = await runCanarySnapshotCycle({
      database,
      roster,
      ignoreNetwork: true,
      getBlock: async () => 1,
      getStaker: async () => {
        throw new Error(
          'RPC getStakerByAddress returned an error: Internal error: No staker with address: NQ00',
        )
      },
    })
    expect(result.skippedNoStaker).toBe(2)
    expect(result.written).toBe(0)
    const count = database
      .prepare('SELECT COUNT(*) AS n FROM staker_snapshots')
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})
