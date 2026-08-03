import Database from 'better-sqlite3'
import { classifyObservationsForRewardAddress } from './observationScoring.js'
import { fetchTransactionsByAddress, type NimiqTransaction } from './nimiq-rpc.js'

const MAX_RPC_PAGE_SIZE = 500
const DEFAULT_PAGE_SIZE = 500
/**
 * Safety cap on pages per address (newest→oldest). Real stop for history is
 * usually INDEXER_BACKFILL_DAYS; pages prevent runaway walks on busy addresses.
 */
const DEFAULT_MAX_PAGES = 300
/** Prefer ~30 days of reward-address history (SPEC / schedule grading). */
const DEFAULT_BACKFILL_DAYS = 30
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_MS = 2_000
const DEFAULT_RETRY_MAX_MS = 5 * 60_000
const DEFAULT_ADDRESS_CONCURRENCY = 1

export interface NormalizedTransaction {
  hash: string
  fromAddress: string
  toAddress: string
  valueLuna: number
  feeLuna: number
  blockNumber: number
  timestamp: string
  executionResult: 'ok' | 'failed' | 'reverted'
  rawJson: string
}

export interface IndexCursor {
  source: string
  address: string
  lastBlock: number
  lastTxHash: string | null
}

export interface PayoutIndexerOptions {
  database: Database.Database
  source?: string
  rpcUrl?: string
  pageSize?: number
  maxPages?: number
  /** Concurrent addresses per cycle (public RPC rate limits favor 1). */
  addressConcurrency?: number
  /** Hard block floor (optional). Prefer backfillDays for time-based depth. */
  backfillFloorBlock?: number
  /**
   * How far back to walk on a deep pass (no cursor, or after rebackfill).
   * 0 = disabled (page budget only). Default 30.
   */
  backfillDays?: number
  /** Clock for backfillDays (tests). */
  nowMs?: () => number
  maxAttempts?: number
  retryBaseMs?: number
  retryMaxMs?: number
  retryJitter?: number
  sleep?: (milliseconds: number) => Promise<void>
  fetchTransactions?: (
    address: string,
    max: number,
    startAt: string | null,
    rpcUrl?: string,
  ) => Promise<NimiqTransaction[]>
  getCurrentBlock?: () => Promise<number>
  logger?: (line: string) => void
}

export interface AddressIndexResult {
  address: string
  fetched: number
  inserted: number
  pages: number
  cursorAdvanced: boolean
  errors: string[]
  milliseconds: number
}

/** Last-cycle aggregate stats (no per-address PII). */
export interface IndexerLastCycleStats {
  addressCount: number
  fetched: number
  inserted: number
  errorCount: number
  durationMs: number
}

export interface IndexerCycleProgress {
  /** True while a runCycle is in flight. */
  running: boolean
  startedAt: string | null
  addressesTotal: number
  addressesDone: number
  fetched: number
  inserted: number
  errorCount: number
}

export interface IndexerHealth {
  lastRunAt: string | null
  addressesIndexed: number
  lagBlocks: number | null
  /** Total successful runCycle invocations since process start. */
  cycleCount: number
  lastCycle: IndexerLastCycleStats | null
  /** Live progress for the cycle currently running (null when idle). */
  currentCycle: IndexerCycleProgress | null
}

interface CursorRow {
  source: string
  address: string
  last_block: number
  last_tx_hash: string | null
}

interface PendingPage {
  transactions: NormalizedTransaction[]
  fetched: number
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`RPC transaction ${field} is malformed`)
  }
  return value
}

function transactionTimestamp(value: unknown): string {
  const timestamp = integer(value, 'timestamp')
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) throw new Error('RPC transaction timestamp is malformed')
  return date.toISOString()
}

