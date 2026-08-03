import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import { configuredRewardAddresses, PayoutIndexer } from '../../../server/src/payoutIndexer.js'
import type { NimiqTransaction } from '../../../server/src/nimiq-rpc.js'
import { createMockRpc } from '../../helpers/mockRpc.js'

const address = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'

function transaction(
  hash: string,
  blockNumber: number,
  timestampMs = 1_700_000_000_000 + blockNumber,
): NimiqTransaction {
  return {
    hash,
    blockNumber,
    timestamp: timestampMs,
    from: address,
    to: address,
    value: 100,
    fee: 0,
    executionResult: true,
  }
}

describe('payout indexer', () => {
  const databases: Array<{ close: () => void }> = []
  const temporaryDirectories: string[] = []

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const database of databases.splice(0)) database.close()
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('deduplicates a repeated RPC page by transaction hash', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const rpc = createMockRpc({
      fixtures: { getTransactionsByAddress: 'rpc/p0-04-transactions-by-address-page-1-mainnet.json' },
    })
    vi.stubGlobal('fetch', rpc.fetch)
    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      rpcUrl: 'https://rpc.example.test',
      pageSize: 3,
      maxPages: 1,
    })

    await indexer.runCycle([address])
    await indexer.runCycle([address])

    expect(database.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 3 })
  })

  it('does not advance the cursor or retain rows when a later page fails (partial multi-page)', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    database.prepare(`
      INSERT INTO index_cursors (source, address, last_block, last_tx_hash)
      VALUES (?, ?, ?, ?)
    `).run('rpc:main', address, 10, 'z'.repeat(64))
    const firstPage = [transaction('c'.repeat(64), 20), transaction('d'.repeat(64), 19)]
    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      pageSize: 2,
      maxPages: 2,
      maxAttempts: 1,
      fetchTransactions: async (_address, _max, startAt) => {
        if (startAt === null) return firstPage
        throw new Error('fixture RPC failure')
      },
    })

    const [result] = await indexer.runCycle([address])

    expect(result?.errors).toHaveLength(1)
    expect(result?.cursorAdvanced).toBe(false)
    expect(result?.inserted).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT last_block, last_tx_hash FROM index_cursors').get()).toEqual({
      last_block: 10,
      last_tx_hash: 'z'.repeat(64),
    })
  })

  it('does not create or advance a cursor when the first page fails', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      pageSize: 2,
      maxPages: 2,
      maxAttempts: 1,
      fetchTransactions: async () => {
        throw new Error('fixture first-page RPC failure')
      },
    })

    const [result] = await indexer.runCycle([address])

    expect(result?.errors).toHaveLength(1)
    expect(result?.cursorAdvanced).toBe(false)
    expect(result?.inserted).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM index_cursors').get()).toEqual({ count: 0 })
  })

  it('does not advance the cursor on an empty page (no new data)', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    database.prepare(`
      INSERT INTO index_cursors (source, address, last_block, last_tx_hash)
      VALUES (?, ?, ?, ?)
    `).run('rpc:main', address, 42, 'a'.repeat(64))
    const indexer = new PayoutIndexer({
      backfillDays: 0,
      database,
      pageSize: 2,
      maxPages: 1,
      fetchTransactions: async () => [],
    })

    const [result] = await indexer.runCycle([address])

    expect(result?.errors).toEqual([])
    expect(result?.cursorAdvanced).toBe(false)
    expect(result?.fetched).toBe(0)
    expect(result?.inserted).toBe(0)
    expect(database.prepare('SELECT last_block, last_tx_hash FROM index_cursors').get()).toEqual({
      last_block: 42,
      last_tx_hash: 'a'.repeat(64),
    })
  })

  it('advances the cursor to the newest tx after a successful full-page ingest', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const page = [
      transaction('b'.repeat(64), 30),
      transaction('a'.repeat(64), 29),
    ]
    const indexer = new PayoutIndexer({
      database,
      pageSize: 2,
      maxPages: 1,
      // Disable day floor so synthetic 2023-era timestamps still insert.
      backfillDays: 0,
      fetchTransactions: async () => page,
    })

    const [result] = await indexer.runCycle([address])

    expect(result?.errors).toEqual([])
    expect(result?.cursorAdvanced).toBe(true)
    expect(result?.inserted).toBe(2)
    expect(database.prepare('SELECT last_block, last_tx_hash FROM index_cursors').get()).toEqual({
      last_block: 30,
      last_tx_hash: 'b'.repeat(64),
    })
  })

  it('stops a deep walk at INDEXER_BACKFILL_DAYS (keeps only ~30d window)', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    const now = Date.parse('2026-08-03T12:00:00.000Z')
    const day = 24 * 60 * 60 * 1000
    const page = [
      transaction('n'.repeat(64), 300, now - 1 * day), // 1 day ago — keep
      transaction('m'.repeat(64), 200, now - 10 * day), // 10 days — keep
      transaction('o'.repeat(64), 100, now - 40 * day), // 40 days — stop, exclude
    ]
    const indexer = new PayoutIndexer({
      database,
      pageSize: 10,
      maxPages: 5,
      backfillDays: 30,
      nowMs: () => now,
      fetchTransactions: async () => page,
    })

    const [result] = await indexer.runCycle([address])

    expect(result?.errors).toEqual([])
    expect(result?.inserted).toBe(2)
    const hashes = database
      .prepare('SELECT hash FROM transactions ORDER BY block_number DESC')
      .all() as Array<{ hash: string }>
    expect(hashes.map((r) => r.hash)).toEqual(['n'.repeat(64), 'm'.repeat(64)])
  })

  it('recovers the cursor and advances it to the newest transaction after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'steakout-indexer-'))
    temporaryDirectories.push(directory)
    const filename = join(directory, 'steakout.sqlite')
    const firstPage = [transaction('e'.repeat(64), 20), transaction('f'.repeat(64), 19)]
    const secondPage = [transaction('g'.repeat(64), 21), transaction('e'.repeat(64), 20)]

    const firstDatabase = openDatabase(filename)
    databases.push(firstDatabase)
    const firstIndexer = new PayoutIndexer({
      backfillDays: 0,
      database: firstDatabase,
      pageSize: 2,
      maxPages: 1,
      fetchTransactions: async () => firstPage,
    })
    await firstIndexer.runCycle([address])
    firstDatabase.close()
    databases.splice(databases.indexOf(firstDatabase), 1)

    const secondDatabase = openDatabase(filename)
    databases.push(secondDatabase)
    const secondIndexer = new PayoutIndexer({
      backfillDays: 0,
      database: secondDatabase,
      pageSize: 2,
      maxPages: 1,
      fetchTransactions: async (_address, _max, startAt) => {
        expect(startAt).toBeNull()
        return secondPage
      },
    })
    await secondIndexer.runCycle([address])

    expect(secondDatabase.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 3 })
    expect(secondDatabase.prepare('SELECT last_block, last_tx_hash FROM index_cursors').get()).toEqual({
      last_block: 21,
      last_tx_hash: 'g'.repeat(64),
    })
  })

  it('merges env seed addresses with listed validator reward addresses', () => {
    const previous = {
      seeds: process.env.INDEXER_REWARD_ADDRESSES,
      only: process.env.INDEXER_REWARD_ADDRESSES_ONLY,
      listed: process.env.INDEXER_LISTED_ONLY,
    }
    try {
      process.env.INDEXER_REWARD_ADDRESSES = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'
      delete process.env.INDEXER_REWARD_ADDRESSES_ONLY
      process.env.INDEXER_LISTED_ONLY = 'true'

      const database = openDatabase(':memory:')
      databases.push(database)
      database
        .prepare(
          `INSERT INTO validators (
            address, name, reward_address, is_listed, registry_updated_at
          ) VALUES
            ('NQ11 1111 1111 1111 1111 1111 1111 1111 1111', 'Listed', 'NQ22 2222 2222 2222 2222 2222 2222 2222 2222', 1, datetime('now')),
            ('NQ33 3333 3333 3333 3333 3333 3333 3333 3333', 'Unlisted', 'NQ44 4444 4444 4444 4444 4444 4444 4444 4444', 0, datetime('now'))`,
        )
        .run()

      const addresses = configuredRewardAddresses(database)
      expect(addresses).toEqual(
        expect.arrayContaining([
          'NQ00 0000 0000 0000 0000 0000 0000 0000 0001',
          'NQ22 2222 2222 2222 2222 2222 2222 2222 2222',
        ]),
      )
      expect(addresses).not.toContain('NQ44 4444 4444 4444 4444 4444 4444 4444 4444')

      process.env.INDEXER_LISTED_ONLY = 'false'
      const all = configuredRewardAddresses(database)
      expect(all).toContain('NQ44 4444 4444 4444 4444 4444 4444 4444 4444')
    } finally {
      if (previous.seeds === undefined) delete process.env.INDEXER_REWARD_ADDRESSES
      else process.env.INDEXER_REWARD_ADDRESSES = previous.seeds
      if (previous.only === undefined) delete process.env.INDEXER_REWARD_ADDRESSES_ONLY
      else process.env.INDEXER_REWARD_ADDRESSES_ONLY = previous.only
      if (previous.listed === undefined) delete process.env.INDEXER_LISTED_ONLY
      else process.env.INDEXER_LISTED_ONLY = previous.listed
    }
  })
})
