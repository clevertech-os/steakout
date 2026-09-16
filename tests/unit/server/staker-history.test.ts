import { Address, StakingDataBuilder } from '@nimiq/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import type { NimiqTransaction } from '../../../server/src/nimiq-rpc.js'
import {
  classifyStakerTransaction,
  syncStakerHistory,
} from '../../../server/src/stakerHistory.js'

const USER = 'NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU'
const OTHER = 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV'

function incoming(data: Uint8Array, overrides: Partial<NimiqTransaction> = {}): NimiqTransaction {
  return {
    hash: 'a'.repeat(64),
    blockNumber: 42,
    timestamp: Date.parse('2026-09-01T00:30:00.000Z'),
    from: USER,
    fromType: 0,
    to: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0001',
    toType: 3,
    value: 100,
    fee: 1,
    recipientData: Buffer.from(data).toString('hex'),
    executionResult: true,
    ...overrides,
  }
}

describe('staker chain-history indexing', () => {
  let directory: string
  let database: ReturnType<typeof openDatabase>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'steakout-staker-history-'))
    database = openDatabase(join(directory, 'test.sqlite'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('identifies third-party add-stake by decoded staker address', () => {
    const transaction = incoming(
      StakingDataBuilder.addStake(Address.fromString(USER)),
      { from: OTHER },
    )
    expect(classifyStakerTransaction(transaction, USER)).toBe('add-stake')

    const unrelated = incoming(
      StakingDataBuilder.addStake(Address.fromString(OTHER)),
      { from: USER },
    )
    expect(classifyStakerTransaction(unrelated, USER)).toBeNull()
  })

  it('indexes external staking actions and records complete cursor coverage', async () => {
    const transaction = incoming(StakingDataBuilder.setActiveStake(50n))
    const cursors: Array<string | null> = []
    await syncStakerHistory({
      database,
      userAddress: USER,
      requiredFrom: '2026-09-01T00:00:00.000Z',
      now: () => Date.parse('2026-09-01T01:00:00.000Z'),
      fetchPage: async (_address, _max, cursor) => {
        cursors.push(cursor)
        return cursor == null ? [transaction] : []
      },
    })

    expect(cursors).toEqual([null, transaction.hash])
    expect(database.prepare(
      `SELECT operation, observed_at FROM user_staking_actions WHERE user_address = ?`,
    ).get(USER.replaceAll(' ', ''))).toEqual({
      operation: 'set-active-stake',
      observed_at: '2026-09-01T00:30:00.000Z',
    })
    expect(database.prepare(
      `SELECT covered_from, scanned_at, complete FROM user_staking_history_scans WHERE user_address = ?`,
    ).get(USER.replaceAll(' ', ''))).toEqual({
      covered_from: '1970-01-01T00:00:00.000Z',
      scanned_at: '2026-09-01T01:00:00.000Z',
      complete: 1,
    })
  })

  it.each([
    ['negative timestamp', { timestamp: -1 }],
    ['fractional timestamp', { timestamp: 1.5 }],
    ['future timestamp beyond clock skew', { timestamp: Date.parse('2026-09-01T01:02:00.001Z') }],
    ['empty hash', { hash: '' }],
    ['malformed hash', { hash: 'xyz' }],
    ['empty sender', { from: '' }],
    ['empty recipient', { to: '' }],
    ['fractional account type', { toType: 2.5 }],
    ['missing staking data', { recipientData: '' }],
  ] as const)('does not advance coverage for a %s', async (_label, overrides) => {
    const transaction = incoming(StakingDataBuilder.setActiveStake(50n), overrides)
    await syncStakerHistory({
      database,
      userAddress: USER,
      requiredFrom: '2026-09-01T00:00:00.000Z',
      now: () => Date.parse('2026-09-01T01:00:00.000Z'),
      fetchPage: async (_address, _max, cursor) => cursor == null ? [transaction] : [],
    })
    expect(database.prepare(
      `SELECT * FROM user_staking_history_scans WHERE user_address = ?`,
    ).get(USER.replaceAll(' ', ''))).toBeUndefined()
  })

  it('fails closed on a repeated cursor and on page-budget exhaustion', async () => {
    const transaction = incoming(StakingDataBuilder.setActiveStake(50n), {
      timestamp: Date.parse('2026-09-01T00:59:00.000Z'),
    })
    await syncStakerHistory({
      database,
      userAddress: USER,
      requiredFrom: '2026-08-01T00:00:00.000Z',
      now: () => Date.parse('2026-09-01T01:00:00.000Z'),
      fetchPage: async () => [transaction],
    })
    expect(database.prepare(`SELECT COUNT(*) AS n FROM user_staking_history_scans`).get())
      .toEqual({ n: 0 })

    let page = 0
    await syncStakerHistory({
      database,
      userAddress: USER,
      requiredFrom: '2026-08-01T00:00:00.000Z',
      now: () => Date.parse('2026-09-01T01:00:00.000Z'),
      fetchPage: async () => {
        page += 1
        return [incoming(StakingDataBuilder.setActiveStake(50n), {
          hash: page.toString(16).padStart(64, '0'),
          timestamp: Date.parse('2026-09-01T01:00:00.000Z') - page,
        })]
      },
    })
    expect(page).toBe(20)
    expect(database.prepare(`SELECT COUNT(*) AS n FROM user_staking_history_scans`).get())
      .toEqual({ n: 0 })
  })

  it('reuses sufficient coverage and deduplicates concurrent scans', async () => {
    const normalized = USER.replaceAll(' ', '')
    database.prepare(
      `INSERT INTO user_staking_history_scans
         (user_address, covered_from, scanned_at, complete)
       VALUES (?, ?, ?, 0)`,
    ).run(normalized, '2026-09-01T00:00:00.000Z', '2026-09-01T01:00:00.000Z')
    let calls = 0
    const coveredFetch = async (): Promise<NimiqTransaction[]> => {
      calls += 1
      return []
    }
    await syncStakerHistory({
      database,
      userAddress: USER,
      requiredFrom: '2026-09-01T00:10:00.000Z',
      requiredThrough: '2026-09-01T00:50:00.000Z',
      fetchPage: coveredFetch,
    })
    expect(calls).toBe(0)

    database.prepare(`DELETE FROM user_staking_history_scans`).run()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchPage = async (): Promise<NimiqTransaction[]> => {
      calls += 1
      await gate
      return []
    }
    const options = {
      database,
      userAddress: USER,
      requiredFrom: '2026-09-01T00:10:00.000Z',
      requiredThrough: '2026-09-01T00:50:00.000Z',
      now: () => Date.parse('2026-09-01T01:00:00.000Z'),
      fetchPage,
    }
    const first = syncStakerHistory(options)
    const second = syncStakerHistory(options)
    await Promise.resolve()
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
  })

  it('serializes one broader follow-up after a shared narrow scan', async () => {
    let calls = 0
    let releaseNarrow!: () => void
    const narrowGate = new Promise<void>((resolve) => { releaseNarrow = resolve })
    const transaction = incoming(StakingDataBuilder.setActiveStake(50n), {
      timestamp: Date.parse('2026-09-01T00:40:00.000Z'),
    })
    const fetchPage = async (): Promise<NimiqTransaction[]> => {
      calls += 1
      if (calls === 1) {
        await narrowGate
        return [transaction]
      }
      return []
    }
    const common = {
      database,
      userAddress: USER,
      requiredThrough: '2026-09-01T00:50:00.000Z',
      now: () => Date.parse('2026-09-01T01:00:00.000Z'),
      fetchPage,
    }

    const narrow = syncStakerHistory({
      ...common,
      requiredFrom: '2026-09-01T00:45:00.000Z',
    })
    const broadOne = syncStakerHistory({
      ...common,
      requiredFrom: '2026-09-01T00:00:00.000Z',
    })
    const broadTwo = syncStakerHistory({
      ...common,
      requiredFrom: '2026-09-01T00:00:00.000Z',
    })

    await Promise.resolve()
    releaseNarrow()
    await Promise.all([narrow, broadOne, broadTwo])

    expect(calls).toBe(2)
    expect(database.prepare(
      `SELECT covered_from, complete FROM user_staking_history_scans WHERE user_address = ?`,
    ).get(USER.replaceAll(' ', ''))).toEqual({
      covered_from: '1970-01-01T00:00:00.000Z',
      complete: 1,
    })
  })
})
