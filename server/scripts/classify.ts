import 'dotenv/config'
import { openDatabase } from '../src/db.js'
import {
  DEFAULT_RUN_WINDOW_MINUTES,
  groupPayoutRuns,
  normalizeScheduleHours,
  type PayoutRun,
  type PayoutTransaction,
} from '../src/payoutClassifier.js'

interface ClassifyOptions {
  rewardAddress: string
  validatorName: string | null
  validatorAddress: string | null
  declaredSchedule: string | null
  windowMinutes: number
}

interface TransactionRow {
  hash: string
  to_address: string
  value_luna: number
  block_number: number
  timestamp: string
  execution_result: 'ok' | 'failed' | 'reverted'
}

function parseArgs(argv: readonly string[]): ClassifyOptions {
  const options: ClassifyOptions = {
    rewardAddress: '',
    validatorName: null,
    validatorAddress: null,
    declaredSchedule: null,
    windowMinutes: DEFAULT_RUN_WINDOW_MINUTES,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    switch (flag) {
      case '--reward-address':
        options.rewardAddress = value ?? ''
        index += 1
        break
      case '--validator-name':
        options.validatorName = value ?? null
        index += 1
        break
      case '--validator-address':
        options.validatorAddress = value ?? null
        index += 1
        break
      case '--declared-schedule':
        options.declaredSchedule = value ?? null
        index += 1
        break
      case '--window-minutes':
        options.windowMinutes = Number(value)
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }
  if (options.rewardAddress.trim() === '') {
    throw new Error('Usage: classify --reward-address <address> [--validator-name <name>] [--validator-address <address>] [--declared-schedule "<raw>"] [--window-minutes <n>]')
  }
  if (!Number.isFinite(options.windowMinutes) || options.windowMinutes <= 0) {
    throw new Error('--window-minutes must be a positive number')
  }
  return options
}

function explorerUrl(hash: string): string {
  return `https://nimiq.watch/#${hash.replace(/^0x/i, '').toUpperCase()}`
}

function shortHash(hash: string): string {
  return `[${hash.slice(0, 12)}…](${explorerUrl(hash)})`
}

function hoursBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 3_600_000
}

function renderRunTable(runs: readonly PayoutRun[]): string[] {
  const lines = [
    '| # | Run start (UTC) | Run end (UTC) | Txs | Recipients | Blocks | First tx | Last tx |',
    '|--:|---|---|---:|---:|---|---|---|',
  ]
  runs.forEach((run, index) => {
    lines.push(
      `| ${index + 1} | ${run.startedAt} | ${run.endedAt} | ${run.txCount} | ${run.recipientCount} | ${run.firstBlock}–${run.lastBlock} | ${shortHash(run.firstTxHash)} | ${shortHash(run.lastTxHash)} |`,
    )
  })
  return lines
}

