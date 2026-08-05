/**
 * Spike: infer lower tail of direct payout amounts from indexed reward outflows.
 *
 * Read-only against local SQLite (DATA_DIR). No RPC. Not a product feature.
 *
 * Usage (from repo root):
 *   DATA_DIR=./server/data npm run min-payout-inference --prefix server
 *   DATA_DIR=./server/data npm run min-payout-inference --prefix server -- --json
 *
 * See docs/spikes/min-payout-inference.md
 */
import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../src/db.js'
import { normalizeAddress } from '../src/addresses.js'
import {
  DEFAULT_RUN_WINDOW_MINUTES,
  groupPayoutRuns,
  type PayoutTransaction,
} from '../src/payoutClassifier.js'

const LUNA_PER_NIM = 100_000
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RESEARCH = join(
  MODULE_DIR,
  '../../docs/research/min-payout-amounts.json',
)

interface ResearchRow {
  validatorAddressCompact?: string
  minPayoutNim?: number | null
  minPayoutKind?: string | null
  confidence?: string | null
}

interface ValidatorRow {
  address: string
  name: string | null
  reward_address: string | null
  payout_type_declared: string | null
  is_listed: number
}

interface TxRow {
  hash: string
  from_address: string
  to_address: string
  value_luna: number
  block_number: number
  timestamp: string
  execution_result: string
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]!
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! * (hi - i) + sorted[hi]! * (i - lo)
}

function toNim(luna: number): number {
  return luna / LUNA_PER_NIM
}

function compactSafe(address: string): string | null {
  try {
    return normalizeAddress(address)
  } catch {
    return address.replace(/\s+/g, '').toUpperCase()
  }
}

function loadResearch(path: string): Map<string, ResearchRow> {
  const map = new Map<string, ResearchRow>()
  if (!existsSync(path)) return map
  try {
    const rows = JSON.parse(readFileSync(path, 'utf8')) as ResearchRow[]
    if (!Array.isArray(rows)) return map
    for (const row of rows) {
      const key = (row.validatorAddressCompact ?? '').replace(/\s+/g, '').toUpperCase()
      if (key) map.set(key, row)
    }
  } catch {
    // ignore
  }
  return map
}

function historyDepthDays(timestamps: string[]): number | null {
  if (timestamps.length < 2) return null
  const sorted = [...timestamps].sort()
  const a = Date.parse(sorted[0]!)
  const b = Date.parse(sorted[sorted.length - 1]!)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, (b - a) / 86_400_000)
}

function fracBelow(values: number[], thrNim: number): number | null {
  if (values.length === 0) return null
  return values.filter((v) => v < thrNim).length / values.length
}

