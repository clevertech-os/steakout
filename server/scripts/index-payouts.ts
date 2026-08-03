import 'dotenv/config'
import { openDatabase } from '../src/db.js'
import {
  configuredRewardAddresses,
  PayoutIndexer,
} from '../src/payoutIndexer.js'

const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)

try {
  const indexer = new PayoutIndexer({
    database,
    rpcUrl: process.env.NIMIQ_RPC_URL,
  })
  const addresses = configuredRewardAddresses(database)
  if (addresses.length === 0) {
    throw new Error('No reward addresses configured in INDEXER_REWARD_ADDRESSES or validators')
  }
  const results = await indexer.runCycle(addresses)
  if (results.some((result) => result.errors.length > 0)) process.exitCode = 1
} finally {
  database.close()
}
