/**
 * Personal continuity for authenticated stakers (P2-05).
 *
 * API.md §5 `GET /api/me/observations`, METHODOLOGY.md §4.4 / §5, SPEC §7.2–7.3.
 *
 * Direct-payout: last observed payment, consecutive windows including the address,
 * windows observed, time since last payment, known-staker-set membership.
 * Restake: Observed position growth pointer from staker_snapshots (never payout claims).
 * Not staked: clean payload, HTTP 200 — not an error.
 *
 * Every continuity field is independently nullable. Language is neutral
 * (observed / not observed / insufficient data) — never "missed payment".
 */

import type Database from 'better-sqlite3'
import { normalizeAddress } from './addresses.js'
import {
  applyIndexerStaleStatus,
  buildDataFreshness,
  getIndexerWatermarkIso,
  historyDepthDaysFromEarliest,
  type EnvelopeStatus,
} from './freshness.js'
import {
  getStakerByAddress,
  isStakerNotFoundError,
  type NimiqStaker,
  RpcError,
  toRpcApiError,
} from './nimiq-rpc.js'
import {
  listPayoutRunObservations,
  type PayoutRunPayload,
} from './payoutClassifier.js'
import {
  normalizePositionState,
  parseStakerBalances,
  resolveValidatorName,
  type PositionState,
} from './stakingState.js'
import { normalizePayoutType, type NormalizedPayoutType } from './validators-api.js'

export type ContinuityMode = 'not-staked' | 'direct-payout' | 'restake' | 'unknown-payout'

export type ContinuityEnvelopeStatus = EnvelopeStatus

export type ContinuitySource = 'indexer' | 'rpc' | 'cache'

/** Fixed label — METHODOLOGY.md §5. Never "Validator payout verified". */
export const OBSERVED_POSITION_GROWTH_LABEL = 'Observed position growth' as const

export interface ObservedPositionGrowth {
  label: typeof OBSERVED_POSITION_GROWTH_LABEL
  latest: { at: string; totalLuna: number } | null
  previous: { at: string; totalLuna: number } | null
  /** latest.totalLuna − previous.totalLuna when both present; otherwise null. */
  deltaLuna: number | null
}

/**
 * API.md §5 personal continuity payload, plus mode/position context for
 * not-staked and restake branches (task P2-05).
 */
export interface PersonalContinuityData {
  mode: ContinuityMode
  positionState: PositionState
  validatorAddress: string | null
  validatorName: string | null
  /** ISO timestamp of last observed inbound payment from the reward address. */
  lastPaymentAt: string | null
  /** Trailing streak of payout runs (newest → older) that include this address. */
  consecutiveWindowsIncluded: number | null
  /** Count of observed payout runs that include this address. */
  windowsObserved: number | null
  /** Seconds from lastPaymentAt to now when lastPaymentAt is known. */
  timeSinceLastPaymentSeconds: number | null
  /**
   * Membership in the registry known-staker set when that set is available.
   * Null when the set is unknown (e.g. P2-04 not yet populated) — never invent 0/false.
   */
  currentlyInKnownStakerSet: boolean | null
  /**
   * Restake-only pointer into snapshot history. Null for direct-payout / not-staked.
   * Never implies payout verification.
   */
  observedPositionGrowth: ObservedPositionGrowth | null
}

export interface PersonalContinuityEnvelope {
  updatedAt: string
  source: ContinuitySource
  status: ContinuityEnvelopeStatus
  dataFreshness: { ageSeconds: number; historyDepthDays: number | null }
  data: PersonalContinuityData
}

export interface ReadPersonalContinuityOptions {
  database: Database.Database
  address: string
  rpcUrl?: string
  now?: () => number
  /** Inject staker read (unit tests). */
  getStaker?: (address: string) => Promise<NimiqStaker>
  /**
   * Optional known-staker set for the delegated validator (normalized addresses).
   * Pass `null` explicitly to force "set unavailable". Default: look up DB helper.
   */
  knownStakerSet?: Set<string> | null
  /** Skip RPC and use this staker (or null = no staker). */
  stakerOverride?: NimiqStaker | null
}

export class ContinuityReadError extends Error {
  readonly httpStatus: number
  readonly code: string

  constructor(message: string, httpStatus: number, code: string) {
    super(message)
    this.name = 'ContinuityReadError'
    this.httpStatus = httpStatus
    this.code = code
  }
}

interface ValidatorContext {
  /** Address as stored in `validators` (FK for observations). */
  address: string
  name: string | null
  payoutType: NormalizedPayoutType
  rewardAddress: string | null
}