function fmtNim(n: number | null, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 100) return n.toFixed(2)
  if (n >= 1) return n.toFixed(3)
  return n.toFixed(digits)
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function main(): void {
  const jsonOut = process.argv.includes('--json')
  const researchPath =
    process.env.MIN_PAYOUT_RESEARCH_PATH?.trim() || DEFAULT_RESEARCH
  const research = loadResearch(researchPath)
  const db = openDatabase()

  const validators = db
    .prepare(
      `SELECT address, name, reward_address, payout_type_declared, is_listed
       FROM validators
       WHERE reward_address IS NOT NULL AND reward_address != ''`,
    )
    .all() as ValidatorRow[]

  const rewardToValidator = new Map<string, ValidatorRow>()
  for (const v of validators) {
    const ra = compactSafe(v.reward_address ?? '')
    if (ra) rewardToValidator.set(ra, v)
  }

  const allTx = db
    .prepare(
      `SELECT hash, from_address, to_address, value_luna, block_number, timestamp, execution_result
       FROM transactions
       WHERE execution_result = 'ok' AND value_luna > 0`,
    )
    .all() as TxRow[]

  type Agg = {
    validator: ValidatorRow
    rewardCompact: string
    txs: PayoutTransaction[]
  }
  const byReward = new Map<string, Agg>()

  for (const row of allTx) {
    const from = compactSafe(row.from_address)
    if (!from) continue
    const validator = rewardToValidator.get(from)
    if (!validator) continue
    const to = compactSafe(row.to_address)
    const rewardC = from
    const valC = compactSafe(validator.address)
    // Exclude self / reward-to-validator loops from payout floor stats.
    if (to && (to === rewardC || to === valC)) continue

    let agg = byReward.get(from)
    if (!agg) {
      agg = { validator, rewardCompact: from, txs: [] }
      byReward.set(from, agg)
    }
    agg.txs.push({
      hash: row.hash,
      toAddress: row.to_address,
      valueLuna: row.value_luna,
      blockNumber: row.block_number,
      timestamp: row.timestamp,
      executionResult: 'ok',
    })
  }

  const rows = [...byReward.values()].map((agg) => {
    const amountsNim = agg.txs.map((t) => toNim(t.valueLuna)).sort((a, b) => a - b)
    const runs = groupPayoutRuns(agg.txs, {
      windowMinutes: DEFAULT_RUN_WINDOW_MINUTES,
    })
    const multiRuns = runs.filter((r) => r.recipientCount >= 3)
    const multiNim = multiRuns
      .flatMap((r) => {
        // Reconstruct per-tx amounts in run from hashes
        const set = new Set(r.txHashes)
        return agg.txs.filter((t) => set.has(t.hash)).map((t) => toNim(t.valueLuna))
      })
      .sort((a, b) => a - b)

    const key = compactSafe(agg.validator.address) ?? ''
    const decl = research.get(key)

    return {
      name: agg.validator.name,
      address: agg.validator.address,
      rewardAddress: agg.validator.reward_address,
      payoutType: agg.validator.payout_type_declared,
      listed: agg.validator.is_listed === 1,
      txCount: amountsNim.length,
      recipients: new Set(agg.txs.map((t) => compactSafe(t.toAddress) ?? t.toAddress))
        .size,
      runCount: runs.length,
      multiRecipientRunCount: multiRuns.length,
      minNim: amountsNim[0] ?? null,
      p5Nim: percentile(amountsNim, 0.05),
      p10Nim: percentile(amountsNim, 0.1),
      medianNim: percentile(amountsNim, 0.5),
      maxNim: amountsNim[amountsNim.length - 1] ?? null,
      multiMinNim: multiNim[0] ?? null,
      multiP5Nim: percentile(multiNim, 0.05),
      fracBelow1Nim: fracBelow(amountsNim, 1),
      fracBelow10Nim: fracBelow(amountsNim, 10),
      historyDepthDays: historyDepthDays(agg.txs.map((t) => t.timestamp)),
      declaredKind: decl?.minPayoutKind ?? null,
      declaredNim: decl?.minPayoutNim ?? null,
      declaredConfidence: decl?.confidence ?? null,
    }
  })

  rows.sort((a, b) => b.txCount - a.txCount)

  const payload = {
    generatedAt: new Date().toISOString(),
    dataDir: process.env.DATA_DIR ?? '(default)',
    researchPath,
    method: {
      source: 'transactions.from_address = validators.reward_address',
      filters: [
        'execution_result=ok',
        'value_luna>0',
        'exclude to_address in {reward, validator}',
      ],
      runWindowMinutes: DEFAULT_RUN_WINDOW_MINUTES,
      multiRecipientMin: 3,
      note: 'Inferred upper bound on fixed min threshold only if outflows are reward payouts. Not a registry declaration.',
    },
    coverage: {
      validatorsWithRewardAddress: validators.length,
      rewardAddressesWithOutboundTxs: rows.length,
      totalOutboundTxsAnalyzed: rows.reduce((s, r) => s + r.txCount, 0),
    },
    rows,
  }

  if (jsonOut) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  const lines: string[] = []
  lines.push('# Min-payout inference (local index)')
  lines.push('')
  lines.push(`Generated: ${payload.generatedAt}`)
  lines.push(
    `Coverage: ${payload.coverage.rewardAddressesWithOutboundTxs} reward addresses with outbound txs / ${payload.coverage.validatorsWithRewardAddress} with reward address; ${payload.coverage.totalOutboundTxsAnalyzed} txs analyzed.`,
  )
  lines.push('')
  lines.push(
    '| Validator | Type | n | rec | min NIM | p5 | p10 | multi-min | <1 NIM | <10 NIM | depth d | research |',
  )
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const r of rows) {
    const researchLabel =
      r.declaredKind == null
        ? '—'
        : r.declaredKind === 'fixed'
          ? `fixed ${r.declaredNim}`
          : r.declaredKind
    lines.push(
      `| ${r.name ?? r.address} | ${r.payoutType ?? '?'} | ${r.txCount} | ${r.recipients} | ${fmtNim(r.minNim)} | ${fmtNim(r.p5Nim)} | ${fmtNim(r.p10Nim)} | ${fmtNim(r.multiMinNim)} | ${fmtPct(r.fracBelow1Nim)} | ${fmtPct(r.fracBelow10Nim)} | ${r.historyDepthDays == null ? '—' : r.historyDepthDays.toFixed(1)} | ${researchLabel} |`,
    )
  }
  if (rows.length === 0) {
    lines.push('')
    lines.push('_No reward-address outflows in this database. Run the payout indexer first._')
  }
  lines.push('')
  lines.push(
    'Interpretation: min/p5 are **observed payment floors** (Inferred), not declared policy. See docs/spikes/min-payout-inference.md.',
  )
  process.stdout.write(`${lines.join('\n')}\n`)
}

main()