export function normalizeTransaction(transaction: NimiqTransaction): NormalizedTransaction {
  const hash = transaction.hash.trim()
  const fromAddress = transaction.from.trim()
  const toAddress = transaction.to.trim()
  if (!hash || !fromAddress || !toAddress) throw new Error('RPC transaction address or hash is empty')

  const blockNumber = transaction.blockNumber ?? transaction.validityStartHeight
  return {
    hash,
    fromAddress,
    toAddress,
    valueLuna: integer(transaction.value, 'value'),
    feeLuna: integer(transaction.fee, 'fee'),
    blockNumber: integer(blockNumber, 'blockNumber'),
    timestamp: transactionTimestamp(transaction.timestamp),
    executionResult: transaction.executionResult ? 'ok' : 'failed',
    rawJson: JSON.stringify(transaction),
  }
}

function cursorReached(transaction: NormalizedTransaction, cursor: IndexCursor): boolean {
  if (transaction.blockNumber < cursor.lastBlock) return true
  return transaction.blockNumber === cursor.lastBlock && (
    cursor.lastTxHash === null || transaction.hash === cursor.lastTxHash
  )
}

async function retry<T>(operation: () => Promise<T>, options: PayoutIndexerOptions): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelay = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const maxDelay = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS
  const jitter = options.retryJitter ?? 0.2
  const wait = options.sleep ?? defaultSleep

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === maxAttempts) throw error
      const exponential = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1))
      const randomized = exponential * (1 + Math.random() * jitter)
      await wait(Math.round(randomized))
    }
  }

  throw new Error('RPC retry loop exhausted')
}

export class PayoutIndexer {
  private readonly database: Database.Database
  private readonly source: string
  private readonly rpcUrl: string | undefined
  private readonly pageSize: number
  private readonly maxPages: number
  private readonly addressConcurrency: number
  private readonly backfillFloorBlock: number
  private readonly backfillDays: number
  private readonly nowMs: () => number
  private readonly fetchTransactions: NonNullable<PayoutIndexerOptions['fetchTransactions']>
  private readonly logger: (line: string) => void
  private readonly getCurrentBlock: (() => Promise<number>) | undefined
  private readonly retryOptions: PayoutIndexerOptions
  private health: IndexerHealth = {
    lastRunAt: null,
    addressesIndexed: 0,
    lagBlocks: null,
    cycleCount: 0,
    lastCycle: null,
    currentCycle: null,
  }