function emptyContinuityData(
  mode: ContinuityMode,
  positionState: PositionState,
  validatorAddress: string | null = null,
  validatorName: string | null = null,
): PersonalContinuityData {
  return {
    mode,
    positionState,
    validatorAddress,
    validatorName,
    lastPaymentAt: null,
    consecutiveWindowsIncluded: null,
    windowsObserved: null,
    timeSinceLastPaymentSeconds: null,
    currentlyInKnownStakerSet: null,
    observedPositionGrowth: null,
  }
}

function findValidatorContext(
  database: Database.Database,
  delegation: string,
): ValidatorContext | null {
  const target = normalizeAddress(delegation)
  if (target === '') return null
  const row = database
    .prepare(
      `SELECT address, name, payout_type_declared, reward_address
       FROM validators
       WHERE replace(upper(address), ' ', '') = ?
       LIMIT 1`,
    )
    .get(target) as
    | {
        address: string
        name: string | null
        payout_type_declared: string | null
        reward_address: string | null
      }
    | undefined
  if (!row) return null
  return {
    address: row.address,
    name:
      typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : null,
    payoutType: normalizePayoutType(row.payout_type_declared),
    rewardAddress:
      typeof row.reward_address === 'string' && row.reward_address.trim() !== ''
        ? row.reward_address
        : null,
  }
}

/**
 * Last observed successful payment to `userAddress` from the validator reward
 * address (or validator self-address when reward is unset).
 * Independent of payout-run classification.
 */
export function findLastPaymentToUser(
  database: Database.Database,
  userAddress: string,
  fromAddress: string,
): { at: string; txHash: string; valueLuna: number } | null {
  const user = normalizeAddress(userAddress)
  const from = normalizeAddress(fromAddress)
  if (user === '' || from === '') return null

  const row = database
    .prepare(
      `SELECT hash, timestamp, value_luna
       FROM transactions
       WHERE replace(upper(to_address), ' ', '') = ?
         AND replace(upper(from_address), ' ', '') = ?
         AND execution_result = 'ok'
       ORDER BY timestamp DESC, block_number DESC, hash DESC
       LIMIT 1`,
    )
    .get(user, from) as
    | { hash: string; timestamp: string; value_luna: number }
    | undefined

  if (!row || typeof row.timestamp !== 'string' || row.timestamp.trim() === '') {
    return null
  }
  return {
    at: row.timestamp,
    txHash: row.hash,
    valueLuna: row.value_luna,
  }
}

function recipientIncludes(payload: PayoutRunPayload, userAddress: string): boolean {
  const user = normalizeAddress(userAddress)
  if (!Array.isArray(payload.recipients)) return false
  return payload.recipients.some((r) => normalizeAddress(r) === user)
}

/**
 * Pure window stats from ordered payout-run payloads (oldest → newest).
 * consecutiveWindowsIncluded counts trailing inclusions from the newest run.
 * windowsObserved is the total number of runs that include the user.
 * Both null when there are no runs (insufficient history).
 */
export function computeWindowInclusion(
  runsOldestFirst: readonly { payload: PayoutRunPayload }[],
  userAddress: string,
): { consecutiveWindowsIncluded: number | null; windowsObserved: number | null } {
  if (runsOldestFirst.length === 0) {
    return { consecutiveWindowsIncluded: null, windowsObserved: null }
  }

  let windowsObserved = 0
  for (const run of runsOldestFirst) {
    if (recipientIncludes(run.payload, userAddress)) windowsObserved += 1
  }

  let consecutive = 0
  for (let i = runsOldestFirst.length - 1; i >= 0; i -= 1) {
    const run = runsOldestFirst[i]
    if (!run || !recipientIncludes(run.payload, userAddress)) break
    consecutive += 1
  }

  return {
    consecutiveWindowsIncluded: consecutive,
    windowsObserved,
  }
}

/**
 * Known-staker membership when a set is supplied. Null when the set is
 * unavailable — never coerce missing data to false (METHODOLOGY §4.3/4.4).
 */
export function membershipInKnownStakerSet(
  userAddress: string,
  knownStakerSet: Set<string> | null | undefined,
): boolean | null {
  if (knownStakerSet == null) return null
  return knownStakerSet.has(normalizeAddress(userAddress))
}

/**
 * Load a known-staker set if a future recipient-coverage payload stores one.
 * Today returns null (P2-04 may populate `knownStakerAddresses` later).
 */