const options = parseArgs(process.argv.slice(2))
const databasePath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR.replace(/\/$/, '')}/steakout.sqlite`
  : undefined
const database = openDatabase(databasePath)

try {
  const rows = database.prepare(`
    SELECT hash, to_address, value_luna, block_number, timestamp, execution_result
    FROM transactions
    WHERE from_address = ?
    ORDER BY timestamp ASC, hash ASC
  `).all(options.rewardAddress) as TransactionRow[]

  const transactions: PayoutTransaction[] = rows.map((row) => ({
    hash: row.hash,
    toAddress: row.to_address,
    valueLuna: row.value_luna,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    executionResult: row.execution_result,
  }))

  const span = database.prepare(`
    SELECT MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen, COUNT(*) AS total
    FROM transactions
    WHERE from_address = ? OR to_address = ?
  `).get(options.rewardAddress, options.rewardAddress) as {
    first_seen: string | null
    last_seen: string | null
    total: number
  }
  const cursor = database.prepare(`
    SELECT source, last_block, updated_at FROM index_cursors WHERE address = ?
  `).get(options.rewardAddress) as { source: string; last_block: number; updated_at: string } | undefined

  const executed = transactions.filter((transaction) => transaction.executionResult === 'ok')
  const runs = groupPayoutRuns(transactions, { windowMinutes: options.windowMinutes })
  const intervalHours = normalizeScheduleHours(options.declaredSchedule)

  const output: string[] = []
  output.push('# Payout classification report (local spike output)')
  output.push('')
  output.push('Observed chain data only. No fee, intent, or payout-purpose judgment is made or implied.')
  output.push('')
  output.push(`- Validator: ${options.validatorName ?? '(unnamed)'}`)
  if (options.validatorAddress) output.push(`- Validator address: \`${options.validatorAddress}\``)
  output.push(`- Indexed reward address: \`${options.rewardAddress}\``)
  output.push(`- Declared payout schedule (registry declaration): ${options.declaredSchedule ? `"${options.declaredSchedule}"` : '(not provided)'}`)
  output.push(`- Schedule normalization: ${intervalHours === null ? 'cannot be normalized — raw observations only' : `every ${intervalHours} hour(s)`}`)
  output.push(`- Run window: ${options.windowMinutes} minutes (gap-based sliding window)`)
  output.push(`- Indexed transactions touching the reward address: ${span.total}`)
  output.push(`- Indexed outbound transactions (executed): ${executed.length}`)
  if (span.first_seen && span.last_seen) {
    output.push(`- Indexed data span: ${span.first_seen} → ${span.last_seen} (${hoursBetween(span.first_seen, span.last_seen).toFixed(1)} hours)`)
  }
  if (cursor) {
    output.push(`- Index freshness: block ${cursor.last_block} via \`${cursor.source}\`, cursor updated ${cursor.updated_at}`)
  }
  output.push(`- Report generated at: ${new Date().toISOString()} (from local DB only, no refetch)`)
  output.push('')

  if (runs.length === 0) {
    output.push('## Observed runs')
    output.push('')
    output.push('No executed outbound transactions observed in the indexed data. Insufficient data.')
  } else {
    output.push(`## Observed runs (${runs.length})`)
    output.push('')
    output.push(...renderRunTable(runs))
    output.push('')

    const startIntervals = runs.slice(1).map((run, index) => hoursBetween(runs[index].startedAt, run.startedAt).toFixed(2))
    if (startIntervals.length > 0) {
      output.push(`Inter-run start intervals (hours): ${startIntervals.join(', ')}`)
      output.push('')
    }

    const repeatedRecipientRuns = runs.filter((run) => run.recipientCount < run.txCount)
    if (repeatedRecipientRuns.length > 0) {
      output.push(`Runs containing repeated payments to the same recipient address: ${repeatedRecipientRuns.length} of ${runs.length} (observed grouping only; no intent inferred).`)
      output.push('')
    }

    output.push('## Expected vs observed windows')
    output.push('')
    if (intervalHours === null || !span.first_seen || !span.last_seen) {
      output.push('Schedule cannot be normalized; expected-window comparison is not applicable. Raw observed runs are shown above.')
    } else {
      const windowStart = runs[0].startedAt
      const windowEnd = span.last_seen
      const spanHours = hoursBetween(windowStart, windowEnd)
      const fullWindows = Math.max(0, Math.floor(spanHours / intervalHours))
      const observedWindowIndexes = new Set(
        runs
          .map((run) => Math.floor(hoursBetween(windowStart, run.startedAt) / intervalHours))
          .filter((windowIndex) => windowIndex < fullWindows),
      )
      const trailingRuns = runs.filter(
        (run) => Math.floor(hoursBetween(windowStart, run.startedAt) / intervalHours) >= fullWindows,
      ).length
      output.push(`- Analysis window: ${windowStart} → ${windowEnd} (${spanHours.toFixed(1)} hours, anchored at first observed run)`)
      output.push(`- Fully elapsed ${intervalHours}-hour windows: ${fullWindows}`)
      output.push(`- Fully elapsed windows containing at least one observed run: ${observedWindowIndexes.size}`)
      output.push(`- Observed runs in the trailing partial window (not yet due): ${trailingRuns}`)
      output.push(`- Total observed runs: ${runs.length}`)
      output.push('')
      output.push(`History depth is ${(spanHours / 24).toFixed(1)} days. Per docs/METHODOLOGY.md §3, fewer than 7 days of indexed history is \`insufficient data\`; no observation status label is assigned by this report.`)
    }
  }

  console.log(output.join('\n'))
} finally {
  database.close()
}
