/**
 * Personal continuity for authenticated stakers (P2-05).
 *
 * API.md §5 `GET /api/me/observations`, METHODOLOGY.md §4.4 / §5, SPEC §7.2–7.3.
 *
 * Direct-payout: last observed payment, consecutive windows including the address,
 * windows observed, time since last payment, known-staker-set membership.
 * Restake: multi-snapshot Observed position growth from staker_snapshots (never payout claims).
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
  type NimiqTransaction,
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
import { syncStakerHistory } from './stakerHistory.js'

export type ContinuityMode = 'not-staked' | 'direct-payout' | 'restake' | 'unknown-payout'

export type ContinuityEnvelopeStatus = EnvelopeStatus

export type ContinuitySource = 'indexer' | 'rpc' | 'cache'

/** Fixed label — METHODOLOGY.md §5. Never "Validator payout verified". */
export const OBSERVED_POSITION_GROWTH_LABEL = 'Observed position growth' as const

export const OBSERVED_POSITION_GROWTH_STATUS = {
  OBSERVED: 'observed',
  INSUFFICIENT_DATA: 'insufficient-data',
} as const

/**
 * These are deliberately broad, presentation-only assumptions. They are not
 * live network data, validator-specific estimates, APY, or a promise of
 * return. Keep them versioned so a copy/calculation change is auditable.
 */
export const ILLUSTRATIVE_GROWTH_RANGE = {
  version: 'illustrative-v1',
  annualRateLowPercent: 2,
  annualRateHighPercent: 5,
  assumptions:
    'Illustrative network-wide range of roughly a few percent per year; not live network data, validator-specific, predictive, or guaranteed.',
} as const

export type PositionGrowthStatus =
  (typeof OBSERVED_POSITION_GROWTH_STATUS)[keyof typeof OBSERVED_POSITION_GROWTH_STATUS]

export interface GrowthSnapshot {
  at: string
  totalLuna: number
  sourceBlock: number | null
  validatorAddress: string | null
}

export interface GrowthInterval {
  from: GrowthSnapshot
  to: GrowthSnapshot
  deltaLuna: number
  status: 'observed' | 'confounded'
  /** Why this interval is excluded from the aggregate, when applicable. */
  confoundedBy:
    | 'staking-intent'
    | 'delegation-change'
    | 'chain-staking-action'
    | 'chain-history-unavailable'
    | null
}

export interface IllustrativeGrowthRange {
  version: typeof ILLUSTRATIVE_GROWTH_RANGE.version
  lowerLuna: number
  upperLuna: number
  annualRateLowPercent: typeof ILLUSTRATIVE_GROWTH_RANGE.annualRateLowPercent
  annualRateHighPercent: typeof ILLUSTRATIVE_GROWTH_RANGE.annualRateHighPercent
  assumptions: typeof ILLUSTRATIVE_GROWTH_RANGE.assumptions
  status: 'inferred'
  methodologyUrl: '#/learn/methodology'
}