export function loadKnownStakerSetFromDb(
  database: Database.Database,
  validatorAddress: string,
): Set<string> | null {
  const target = normalizeAddress(validatorAddress)
  if (target === '') return null

  // Prefer latest calc_version for recipient-coverage observations.
  const versionRow = database
    .prepare(
      `SELECT MAX(calc_version) AS version
       FROM validator_observations
       WHERE observation_type = 'recipient-coverage'
         AND replace(upper(validator_address), ' ', '') = ?`,
    )
    .get(target) as { version: number | null } | undefined
  if (versionRow?.version == null) return null

  const row = database
    .prepare(
      `SELECT payload_json
       FROM validator_observations
       WHERE observation_type = 'recipient-coverage'
         AND replace(upper(validator_address), ' ', '') = ?
         AND calc_version = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 1`,
    )
    .get(target, versionRow.version) as { payload_json: string } | undefined
  if (!row) return null

  try {
    const payload = JSON.parse(row.payload_json) as {
      knownStakerAddresses?: unknown
    }
    if (!Array.isArray(payload.knownStakerAddresses)) return null
    const addresses = payload.knownStakerAddresses
      .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      .map((a) => normalizeAddress(a))
    if (addresses.length === 0) return null
    return new Set(addresses)
  } catch {
    return null
  }
}

export function readObservedPositionGrowth(
  database: Database.Database,
  userAddress: string,
): ObservedPositionGrowth {
  const user = normalizeAddress(userAddress)
  const rows = database
    .prepare(
      `SELECT observed_at, total_balance_luna
       FROM staker_snapshots
       WHERE replace(upper(user_address), ' ', '') = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 2`,
    )
    .all(user) as Array<{ observed_at: string; total_balance_luna: number }>

  const latestRow = rows[0]
  const previousRow = rows[1]

  const latest =
    latestRow != null
      ? {
          at: latestRow.observed_at,
          totalLuna: latestRow.total_balance_luna,
        }
      : null
  const previous =
    previousRow != null
      ? {
          at: previousRow.observed_at,
          totalLuna: previousRow.total_balance_luna,
        }
      : null

  const deltaLuna =
    latest != null && previous != null
      ? latest.totalLuna - previous.totalLuna
      : null

  return {
    label: OBSERVED_POSITION_GROWTH_LABEL,
    latest,
    previous,
    deltaLuna,
  }
}

function historyDepthDaysFromRuns(
  runs: readonly { payload: PayoutRunPayload }[],
  nowMs: number,
): number | null {
  if (runs.length === 0) return null
  let earliestIso: string | null = null
  let earliestMs = Number.POSITIVE_INFINITY
  for (const run of runs) {
    const t = Date.parse(run.payload.windowStart)
    if (!Number.isNaN(t) && t < earliestMs) {
      earliestMs = t
      earliestIso = run.payload.windowStart
    }
  }
  if (!earliestIso) return null
  // Round to one decimal for stable API display (matches prior personal-continuity shape).
  const days = historyDepthDaysFromEarliest(earliestIso, nowMs)
  return Math.floor(days * 10) / 10
}

function continuityEnvelope(options: {
  updatedAt: string
  source: ContinuitySource
  baseStatus: ContinuityEnvelopeStatus
  data: PersonalContinuityData
  nowMs: number
  historyDepthDays: number | null
  database: Database.Database
}): PersonalContinuityEnvelope {
  const watermarkIso =
    options.source === 'indexer' ? getIndexerWatermarkIso(options.database) : null
  const status = options.source === 'indexer'
    ? applyIndexerStaleStatus(options.baseStatus, {
      nowMs: options.nowMs,
      watermarkIso,
    })
    : options.baseStatus
  const ageFromIso =
    options.source === 'indexer' && watermarkIso
      ? watermarkIso
      : options.updatedAt
  const freshness = buildDataFreshness({
    updatedAt: options.updatedAt,
    nowMs: options.nowMs,
    ageFromIso,
    historyDepthDays: options.historyDepthDays ?? undefined,
  })
  return {
    updatedAt: options.updatedAt,
    source: options.source,
    status,
    dataFreshness: {
      ageSeconds: freshness.ageSeconds,
      historyDepthDays: options.historyDepthDays,
    },
    data: options.data,
  }
}

/**
 * Authenticated personal continuity read.
 * Never errors solely because the user is not staked.
 */