  public constructor(options: PayoutIndexerOptions) {
    this.database = options.database
    this.source = options.source ?? `rpc:${process.env.NIMIQ_NETWORK ?? 'main'}`
    this.rpcUrl = options.rpcUrl
    this.pageSize = Math.min(Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE), MAX_RPC_PAGE_SIZE)
    this.maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES)
    this.addressConcurrency = Math.min(
      4,
      Math.max(1, options.addressConcurrency ?? DEFAULT_ADDRESS_CONCURRENCY),
    )
    this.backfillFloorBlock = Math.max(0, options.backfillFloorBlock ?? 0)
    this.backfillDays = Math.max(0, options.backfillDays ?? DEFAULT_BACKFILL_DAYS)
    this.nowMs = options.nowMs ?? Date.now
    this.fetchTransactions = options.fetchTransactions ?? fetchTransactionsByAddress
    this.getCurrentBlock = options.getCurrentBlock
    this.logger = options.logger ?? ((line) => console.log(line))
    this.retryOptions = options
  }

  /** ISO cut-off for deep walks: txs older than this are not ingested. */
  private backfillFloorIso(): string | null {
    if (this.backfillDays <= 0) return null
    const floorMs = this.nowMs() - this.backfillDays * 24 * 60 * 60 * 1000
    return new Date(floorMs).toISOString()
  }

  public getHealth(): IndexerHealth {
    return {
      ...this.health,
      currentCycle: this.health.currentCycle ? { ...this.health.currentCycle } : null,
      lastCycle: this.health.lastCycle ? { ...this.health.lastCycle } : null,
    }
  }

  public async runCycle(addresses: readonly string[]): Promise<AddressIndexResult[]> {
    const cycleStarted = performance.now()
    const uniqueAddresses = [...new Set(addresses.map((address) => address.trim()).filter(Boolean))]
    const startedAt = new Date().toISOString()
    this.health = {
      ...this.health,
      currentCycle: {
        running: true,
        startedAt,
        addressesTotal: uniqueAddresses.length,
        addressesDone: 0,
        fetched: 0,
        inserted: 0,
        errorCount: 0,
      },
    }
    this.logger(
      JSON.stringify({
        indexer: 'cycle-start',
        addresses: uniqueAddresses.length,
        maxPages: this.maxPages,
        pageSize: this.pageSize,
        addressConcurrency: this.addressConcurrency,
        backfillDays: this.backfillDays,
      }),
    )
    const results = await mapWithConcurrency(uniqueAddresses, this.addressConcurrency, async (address) => {
      const result = await this.runAddress(address)
      const cur = this.health.currentCycle
      if (cur) {
        this.health = {
          ...this.health,
          currentCycle: {
            ...cur,
            addressesDone: cur.addressesDone + 1,
            fetched: cur.fetched + result.fetched,
            inserted: cur.inserted + result.inserted,
            errorCount: cur.errorCount + result.errors.length,
          },
        }
      }
      return result
    })
    const inserted = results.reduce((sum, row) => sum + row.inserted, 0)
    const fetched = results.reduce((sum, row) => sum + row.fetched, 0)
    const errorCount = results.flatMap((row) => row.errors).length
    const durationMs = Math.round(performance.now() - cycleStarted)
    this.health = {
      lastRunAt: new Date().toISOString(),
      addressesIndexed: results.filter((result) => result.errors.length === 0).length,
      lagBlocks: await this.calculateLagBlocks(),
      cycleCount: this.health.cycleCount + 1,
      lastCycle: {
        addressCount: uniqueAddresses.length,
        fetched,
        inserted,
        errorCount,
        durationMs,
      },
      currentCycle: null,
    }
    this.logger(
      JSON.stringify({
        indexer: 'cycle-end',
        lastRunAt: this.health.lastRunAt,
        addressesIndexed: this.health.addressesIndexed,
        lagBlocks: this.health.lagBlocks,
        cycleCount: this.health.cycleCount,
        fetched,
        inserted,
        errors: errorCount,
        durationMs,
      }),
    )
    return results
  }

  public async runAddress(address: string): Promise<AddressIndexResult> {
    const startedAt = performance.now()
    const result: AddressIndexResult = {
      address,
      fetched: 0,
      inserted: 0,
      pages: 0,
      cursorAdvanced: false,
      errors: [],
      milliseconds: 0,
    }

    try {
      const cursor = this.readCursor(address)
      const pages: PendingPage[] = []
      let startAt: string | null = null
      let nextCursor: IndexCursor | null = null
      const seenPageCursors = new Set<string>()
      // Time floor only on deep walks (no cursor). Incremental cycles stop at cursor.
      const timeFloorIso = cursor == null ? this.backfillFloorIso() : null

      for (let pageNumber = 0; pageNumber < this.maxPages; pageNumber += 1) {
        const rawPage = await retry(
          () => this.fetchTransactions(address, this.pageSize, startAt, this.rpcUrl),
          this.retryOptions,
        )
        result.pages += 1
        result.fetched += rawPage.length
        if (rawPage.length === 0) break

        const normalizedPage = rawPage.map(normalizeTransaction)
        const pageTransactions: NormalizedTransaction[] = []
        let boundaryReached = false
        let floorReached = false

        for (const transaction of normalizedPage) {
          if (transaction.blockNumber < this.backfillFloorBlock) {
            floorReached = true
            break
          }
          if (
            timeFloorIso != null &&
            transaction.timestamp < timeFloorIso
          ) {
            // Newest-first: older than target window → stop this address.
            floorReached = true
            break
          }
          if (cursor && startAt === null && cursorReached(transaction, cursor)) {
            boundaryReached = true
            break
          }
          pageTransactions.push(transaction)
        }

        pages.push({ transactions: pageTransactions, fetched: rawPage.length })
        if (pageTransactions.length > 0 && startAt === null) {
          // RPC pages are newest-first. Keep the first new transaction as the watermark.
          const newest = pageTransactions[0]
          nextCursor = {
            source: this.source,
            address,
            lastBlock: newest.blockNumber,
            lastTxHash: newest.hash,
          }
        }

        if (floorReached) break
        if (cursor && boundaryReached) break
        // Full page of txs all older than floor → already broke; empty pageTransactions
        // after floor on first row still needs to stop pagination.
        if (pageTransactions.length === 0 && floorReached) break
        const lastRaw = normalizedPage[normalizedPage.length - 1]
        const nextStartAt = lastRaw.hash
        if (seenPageCursors.has(nextStartAt)) break
        seenPageCursors.add(nextStartAt)
        startAt = nextStartAt
        // If every kept tx filled the page but we hit floor mid-page, we already broke.
        // If page was fully older than floor, pageTransactions empty and floorReached.
        if (pageTransactions.length === 0 && !boundaryReached) {
          // Empty of new txs without cursor boundary usually means all filtered by floor.
          if (floorReached || timeFloorIso != null) break
        }
      }

      const commit = this.database.transaction(() => {
        const insert = this.database.prepare(`
          INSERT OR IGNORE INTO transactions (
            hash, from_address, to_address, value_luna, fee_luna, block_number,
            timestamp, execution_result, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        let inserted = 0
        for (const page of pages) {
          for (const transaction of page.transactions) {
            inserted += insert.run(
              transaction.hash,
              transaction.fromAddress,
              transaction.toAddress,
              transaction.valueLuna,
              transaction.feeLuna,
              transaction.blockNumber,
              transaction.timestamp,
              transaction.executionResult,
              transaction.rawJson,
            ).changes
          }
        }
        if (nextCursor) {
          this.database.prepare(`
            INSERT INTO index_cursors (source, address, last_block, last_tx_hash, updated_at)
            VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ON CONFLICT(source, address) DO UPDATE SET
              last_block = excluded.last_block,
              last_tx_hash = excluded.last_tx_hash,
              updated_at = excluded.updated_at
          `).run(nextCursor.source, nextCursor.address, nextCursor.lastBlock, nextCursor.lastTxHash)
        }
        return inserted
      })
      result.inserted = commit()
      result.cursorAdvanced = nextCursor !== null && (
        cursor === null || cursor.lastBlock !== nextCursor.lastBlock || cursor.lastTxHash !== nextCursor.lastTxHash
      )

      // DATA-MODEL.md §2 step 6: classify after successful ingest
      // (runs + adherence + recipient coverage). Skips when no validators row
      // exists (FK); never invents a validator or staker set.
      const { runs: classification, adherence, coverage } = classifyObservationsForRewardAddress(
        this.database,
        address,
      )
      this.logger(JSON.stringify({
        address,
        classify: {
          skipped: classification.skipped,
          skipReason: classification.skipReason,
          validatorAddress: classification.validatorAddress,
          runCount: classification.runCount,
          inserted: classification.inserted,
          updated: classification.updated,
          removed: classification.removed,
          calcVersion: classification.calcVersion,
          adherenceStatus: adherence?.status ?? null,
          coverageCount: coverage?.coverageCount ?? null,
        },
      }))
    } catch (error) {
      result.errors.push(errorMessage(error))
    }

    result.milliseconds = Math.round(performance.now() - startedAt)
    this.logger(JSON.stringify({
      address,
      fetched: result.fetched,
      inserted: result.inserted,
      ms: result.milliseconds,
      errors: result.errors.length,
    }))
    return result
  }

  private readCursor(address: string): IndexCursor | null {
    const row = this.database.prepare(`
      SELECT source, address, last_block, last_tx_hash
      FROM index_cursors WHERE source = ? AND address = ?
    `).get(this.source, address) as CursorRow | undefined
    if (!row) return null
    return {
      source: row.source,
      address: row.address,
      lastBlock: row.last_block,
      lastTxHash: row.last_tx_hash,
    }
  }

  private async calculateLagBlocks(): Promise<number | null> {
    if (!this.getCurrentBlock) return null
    try {
      const currentBlock = await this.getCurrentBlock()
      const row = this.database.prepare(`
        SELECT MIN(last_block) AS oldest_block
        FROM index_cursors WHERE source = ?
      `).get(this.source) as { oldest_block: number | null }
      return row.oldest_block === null ? null : Math.max(0, currentBlock - row.oldest_block)
    } catch {
      return null
    }
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  const runWorker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker))
  return results
}

/**
 * Reward addresses the payout indexer should poll.
 *
 * - Always includes rows from `validators` with a non-empty `reward_address`
 *   (populated by registry sync + RPC resolve).
 * - Optionally merges `INDEXER_REWARD_ADDRESSES` (comma-separated) as seeds so
 *   a deploy can start indexing before the first sync finishes.
 * - When `INDEXER_LISTED_ONLY=true` (default), only listed validators' rewards
 *   are taken from the DB (SPEC §8.8: start with listed; expand later).
 * - Env-only mode (legacy): set `INDEXER_REWARD_ADDRESSES_ONLY=true` to ignore
 *   the DB and use the env list alone (useful for spikes).
 */
export function configuredRewardAddresses(database: Database.Database): string[] {
  const envList = (process.env.INDEXER_REWARD_ADDRESSES ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)

  if (process.env.INDEXER_REWARD_ADDRESSES_ONLY === 'true') {
    return [...new Set(envList)]
  }

  const listedOnly = process.env.INDEXER_LISTED_ONLY !== 'false'
  const rows = database
    .prepare(
      listedOnly
        ? `
          SELECT reward_address FROM validators
          WHERE reward_address IS NOT NULL AND trim(reward_address) <> ''
            AND is_listed = 1
        `
        : `
          SELECT reward_address FROM validators
          WHERE reward_address IS NOT NULL AND trim(reward_address) <> ''
        `,
    )
    .all() as Array<{ reward_address: string }>

  const fromDb = rows.map((row) => row.reward_address.trim()).filter(Boolean)
  return [...new Set([...envList, ...fromDb])]
}

/** Clear address cursors so the next cycle re-walks history newest→oldest (INSERT OR IGNORE keeps txs). */
export function clearIndexCursors(database: Database.Database): number {
  const result = database.prepare('DELETE FROM index_cursors').run()
  return result.changes
}

export function startPayoutIndexerScheduler(
  indexer: PayoutIndexer,
  addresses: () => readonly string[],
  intervalMs = 45 * 60_000,
): { stop: () => void } {
  let running = false
  const run = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await indexer.runCycle(addresses())
    } catch (error) {
      console.error(JSON.stringify({ indexer: 'cycle', error: errorMessage(error) }))
    } finally {
      running = false
    }
  }

  void run()
  const timer = setInterval(() => void run(), intervalMs)
  return { stop: () => clearInterval(timer) }
}

/** Read indexer knobs from env (production / Railway). */
export function indexerOptionsFromEnv(): {
  pageSize: number
  maxPages: number
  addressConcurrency: number
  backfillDays: number
} {
  const pageSize = Number(process.env.INDEXER_PAGE_SIZE ?? DEFAULT_PAGE_SIZE)
  const maxPages = Number(process.env.INDEXER_MAX_PAGES ?? DEFAULT_MAX_PAGES)
  const addressConcurrency = Number(
    process.env.INDEXER_ADDRESS_CONCURRENCY ?? DEFAULT_ADDRESS_CONCURRENCY,
  )
  const backfillDays = Number(process.env.INDEXER_BACKFILL_DAYS ?? DEFAULT_BACKFILL_DAYS)
  return {
    pageSize: Number.isFinite(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    maxPages: Number.isFinite(maxPages) ? maxPages : DEFAULT_MAX_PAGES,
    addressConcurrency: Number.isFinite(addressConcurrency)
      ? addressConcurrency
      : DEFAULT_ADDRESS_CONCURRENCY,
    backfillDays: Number.isFinite(backfillDays) ? Math.max(0, backfillDays) : DEFAULT_BACKFILL_DAYS,
  }
}
