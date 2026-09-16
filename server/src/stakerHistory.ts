/**
 * Index staking-contract actions involving an authenticated staker address.
 * Address history includes actions made outside Steakout. We store only the
 * action identity/time needed to conservatively exclude growth intervals.
 */
import { StakingContract } from '@nimiq/core'
import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'
import {
  fetchTransactionsByAddress,
  type NimiqTransaction,
} from './nimiq-rpc.js'

const STAKING_ACCOUNT_TYPE = 3
const PAGE_SIZE = 500
const MAX_PAGES = 20
/** Public node and local clocks can differ slightly without making a tx future-dated. */
const MAX_CLOCK_SKEW_MS = 2 * 60_000

const inFlightByDatabase = new WeakMap<Database.Database, Map<string, Promise<void>>>()

export type ChainStakingOperation =
  | 'create-staker'
  | 'add-stake'
  | 'update-staker'
  | 'set-active-stake'
  | 'retire-stake'
  | 'remove-stake'
  | 'unreadable-staking-action'

export interface StakerHistorySyncOptions {
  database: Database.Database
  userAddress: string
  requiredFrom: string
  /** Latest snapshot boundary that must already be included in the scan. */
  requiredThrough?: string
  rpcUrl?: string
  fetchPage?: (
    address: string,
    max: number,
    startAt: string | null,
  ) => Promise<NimiqTransaction[]>
  now?: () => number
}

