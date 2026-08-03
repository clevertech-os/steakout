import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import { PayoutIndexer } from '../../../server/src/payoutIndexer.js'
import type { NimiqTransaction } from '../../../server/src/nimiq-rpc.js'
import { createMockRpc } from '../../helpers/mockRpc.js'

const address = 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001'

function transaction(hash: string, blockNumber: number): NimiqTransaction {
  return {
    hash,
    blockNumber,
    timestamp: 1_700_000_000_000 + blockNumber,
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
      database,
      rpcUrl: 'https://rpc.example.test',
      pageSize: 3,
      maxPages: 1,
    })

    await indexer.runCycle([address])
    await indexer.runCycle([address])

    expect(database.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 3 })
  })

  it('does not advance the cursor or retain rows when a later page fails', async () => {
    const database = openDatabase(':memory:')
    databases.push(database)
    database.prepare(`
      INSERT INTO index_cursors (source, address, last_block, last_tx_hash)
      VALUES (?, ?, ?, ?)
    `).run('rpc:main', address, 10, 'z'.repeat(64))
    const firstPage = [transaction('c'.repeat(64), 20), transaction('d'.repeat(64), 19)]
    const indexer = new PayoutIndexer({
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
    expect(database.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT last_block, last_tx_hash FROM index_cursors').get()).toEqual({
      last_block: 10,
      last_tx_hash: 'z'.repeat(64),
    })
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
})
