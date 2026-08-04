/**
 * Operator audit: listed validators × reward address × outbound tx index.
 *
 * Usage (from repo root or server/):
 *   DATA_DIR=./data npx tsx server/scripts/audit-reward-addresses.ts
 *   npm run audit:rewards --prefix server
 *
 * Always exits 0 (audit tool). Does not call RPC or store secrets.
 */
import 'dotenv/config'
import { openDatabase } from '../src/db.js'
import { summarizeRewardAddressGaps } from '../src/diagnostics.js'

const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)

interface ListedRow {
  name: string | null
  address: string
  reward_address: string | null
  payout_type_declared: string | null
  payout_schedule_declared: string | null
}

try {
  const listed = database.prepare(`
    SELECT name, address, reward_address, payout_type_declared, payout_schedule_declared
    FROM validators
    WHERE is_listed = 1
    ORDER BY name ASC, address ASC
  `).all() as ListedRow[]

  const txStats = database.prepare(`
    SELECT
      COUNT(*) AS tx_count,
      MIN(timestamp) AS earliest,
      MAX(timestamp) AS latest
    FROM transactions
    WHERE from_address = ?
       OR replace(upper(from_address), ' ', '') = replace(upper(?), ' ', '')
  `)

  const cursorExists = database.prepare(`
    SELECT 1 AS ok FROM index_cursors
    WHERE address = ?
       OR replace(upper(address), ' ', '') = replace(upper(?), ' ', '')
    LIMIT 1
  `)

  console.log(`# Reward-address audit — listed validators (${listed.length})`)
  console.log(`# database: ${databasePath ?? '(default openDatabase path)'}`)
  console.log('')

  for (const row of listed) {
    const reward = row.reward_address?.trim() || null
    let outboundTxCount = 0
    let earliest: string | null = null
    let latest: string | null = null
    let hasCursor = false

    if (reward) {
      const stats = txStats.get(reward, reward) as {
        tx_count: number
        earliest: string | null
        latest: string | null
      }
      outboundTxCount = Number(stats.tx_count) || 0
      earliest = stats.earliest
      latest = stats.latest
      hasCursor = Boolean(cursorExists.get(reward, reward))
    }

    console.log(
      JSON.stringify({
        name: row.name,
        address: row.address,
        reward_address: reward,
        payout_type: row.payout_type_declared,
        schedule: row.payout_schedule_declared,
        outbound_tx_count: outboundTxCount,
        earliest_tx: earliest,
        latest_tx: latest,
        index_cursor: hasCursor,
      }),
    )
  }

  const gaps = summarizeRewardAddressGaps(database)
  console.log('')
  console.log('# Summary (same shape as GET /api/diagnostics rewardAddressGaps)')
  console.log(JSON.stringify(gaps, null, 2))
} finally {
  database.close()
}

// Audit tools always exit 0 so CI/shell pipelines treat output as informational.
process.exitCode = 0
