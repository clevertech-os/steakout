import 'dotenv/config'
import { openDatabase } from '../src/db.js'
import { runCanarySnapshotCycle } from '../src/probeSnapshots.js'

const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)

try {
  const result = await runCanarySnapshotCycle({
    database,
    rpcUrl: process.env.NIMIQ_RPC_URL,
  })
  if (result.errors > 0) process.exitCode = 1
} finally {
  database.close()
}