export interface ObservedPositionGrowth {
  label: typeof OBSERVED_POSITION_GROWTH_LABEL
  definition: 'Change in this staker position between indexed snapshots.'
  status: PositionGrowthStatus
  latest: GrowthSnapshot | null
  previous: GrowthSnapshot | null
  /** latest.totalLuna − previous.totalLuna when both present; otherwise null. */
  deltaLuna: number | null
  /** Aggregate of usable intervals; null when history is insufficient. */
  totalDeltaLuna: number | null
  window: { from: string; to: string; durationDays: number } | null
  intervals: GrowthInterval[]
  expectedRange: IllustrativeGrowthRange | null
  freshness: { at: string; ageSeconds: number; sourceBlock: number | null } | null
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
   * Restake-only history into snapshot observations. Null for direct-payout / not-staked.
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
  /** Inject address-history pagination (unit tests). */
  fetchHistoryPage?: (
    address: string,
    max: number,
    startAt: string | null,
  ) => Promise<NimiqTransaction[]>
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
  nowMs = Date.now(),
): ObservedPositionGrowth {
  const user = normalizeAddress(userAddress)
  const rows = database
    .prepare(
      `SELECT id, observed_at, total_balance_luna, source_block, validator_address
       FROM staker_snapshots
       WHERE replace(upper(user_address), ' ', '') = ?
       ORDER BY observed_at DESC, id DESC
       LIMIT 100`,
    )
    .all(user) as Array<{
    id: number
    observed_at: string
    total_balance_luna: number
    source_block: number | null
    validator_address: string | null
  }>

  const oldestFirst = [...rows].reverse()
  const toSnapshot = (row: (typeof rows)[number]): GrowthSnapshot => ({
    at: row.observed_at,
    totalLuna: row.total_balance_luna,
    sourceBlock: typeof row.source_block === 'number' ? row.source_block : null,
    validatorAddress:
      typeof row.validator_address === 'string' && row.validator_address.trim() !== ''
        ? normalizeAddress(row.validator_address)
        : null,
  })

  const latestRow = rows[0]
  const previousRow = rows[1]

  const latest = latestRow != null ? toSnapshot(latestRow) : null
  const previous = previousRow != null ? toSnapshot(previousRow) : null

  const deltaLuna =
    latest != null && previous != null
      ? latest.totalLuna - previous.totalLuna
      : null

  const intentRows = database
    .prepare(
      `SELECT created_at, confirmed_at, expires_at, status
       FROM staking_intents
       WHERE replace(upper(user_address), ' ', '') = ?
         AND status != 'failed'`,
    )
    .all(user) as Array<{
    created_at: string
    confirmed_at: string | null
    expires_at: string
    status: string
  }>

  const hasIntentBetween = (from: string, to: string): boolean => {
    const fromMs = Date.parse(from)
    const toMs = Date.parse(to)
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return false
    return intentRows.some((intent) => {
      const createdMs = Date.parse(intent.created_at)
      if (Number.isNaN(createdMs) || createdMs > toMs) return false

      // A confirmed intent is confounding from creation until confirmation.
      // Pending and other unresolved intents remain confounding through their
      // expiry, or through the end of this interval when no usable expiry is
      // recorded. Inclusive bounds are intentional: this fails closed when a
      // snapshot and an intent boundary share a timestamp.
      const confirmedMs =
        intent.status === 'confirmed' && intent.confirmed_at
          ? Date.parse(intent.confirmed_at)
          : Number.NaN
      const expiresMs = Date.parse(intent.expires_at)
      const endMs = Number.isFinite(confirmedMs)
        ? confirmedMs
        : Number.isFinite(expiresMs)
          ? expiresMs
          : toMs
      return endMs >= fromMs
    })
  }

  const chainActions = database.prepare(
    `SELECT observed_at FROM user_staking_actions
     WHERE user_address = ? ORDER BY observed_at`,
  ).all(user) as Array<{ observed_at: string }>
  const scan = database.prepare(
    `SELECT covered_from, scanned_at FROM user_staking_history_scans
     WHERE user_address = ?`,
  ).get(user) as { covered_from: string; scanned_at: string } | undefined
  const chainEvidenceFor = (from: string, to: string):
    'chain-staking-action' | 'chain-history-unavailable' | null => {
    const fromMs = Date.parse(from)
    const toMs = Date.parse(to)
    const coveredFromMs = scan ? Date.parse(scan.covered_from) : Number.NaN
    const scannedAtMs = scan ? Date.parse(scan.scanned_at) : Number.NaN
    if (
      Number.isNaN(fromMs) || Number.isNaN(toMs) ||
      Number.isNaN(coveredFromMs) || Number.isNaN(scannedAtMs) ||
      coveredFromMs > fromMs || scannedAtMs < toMs
    ) return 'chain-history-unavailable'
    return chainActions.some((action) => {
      const actionMs = Date.parse(action.observed_at)
      return Number.isFinite(actionMs) && actionMs >= fromMs && actionMs <= toMs
    }) ? 'chain-staking-action' : null
  }

  const intervals: GrowthInterval[] = []
  for (let index = 1; index < oldestFirst.length; index += 1) {
    const fromRow = oldestFirst[index - 1]
    const toRow = oldestFirst[index]
    if (!fromRow || !toRow) continue
    const from = toSnapshot(fromRow)
    const to = toSnapshot(toRow)
    const fromDelegation = normalizeAddress(fromRow.validator_address ?? '')
    const toDelegation = normalizeAddress(toRow.validator_address ?? '')
    const delegationChanged = fromDelegation !== toDelegation
    const confoundedBy = delegationChanged
      ? 'delegation-change'
      : hasIntentBetween(from.at, to.at)
        ? 'staking-intent'
        : chainEvidenceFor(from.at, to.at)
    intervals.push({
      from,
      to,
      deltaLuna: to.totalLuna - from.totalLuna,
      status: confoundedBy == null ? 'observed' : 'confounded',
      confoundedBy,
    })
  }

  const observedIntervals = intervals.filter((interval) => interval.status === 'observed')
  const usableIntervals = observedIntervals.filter((interval) => {
    const fromMs = Date.parse(interval.from.at)
    const toMs = Date.parse(interval.to.at)
    return !Number.isNaN(fromMs) && !Number.isNaN(toMs) && toMs > fromMs
  })
  const totalDeltaLuna =
    usableIntervals.length > 0
      ? usableIntervals.reduce((sum, interval) => sum + interval.deltaLuna, 0)
      : null
  const firstObserved = usableIntervals[0]
  const lastObserved = usableIntervals[usableIntervals.length - 1]
  const window =
    firstObserved && lastObserved
      ? (() => {
          const fromMs = Date.parse(firstObserved.from.at)
          const toMs = Date.parse(lastObserved.to.at)
          if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return null
          return {
            from: firstObserved.from.at,
            to: lastObserved.to.at,
            durationDays: Math.floor(((toMs - fromMs) / 86_400_000) * 10) / 10,
          }
        })()
      : null
  const expectedRange =
    usableIntervals.length > 0
      ? (() => {
          let lowerLuna = 0
          let upperLuna = 0
          for (const interval of usableIntervals) {
            const fromMs = Date.parse(interval.from.at)
            const toMs = Date.parse(interval.to.at)
            if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) continue
            const years = (toMs - fromMs) / (365.25 * 86_400_000)
            lowerLuna += interval.from.totalLuna * (ILLUSTRATIVE_GROWTH_RANGE.annualRateLowPercent / 100) * years
            upperLuna += interval.from.totalLuna * (ILLUSTRATIVE_GROWTH_RANGE.annualRateHighPercent / 100) * years
          }
          return {
            version: ILLUSTRATIVE_GROWTH_RANGE.version,
            lowerLuna: Math.floor(lowerLuna),
            upperLuna: Math.ceil(upperLuna),
            annualRateLowPercent: ILLUSTRATIVE_GROWTH_RANGE.annualRateLowPercent,
            annualRateHighPercent: ILLUSTRATIVE_GROWTH_RANGE.annualRateHighPercent,
            assumptions: ILLUSTRATIVE_GROWTH_RANGE.assumptions,
            status: 'inferred' as const,
            methodologyUrl: '#/learn/methodology' as const,
          }
        })()
      : null
  const freshness =
    latest != null
      ? {
          at: latest.at,
          ageSeconds: Number.isFinite(Date.parse(latest.at))
            ? Math.max(0, Math.floor((nowMs - Date.parse(latest.at)) / 1000))
            : 0,
          sourceBlock: latest.sourceBlock,
        }
      : null

  return {
    label: OBSERVED_POSITION_GROWTH_LABEL,
    definition: 'Change in this staker position between indexed snapshots.',
    status:
      rows.length >= 2 && usableIntervals.length > 0
        ? OBSERVED_POSITION_GROWTH_STATUS.OBSERVED
        : OBSERVED_POSITION_GROWTH_STATUS.INSUFFICIENT_DATA,
    latest,
    previous,
    deltaLuna,
    totalDeltaLuna,
    window,
    intervals,
    expectedRange,
    freshness,
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
    let growth = readObservedPositionGrowth(options.database, address, nowMs)
    const earliest = growth.intervals[0]?.from.at
    if (earliest != null) {
      try {
        await syncStakerHistory({
          database: options.database,
          userAddress: address,
          requiredFrom: earliest,
          requiredThrough: growth.latest?.at ?? earliest,
          rpcUrl: options.rpcUrl,
          fetchPage: options.fetchHistoryPage,
          now: options.now,
        })
      } catch {
        // Persisted coverage is read below. Missing live history fails closed
        // as a confounded interval instead of making an attribution guess.
      }
      growth = readObservedPositionGrowth(options.database, address, nowMs)
    }
    const hasSnapshots = growth.latest != null
    return continuityEnvelope({
      updatedAt,
      source: hasSnapshots ? 'indexer' : 'rpc',
      baseStatus: growth.status === 'observed' ? 'ok' : 'partial',
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
      historyDepthDays: growth.window?.durationDays ?? null,
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