export async function readPersonalContinuity(
  options: ReadPersonalContinuityOptions,
): Promise<PersonalContinuityEnvelope> {
  const nowMs = (options.now ?? Date.now)()
  const updatedAt = new Date(nowMs).toISOString()
  const address = normalizeAddress(options.address)

  let staker: NimiqStaker | null
  if (options.stakerOverride !== undefined) {
    staker = options.stakerOverride
  } else {
    const getStaker =
      options.getStaker ??
      ((addr: string) => getStakerByAddress(addr, options.rpcUrl))
    try {
      staker = await getStaker(address)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isStakerNotFoundError(message)) {
        staker = null
      } else if (error instanceof RpcError || error instanceof Error) {
        const api = toRpcApiError(error)
        throw new ContinuityReadError(api.message, api.httpStatus, api.code)
      } else {
        throw new ContinuityReadError(
          'The Nimiq RPC is unavailable.',
          503,
          'RPC_UNAVAILABLE',
        )
      }
    }
  }

  const balances = parseStakerBalances(staker)
  if (balances == null) {
    return continuityEnvelope({
      updatedAt,
      source: 'rpc',
      baseStatus: 'unavailable',
      data: emptyContinuityData('not-staked', 'NotStaked'),
      nowMs,
      historyDepthDays: null,
      database: options.database,
    })
  }

  const positionState = normalizePositionState({ staker, hasPendingTx: false })

  // Not staked (or zero total / no staker row): clean NotStaked-style payload.
  if (positionState === 'NotStaked' || balances.totalLuna === 0) {
    return continuityEnvelope({
      updatedAt,
      source: 'rpc',
      baseStatus: 'ok',
      data: emptyContinuityData('not-staked', 'NotStaked'),
      nowMs,
      historyDepthDays: null,
      database: options.database,
    })
  }

  const delegation = balances.delegation
  const validatorCtx = delegation
    ? findValidatorContext(options.database, delegation)
    : null
  const validatorAddress = validatorCtx
    ? normalizeAddress(validatorCtx.address)
    : delegation
      ? normalizeAddress(delegation)
      : null
  const validatorName =
    validatorCtx?.name ??
    resolveValidatorName(options.database, delegation)

  const payoutType: NormalizedPayoutType = validatorCtx?.payoutType ?? 'unknown'

  // Restake: Observed position growth only — no direct-payout claims.
  if (payoutType === 'restake') {
    const growth = readObservedPositionGrowth(options.database, address)
    const hasSnapshots = growth.latest != null
    return continuityEnvelope({
      updatedAt,
      source: hasSnapshots ? 'indexer' : 'rpc',
      baseStatus: hasSnapshots ? 'ok' : 'partial',
      data: {
        ...emptyContinuityData(
          'restake',
          positionState,
          validatorAddress,
          validatorName,
        ),
        observedPositionGrowth: growth,
      },
      nowMs,
      historyDepthDays: null,
      database: options.database,
    })
  }

  // Direct-payout (or unknown: still attempt continuity from indexed txs/runs;
  // fields stay independently nullable when data is missing).
  const mode: ContinuityMode =
    payoutType === 'direct' ? 'direct-payout' : 'unknown-payout'

  const rewardAddress =
    validatorCtx?.rewardAddress ??
    validatorCtx?.address ??
    delegation

  let lastPaymentAt: string | null = null
  if (rewardAddress) {
    const payment = findLastPaymentToUser(options.database, address, rewardAddress)
    lastPaymentAt = payment?.at ?? null
  }

  let consecutiveWindowsIncluded: number | null = null
  let windowsObserved: number | null = null
  let historyDepthDays: number | null = null

  if (validatorCtx) {
    const runs = listPayoutRunObservations(options.database, validatorCtx.address)
    const inclusion = computeWindowInclusion(runs, address)
    consecutiveWindowsIncluded = inclusion.consecutiveWindowsIncluded
    windowsObserved = inclusion.windowsObserved
    historyDepthDays = historyDepthDaysFromRuns(runs, nowMs)
  }

  const timeSinceLastPaymentSeconds =
    lastPaymentAt != null
      ? Math.max(0, Math.floor((nowMs - Date.parse(lastPaymentAt)) / 1000))
      : null

  // Resolve known-staker set: explicit option wins, else DB helper (usually null).
  let knownSet: Set<string> | null
  if (options.knownStakerSet !== undefined) {
    knownSet = options.knownStakerSet
  } else if (validatorCtx) {
    knownSet = loadKnownStakerSetFromDb(options.database, validatorCtx.address)
  } else {
    knownSet = null
  }

  const currentlyInKnownStakerSet = membershipInKnownStakerSet(address, knownSet)

  const hasAnyField =
    lastPaymentAt != null ||
    consecutiveWindowsIncluded != null ||
    windowsObserved != null ||
    currentlyInKnownStakerSet != null

  return continuityEnvelope({
    updatedAt,
    source: hasAnyField ? 'indexer' : 'rpc',
    baseStatus: hasAnyField || mode === 'direct-payout' ? 'ok' : 'partial',
    data: {
      mode,
      positionState,
      validatorAddress,
      validatorName,
      lastPaymentAt,
      consecutiveWindowsIncluded,
      windowsObserved,
      timeSinceLastPaymentSeconds:
        timeSinceLastPaymentSeconds != null &&
        !Number.isNaN(timeSinceLastPaymentSeconds)
          ? timeSinceLastPaymentSeconds
          : null,
      currentlyInKnownStakerSet,
      observedPositionGrowth: null,
    },
    nowMs,
    historyDepthDays,
    database: options.database,
  })
}
