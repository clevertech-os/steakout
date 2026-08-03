/**
 * Position reads + six-state normalization (P1-05).
 *
 * RPC → PositionState mapping (field shape from P0-04 / PlainStaker;
 * fixtures: tests/fixtures/rpc/p0-04-*-mainnet.json + synthetic unit cases):
 *
 * | State          | RPC / inputs                                                                 |
 * |----------------|------------------------------------------------------------------------------|
 * | NotStaked      | getStakerByAddress → "No staker with address" (P0-04 fixture), or all of     |
 * |                | balance + inactiveBalance + retiredBalance === 0                             |
 * | Pending        | hasPendingTx (pending staking_intents row or explicit option) — not on-chain |
 * | Active         | balance > 0 and inactiveBalance === 0 and retiredBalance === 0               |
 * | Inactive       | inactiveBalance > 0 and balance === 0 and retiredBalance === 0               |
 * | Retiring       | retiredBalance > 0 and (balance > 0 or inactiveBalance > 0) — wind-down      |
 * | Withdrawable   | retiredBalance > 0 and balance === 0 and inactiveBalance === 0               |
 * |                | (Core: retired funds are immediately removable; no release field required)   |
 *
 * Mixed active+inactive (partial set-active) → Active when balance > 0 and
 * retiredBalance === 0 (primary stake still earning).
 *
 * Unknown / unreadable staker payloads never map to Active — callers set
 * envelope status `unavailable` instead (AC: fail closed).
 *
 * Snapshots: append staker_snapshots at most once per hour per address.
 * Cache: short in-process TTL per address (POSITION_CACHE_TTL_MS).
 */

import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'
import {
  getAccountByAddress,
  getBlockNumber,
  getStakerByAddress,
  isStakerNotFoundError,
  type NimiqAccount,
  type NimiqStaker,
  RpcError,
  toRpcApiError,
} from './nimiq-rpc.js'

/** Client-visible position enum (API.md §5 / ARCHITECTURE.md §8). */
export type PositionState =
  | 'NotStaked'
  | 'Pending'
  | 'Active'
  | 'Inactive'
  | 'Retiring'
  | 'Withdrawable'

export type PositionEnvelopeStatus = 'ok' | 'stale' | 'partial' | 'unavailable'

export type PositionSource = 'rpc' | 'cache'

/** Short in-process cache; responses also set Cache-Control max-age to this (seconds). */
export const POSITION_CACHE_TTL_MS = 10_000

/** Min interval between staker_snapshots rows for the same address. */
export const SNAPSHOT_THROTTLE_MS = 60 * 60 * 1000

export interface StakerBalances {
  activeLuna: number
  inactiveLuna: number
  retiredLuna: number
  totalLuna: number
  delegation: string | null
}

export interface StakingPositionData {
  state: PositionState
  accountBalanceLuna: number | null
  staker: StakerBalances & { validatorName: string | null }
  retire: { withdrawableAt: string | null }
  lastRewardObservation: {
    type: 'direct-payout' | 'balance-change'
    at: string
    txHash: string | null
  } | null
}

export interface StakingPositionEnvelope {
  updatedAt: string
  source: PositionSource
  status: PositionEnvelopeStatus
  dataFreshness: { ageSeconds: number }
  data: StakingPositionData
}

export interface NormalizePositionInput {
  /** Null when RPC reports no staker (NotStaked). */
  staker: NimiqStaker | null
  /** True when a staking intent is pending or a broadcast is not yet confirmed. */
  hasPendingTx?: boolean
}

/**
 * Pure state machine. Never returns Active for missing/unreadable staker data —
 * callers must pass an explicit staker object or null (no-staker).
 */
