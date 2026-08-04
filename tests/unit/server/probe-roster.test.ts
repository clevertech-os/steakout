/**
 * Canary probe roster + summary builder.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  buildCanaryProbeSummary,
  canaryConfiguredForValidator,
  loadProbeRoster,
  resetProbeRosterCache,
} from '../../../server/src/probeRoster.js'

const tempDirs: string[] = []
const databases: Array<{ close: () => void }> = []

afterEach(() => {
  resetProbeRosterCache()
  for (const database of databases.splice(0)) database.close()
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function writeRoster(probes: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), 'steakout-probe-'))
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

describe('probeRoster', () => {
  it('loads public roster and indexes by validator', () => {
    const path = writeRoster([
      {
        probeId: 'probe-01',
        probeAddress: 'NQ87 C59A QLHE 8E2K 2N3G MAMY SV8P SKY6 BKL3',
        probeAddressCompact: 'NQ87C59AQLHE8E2K2N3GMAMYSV8PSKY6BKL3',
        validatorAddress: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
        validatorAddressCompact: 'NQ155JNSU7CERAH53T02F8A9JCT6QMG97TSV',
        payoutType: 'direct',
        stakeAmountLuna: 99_900_000,
        stakedAt: '2026-08-04T21:52:37.029Z',
        stakeTxHash: 'eea67155fc7c3bac4c40640ff838539d2334bd63d10eeb4981c37e19df479e84',
      },
    ])
    const roster = loadProbeRoster({ path, reload: true })
    expect(roster.probes).toHaveLength(1)
    expect(
      canaryConfiguredForValidator(
        'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
      ),
    ).toBe(true)
    expect(
      canaryConfiguredForValidator(
        'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ),
    ).toBe(false)
  })

  it('returns pending canary summary when configured but no observations', () => {
    const path = writeRoster([
      {
        probeId: 'probe-01',
        probeAddress: 'NQ87 C59A QLHE 8E2K 2N3G MAMY SV8P SKY6 BKL3',
        validatorAddress: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
        payoutType: 'direct',
        stakeAmountLuna: 99_900_000,
        stakedAt: '2026-08-04T21:52:37.029Z',
        stakeTxHash: 'eea67155fc7c3bac4c40640ff838539d2334bd63d10eeb4981c37e19df479e84',
      },
    ])
    loadProbeRoster({ path, reload: true })
    const summary = buildCanaryProbeSummary(
      'NQ155JNSU7CERAH53T02F8A9JCT6QMG97TSV',
    )
    expect(summary.configured).toBe(true)
    expect(summary.status).toBe('pending')
    expect(summary.statusLabel).toBe('Pending observation')
    expect(summary.lastPaymentAt).toBeNull()
    expect(summary.lastPaymentLuna).toBeNull()
    expect(summary.lastStakerBalanceLuna).toBeNull()
    expect(summary.dataStatus).toBe('insufficient')
    expect(summary.stakeAmountLuna).toBe(99_900_000)
    expect(summary.probeAddress).toContain('NQ87')
  })

  it('surfaces last payment from transactions when indexed', () => {
    const path = writeRoster([
      {
        probeId: 'probe-01',
        probeAddress: 'NQ87 C59A QLHE 8E2K 2N3G MAMY SV8P SKY6 BKL3',
        validatorAddress: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
        payoutType: 'direct',
        stakeAmountLuna: 99_900_000,
        stakedAt: '2026-08-04T21:52:37.029Z',
        stakeTxHash: 'aa'.repeat(32),
      },
    ])
    loadProbeRoster({ path, reload: true })

    const directory = mkdtempSync(join(tmpdir(), 'steakout-probe-db-'))
    tempDirs.push(directory)
    const database = openDatabase(join(directory, 'test.sqlite'))
    databases.push(database)

    database
      .prepare(
        `
        INSERT INTO transactions (
          hash, from_address, to_address, value_luna, fee_luna,
          block_number, timestamp, execution_result, raw_json
        ) VALUES (?, ?, ?, ?, 0, 1, ?, 'ok', '{}')
      `,
      )
      .run(
        'bb'.repeat(32),
        'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
        'NQ87 C59A QLHE 8E2K 2N3G MAMY SV8P SKY6 BKL3',
        12_345,
        '2026-08-10T12:00:00.000Z',
      )

    const summary = buildCanaryProbeSummary(
      'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
      {
        database,
        rewardAddress: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
      },
    )
    expect(summary.status).toBe('active')
    expect(summary.lastPaymentLuna).toBe(12_345)
    expect(summary.lastPaymentAt).toBe('2026-08-10T12:00:00.000Z')
    expect(summary.dataStatus).toBe('verified')
  })

  it('returns not-configured when validator has no probe', () => {
    const path = writeRoster([])
    loadProbeRoster({ path, reload: true })
    const summary = buildCanaryProbeSummary(
      'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
    )
    expect(summary.configured).toBe(false)
    expect(summary.status).toBe('not-configured')
  })
})