function timestampIso(transaction: NimiqTransaction, scanStartedAtMs: number): string | null {
  if (
    typeof transaction.timestamp !== 'number' ||
    !Number.isInteger(transaction.timestamp) ||
    transaction.timestamp < 0 ||
    transaction.timestamp > scanStartedAtMs + MAX_CLOCK_SKEW_MS
  ) {
    return null
  }
  const iso = new Date(transaction.timestamp).toISOString()
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function isHex(value: string, exactLength?: number): boolean {
  return (exactLength == null || value.length === exactLength) &&
    /^(?:[0-9a-f]{2})+$/i.test(value)
}

function isStructurallyValid(
  transaction: NimiqTransaction,
  scanStartedAtMs: number,
): boolean {
  if (!isHex(transaction.hash, 64)) return false
  if (typeof transaction.from !== 'string' || transaction.from.trim() === '') return false
  if (typeof transaction.to !== 'string' || transaction.to.trim() === '') return false
  if (
    !Number.isInteger(transaction.fromType) || transaction.fromType! < 0 || transaction.fromType! > 3 ||
    !Number.isInteger(transaction.toType) || transaction.toType! < 0 || transaction.toType! > 3
  ) return false
  if (timestampIso(transaction, scanStartedAtMs) == null) return false
  if (
    transaction.toType === STAKING_ACCOUNT_TYPE &&
    (typeof transaction.recipientData !== 'string' || !isHex(transaction.recipientData))
  ) return false
  if (
    transaction.fromType === STAKING_ACCOUNT_TYPE &&
    (typeof transaction.proof !== 'string' || !isHex(transaction.proof))
  ) return false
  return true
}

function hexBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('Malformed hex data')
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

/** Classify only protocol staking actions affecting this staker. */
export function classifyStakerTransaction(
  transaction: NimiqTransaction,
  userAddress: string,
): ChainStakingOperation | null {
  if (!transaction.executionResult) return null
  const user = normalizeAddress(userAddress)

  if (transaction.toType === STAKING_ACCOUNT_TYPE) {
    let decoded: ReturnType<typeof StakingContract.dataToPlain>
    try {
      decoded = StakingContract.dataToPlain(hexBytes(transaction.recipientData ?? ''))
    } catch {
      // A staking-contract transaction returned in this user's address history
      // is safer to exclude than to treat as unexplained growth.
      return 'unreadable-staking-action'
    }
    if (decoded.type === 'add-stake') {
      return normalizeAddress(decoded.staker) === user ? decoded.type : null
    }
    if (
      decoded.type === 'create-staker' ||
      decoded.type === 'update-staker' ||
      decoded.type === 'set-active-stake' ||
      decoded.type === 'retire-stake'
    ) {
      return normalizeAddress(transaction.from) === user ? decoded.type : null
    }
    return null
  }

  if (transaction.fromType === STAKING_ACCOUNT_TYPE) {
    try {
      const decoded = StakingContract.proofToPlain(hexBytes(transaction.proof ?? ''))
      // Outgoing staking history is indexed for related addresses by the RPC.
      // Exact signer recovery is not exposed uniformly, so any such item in
      // this authenticated address history is conservatively excluded.
      void decoded
      return 'remove-stake'
    } catch {
      return 'unreadable-staking-action'
    }
  }

  return null
}

/**
 * Scan newest-first until the oldest required snapshot is covered. A bounded
 * or malformed history never claims coverage; callers then fail closed.
 */
function hasCoverage(options: StakerHistorySyncOptions, user: string): boolean {
  const requiredFromMs = Date.parse(options.requiredFrom)
  const requiredThroughMs = Date.parse(options.requiredThrough ?? options.requiredFrom)
  const row = options.database.prepare(
    `SELECT covered_from, scanned_at FROM user_staking_history_scans WHERE user_address = ?`,
  ).get(user) as { covered_from: string; scanned_at: string } | undefined
  if (!row) return false
  const coveredFromMs = Date.parse(row.covered_from)
  const scannedAtMs = Date.parse(row.scanned_at)
  return Number.isFinite(coveredFromMs) && Number.isFinite(scannedAtMs) &&
    coveredFromMs <= requiredFromMs && scannedAtMs >= requiredThroughMs
}

async function performSync(options: StakerHistorySyncOptions, user: string): Promise<void> {
  const requiredMs = Date.parse(options.requiredFrom)
  if (user === '' || Number.isNaN(requiredMs)) return
  const scanStartedAtMs = (options.now ?? Date.now)()
  if (!Number.isInteger(scanStartedAtMs) || scanStartedAtMs < 0) return
  const fetchPage = options.fetchPage ?? ((address, max, startAt) =>
    fetchTransactionsByAddress(address, max, startAt, options.rpcUrl))

  let cursor: string | null = null
  let oldestIso: string | null = null
  let complete = false
  let historyReadable = true
  let reachedBoundary = false
  const seenCursors = new Set<string>()
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    if (cursor != null && seenCursors.has(cursor)) {
      historyReadable = false
      break
    }
    if (cursor != null) seenCursors.add(cursor)
    const page = await fetchPage(user, PAGE_SIZE, cursor)
    if (page.length === 0) {
      complete = true
      reachedBoundary = true
      break
    }
    for (const transaction of page) {
      if (!isStructurallyValid(transaction, scanStartedAtMs)) {
        historyReadable = false
        continue
      }
      const at = timestampIso(transaction, scanStartedAtMs)!
      if (oldestIso == null || Date.parse(at) < Date.parse(oldestIso)) oldestIso = at
      const operation = classifyStakerTransaction(transaction, user)
      if (operation != null) {
        options.database.prepare(
          `INSERT OR IGNORE INTO user_staking_actions
             (user_address, tx_hash, operation, observed_at, block_number)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(user, transaction.hash.toLowerCase(), operation, at, transaction.blockNumber ?? null)
      }
    }
    if (oldestIso != null && Date.parse(oldestIso) <= requiredMs) {
      reachedBoundary = true
      break
    }
    const nextCursor = page[page.length - 1]?.hash.toLowerCase() ?? null
    if (nextCursor == null || nextCursor === cursor || seenCursors.has(nextCursor)) {
      historyReadable = false
      break
    }
    cursor = nextCursor
  }

  // A timestamp-free transaction cannot be placed relative to snapshots, so
  // this scan must not advance the coverage watermark.
  if (!historyReadable || !reachedBoundary || (oldestIso == null && !complete)) return
  const coveredFrom = complete ? '1970-01-01T00:00:00.000Z' : oldestIso!
  const existing = options.database.prepare(
    `SELECT covered_from, complete FROM user_staking_history_scans WHERE user_address = ?`,
  ).get(user) as { covered_from: string; complete: number } | undefined
  const existingMs = existing ? Date.parse(existing.covered_from) : Number.POSITIVE_INFINITY
  const nextCoveredFrom = existingMs <= Date.parse(coveredFrom) ? existing!.covered_from : coveredFrom
  options.database.prepare(
    `INSERT INTO user_staking_history_scans (user_address, covered_from, scanned_at, complete)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_address) DO UPDATE SET
       covered_from = excluded.covered_from,
       scanned_at = excluded.scanned_at,
       complete = MAX(user_staking_history_scans.complete, excluded.complete)`,
  ).run(
    user,
    nextCoveredFrom,
    new Date(scanStartedAtMs).toISOString(),
    complete || existing?.complete === 1 ? 1 : 0,
  )
}

export async function syncStakerHistory(options: StakerHistorySyncOptions): Promise<void> {
  const user = normalizeAddress(options.userAddress)
  const requiredMs = Date.parse(options.requiredFrom)
  const throughMs = Date.parse(options.requiredThrough ?? options.requiredFrom)
  if (user === '' || Number.isNaN(requiredMs) || Number.isNaN(throughMs)) return
  if (hasCoverage(options, user)) return

  let map = inFlightByDatabase.get(options.database)
  if (!map) {
    map = new Map()
    inFlightByDatabase.set(options.database, map)
  }
  let initiatedScan = false
  for (;;) {
    if (hasCoverage(options, user)) return

    const existing = map.get(user)
    if (existing) {
      await existing
      // The active scan may have been narrower than this request. Loop so all
      // waiters atomically reuse whichever broader follow-up wins acquisition.
      continue
    }

    // Never retry an uncovered/failed scan initiated by this caller. A future
    // request may try again, while this request remains bounded.
    if (initiatedScan) return
    initiatedScan = true

    // Publish ownership before performSync begins any RPC work. This makes
    // acquisition atomic for other continuations in the same event-loop turn.
    const operation = Promise.resolve().then(() => performSync(options, user))
    map.set(user, operation)
    try {
      await operation
    } finally {
      if (map.get(user) === operation) map.delete(user)
    }
    return
  }
}