export function normalizePositionState(input: NormalizePositionInput): PositionState {
  if (input.hasPendingTx) return 'Pending'

  const staker = input.staker
  if (staker == null) return 'NotStaked'

  const active = nonNegInt(staker.balance)
  const inactive = nonNegInt(staker.inactiveBalance ?? 0)
  const retired = nonNegInt(staker.retiredBalance ?? 0)
  const total = active + inactive + retired

  if (total === 0) return 'NotStaked'

  // Retired-only → immediately removable (Core PlainStaker docs).
  if (retired > 0 && active === 0 && inactive === 0) return 'Withdrawable'
  // Retired while other buckets remain → wind-down in progress.
  if (retired > 0) return 'Retiring'
  // Fully inactive (no active stake).
  if (inactive > 0 && active === 0) return 'Inactive'
  // Active stake present (including partial inactive via set-active).
  if (active > 0) return 'Active'

  // Unreachable when numbers are finite non-negative; defensive fail-closed.
  return 'NotStaked'
}

/**
 * Coerce RPC staker balances into API shape. Returns null when the payload is
 * unreadable (must not be treated as Active).
 */
export function parseStakerBalances(staker: NimiqStaker | null): StakerBalances | null {
  if (staker == null) {
    return {
      activeLuna: 0,
      inactiveLuna: 0,
      retiredLuna: 0,
      totalLuna: 0,
      delegation: null,
    }
  }
  if (typeof staker.balance !== 'number' || !Number.isFinite(staker.balance)) {
    return null
  }
  const activeLuna = nonNegInt(staker.balance)
  const inactiveLuna = nonNegInt(
    typeof staker.inactiveBalance === 'number' ? staker.inactiveBalance : 0,
  )
  const retiredLuna = nonNegInt(
    typeof staker.retiredBalance === 'number' ? staker.retiredBalance : 0,
  )
  const delegation =
    typeof staker.delegation === 'string' && staker.delegation.trim() !== ''
      ? staker.delegation
      : null
  return {
    activeLuna,
    inactiveLuna,
    retiredLuna,
    totalLuna: activeLuna + inactiveLuna + retiredLuna,
    delegation,
  }
}

export interface ReadPositionOptions {
  database: Database.Database
  address: string
  rpcUrl?: string
  now?: () => number
  /** Inject pending-tx detection (tests); default checks staking_intents. */
  hasPendingTx?: boolean
  /** Skip cache read/write (tests). */
  bypassCache?: boolean
  /** Optional overrides for unit tests. */
  getAccount?: (address: string) => Promise<NimiqAccount>
  getStaker?: (address: string) => Promise<NimiqStaker>
  getBlock?: () => Promise<number>
}

interface CacheEntry {
  envelope: StakingPositionEnvelope
  expiresAt: number
}

const positionCache = new Map<string, CacheEntry>()

export function clearPositionCache(): void {
  positionCache.clear()
}

export function resolveValidatorName(
  database: Database.Database,
  delegation: string | null,
): string | null {
  if (delegation == null || delegation.trim() === '') return null
  const normalized = normalizeAddress(delegation)
  // Registry may store spaced user-friendly addresses; match normalized form.
  const row = database
    .prepare(
      `SELECT name FROM validators
       WHERE replace(upper(address), ' ', '') = ?
       LIMIT 1`,
    )
    .get(normalized) as { name: string | null } | undefined
  if (!row) return null
  const name = row.name
  if (typeof name !== 'string' || name.trim() === '') return null
  return name
}

export function hasPendingStakingIntent(
  database: Database.Database,
  address: string,
  nowMs: number,
): boolean {
  const normalized = normalizeAddress(address)
  const nowIso = new Date(nowMs).toISOString()
  const row = database
    .prepare(
      `SELECT 1 AS ok FROM staking_intents
       WHERE replace(upper(user_address), ' ', '') = ?
         AND status = 'pending'
         AND expires_at > ?
       LIMIT 1`,
    )
    .get(normalized, nowIso) as { ok: number } | undefined
  return row != null
}

/**
 * Write staker_snapshots when the last snapshot for this address is older than
 * SNAPSHOT_THROTTLE_MS (or missing). Returns whether a row was inserted.
 */
export function maybeWriteStakerSnapshot(
  database: Database.Database,
  params: {
    userAddress: string
    validatorAddress: string | null
    activeLuna: number
    inactiveLuna: number
    retiredLuna: number
    totalLuna: number
    sourceBlock: number
    nowMs: number
  },
): boolean {
  const userAddress = normalizeAddress(params.userAddress)
  const throttleIso = new Date(params.nowMs - SNAPSHOT_THROTTLE_MS).toISOString()
  const recent = database
    .prepare(
      `SELECT 1 AS ok FROM staker_snapshots
       WHERE replace(upper(user_address), ' ', '') = ?
         AND observed_at >= ?
       LIMIT 1`,
    )
    .get(userAddress, throttleIso) as { ok: number } | undefined
  if (recent) return false

  const observedAt = new Date(params.nowMs).toISOString()
  database
    .prepare(
      `INSERT INTO staker_snapshots (
         user_address, validator_address,
         active_balance_luna, inactive_balance_luna, retired_balance_luna, total_balance_luna,
         observed_at, source_block
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userAddress,
      params.validatorAddress,
      params.activeLuna,
      params.inactiveLuna,
      params.retiredLuna,
      params.totalLuna,
      observedAt,
      params.sourceBlock,
    )
  return true
}

export class PositionReadError extends Error {
  readonly httpStatus: number
  readonly code: string

  constructor(message: string, httpStatus: number, code: string) {
    super(message)
    this.name = 'PositionReadError'
    this.httpStatus = httpStatus
    this.code = code
  }
}

/**
 * Authenticated position read: account + staker via RPC, normalize, resolve
 * validator name, optional snapshot, short-TTL cache.
 */
export async function readStakingPosition(
  options: ReadPositionOptions,
): Promise<StakingPositionEnvelope> {
  const nowMs = (options.now ?? Date.now)()
  const address = normalizeAddress(options.address)
  const cacheKey = address

  if (!options.bypassCache) {
    const cached = positionCache.get(cacheKey)
    if (cached && cached.expiresAt > nowMs) {
      const ageSeconds = Math.max(
        0,
        Math.floor((nowMs - Date.parse(cached.envelope.updatedAt)) / 1000),
      )
      return {
        ...cached.envelope,
        source: 'cache',
        status: ageSeconds > POSITION_CACHE_TTL_MS / 1000 ? 'stale' : cached.envelope.status,
        dataFreshness: { ageSeconds },
      }
    }
  }

  const getAccount = options.getAccount ?? ((addr: string) => getAccountByAddress(addr, options.rpcUrl))
  const getStaker = options.getStaker ?? ((addr: string) => getStakerByAddress(addr, options.rpcUrl))
  const getBlock = options.getBlock ?? (() => getBlockNumber(options.rpcUrl))

  const pending =
    options.hasPendingTx ??
    hasPendingStakingIntent(options.database, address, nowMs)

  let accountBalanceLuna: number | null = null
  let accountOk = false
  try {
    const account = await getAccount(address)
    if (typeof account.balance === 'number' && Number.isFinite(account.balance)) {
      accountBalanceLuna = nonNegInt(account.balance)
      accountOk = true
    }
  } catch {
    accountOk = false
    accountBalanceLuna = null
  }

  let staker: NimiqStaker | null = null
  let stakerReadable = true
  try {
    staker = await getStaker(address)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isStakerNotFoundError(message)) {
      staker = null
      stakerReadable = true
    } else {
      stakerReadable = false
      // Hard RPC failure on the critical read → 503.
      if (error instanceof RpcError || error instanceof Error) {
        const api = toRpcApiError(error)
        throw new PositionReadError(api.message, api.httpStatus, api.code)
      }
      throw new PositionReadError(
        'The Nimiq RPC is unavailable.',
        503,
        'RPC_UNAVAILABLE',
      )
    }
  }

  const balances = parseStakerBalances(staker)
  if (!stakerReadable || balances == null) {
    // Unreadable → never Active; surface unavailable envelope (no throw if we got here without RPC error).
    const updatedAt = new Date(nowMs).toISOString()
    return {
      updatedAt,
      source: 'rpc',
      status: 'unavailable',
      dataFreshness: { ageSeconds: 0 },
      data: {
        state: 'NotStaked',
        accountBalanceLuna,
        staker: {
          activeLuna: 0,
          inactiveLuna: 0,
          retiredLuna: 0,
          totalLuna: 0,
          delegation: null,
          validatorName: null,
        },
        retire: { withdrawableAt: null },
        lastRewardObservation: null,
      },
    }
  }

  // Guard: refuse to label garbage as Active.
  const state = normalizePositionState({ staker, hasPendingTx: pending })
  if (
    state === 'Active' &&
    (typeof staker?.balance !== 'number' || !Number.isFinite(staker.balance) || staker.balance <= 0)
  ) {
    const updatedAt = new Date(nowMs).toISOString()
    return {
      updatedAt,
      source: 'rpc',
      status: 'unavailable',
      dataFreshness: { ageSeconds: 0 },
      data: {
        state: 'NotStaked',
        accountBalanceLuna,
        staker: { ...balances, validatorName: null },
        retire: { withdrawableAt: null },
        lastRewardObservation: null,
      },
    }
  }

  const validatorName = resolveValidatorName(options.database, balances.delegation)
  const updatedAt = new Date(nowMs).toISOString()
  const status: PositionEnvelopeStatus = accountOk ? 'ok' : 'partial'

  const envelope: StakingPositionEnvelope = {
    updatedAt,
    source: 'rpc',
    status,
    dataFreshness: { ageSeconds: 0 },
    data: {
      state,
      accountBalanceLuna,
      staker: {
        ...balances,
        validatorName,
      },
      // Protocol does not expose a release timestamp on RPC Staker (P0-04); never invent one.
      retire: { withdrawableAt: null },
      lastRewardObservation: null,
    },
  }

  // Snapshot (throttled). Block height required; skip quietly if unavailable.
  try {
    const sourceBlock = await getBlock()
    if (typeof sourceBlock === 'number' && Number.isInteger(sourceBlock) && sourceBlock >= 0) {
      maybeWriteStakerSnapshot(options.database, {
        userAddress: address,
        validatorAddress: balances.delegation
          ? normalizeAddress(balances.delegation)
          : null,
        activeLuna: balances.activeLuna,
        inactiveLuna: balances.inactiveLuna,
        retiredLuna: balances.retiredLuna,
        totalLuna: balances.totalLuna,
        sourceBlock,
        nowMs,
      })
    }
  } catch {
    // Snapshot is best-effort; position response still succeeds.
  }

  if (!options.bypassCache) {
    positionCache.set(cacheKey, {
      envelope,
      expiresAt: nowMs + POSITION_CACHE_TTL_MS,
    })
  }

  return envelope
}

/** Express Cache-Control value matching POSITION_CACHE_TTL_MS. */
export function positionCacheControlHeader(): string {
  const maxAgeSeconds = Math.max(1, Math.floor(POSITION_CACHE_TTL_MS / 1000))
  return `private, max-age=${maxAgeSeconds}`
}

function nonNegInt(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/** Test helper: build a minimal NimiqStaker with P0-04 field names. */
export function makeStakerFixture(
  partial: Partial<NimiqStaker> & { address?: string },
): NimiqStaker {
  return {
    address: partial.address ?? 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
    balance: partial.balance ?? 0,
    delegation: partial.delegation === undefined ? null : partial.delegation,
    inactiveBalance: partial.inactiveBalance ?? 0,
    inactiveFrom: partial.inactiveFrom ?? null,
    retiredBalance: partial.retiredBalance ?? 0,
  }
}

