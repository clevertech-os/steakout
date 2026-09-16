/**
 * Canary / probe-stake roster (public addresses only).
 *
 * Loaded from `server/config/probe-roster.public.json` (or PROBE_ROSTER_PATH).
 * Never contains private keys. Used to attach monitoring placeholders on
 * validator profiles until payout / position observations accumulate.
 */

import type Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAddress } from './addresses.js'
import {
  buildNimiqAddressExplorerUrl,
  buildNimiqExplorerUrl,
} from './explorer.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROSTER_PATH = join(MODULE_DIR, '../config/probe-roster.public.json')

export type ProbePayoutType = 'direct' | 'restake' | 'unknown'

export interface ProbeRosterEntry {
  probeId: string
  probeAddress: string
  probeAddressCompact: string
  validatorName: string | null
  validatorAddress: string
  validatorAddressCompact: string
  declaredFee: string | null
  payoutType: ProbePayoutType
  payoutSchedule: string | null
  stakeAmountNim: string | null
  stakeAmountLuna: number | null
  stakedAt: string | null
  stakeTxHash: string | null
}

export interface ProbeRosterFile {
  version: number
  kind: string
  batchId: string
  network: string
  createdAt: string
  description?: string
  probes: ProbeRosterEntry[]
}

/**
 * Monitoring block on validator profile / list.
 * Observation fields stay null until indexed evidence exists.
 */
export interface CanaryProbeSummary {
  /** Whether this validator has a configured Steakout canary stake. */
  configured: boolean
  /**
   * pending = configured, waiting for first observation window
   * active = at least one observation field populated
   * not-configured = no canary for this validator
   */
  status: 'not-configured' | 'pending' | 'active'
  /** Neutral UI label (never accusatory). */
  statusLabel: string
  probeId: string | null
  probeAddress: string | null
  probeExplorerUrl: string | null
  stakeAmountLuna: number | null
  stakedAt: string | null
  stakeTxHash: string | null
  stakeExplorerUrl: string | null
  payoutType: ProbePayoutType | null
  /** Last observed direct payment to the probe (from reward address), if any. */
  lastPaymentAt: string | null
  lastPaymentLuna: number | null
  lastPaymentTxHash: string | null
  lastPaymentExplorerUrl: string | null
  /**
   * Last known staker total balance for the probe (restake path / future snapshots).
   * Null until snapshotting or a live read is wired.
   */
  lastStakerBalanceLuna: number | null
  lastStakerBalanceAt: string | null
  /** Number of indexed probe observations (payments and/or snapshots). */
  observationCount: number
  /** Earliest indexed probe observation, when history exists. */
  firstObservedAt: string | null
  /** Latest indexed probe observation, when history exists. */
  lastObservedAt: string | null
  /** Elapsed indexed observation history in days, relative to `nowMs`. */
  historyDepthDays: number
  /** One-line operator-facing note for empty fields. */
  note: string
  /** Data status for the observation metrics group. */
  dataStatus: 'insufficient' | 'verified' | 'unavailable'
}

export type CanaryCoverageStatus = 'pending' | 'observed' | 'unavailable'

export interface CanaryCoverageSummary {
  configuredCount: number
  payoutTypes: {
    direct: number
    restake: number
    unknown: number
  }
  statuses: {
    pending: number
    observed: number
    unavailable: number
  }
}

const NOT_CONFIGURED: CanaryProbeSummary = {
  configured: false,
  status: 'not-configured',
  statusLabel: 'Not configured',
  probeId: null,
  probeAddress: null,
  probeExplorerUrl: null,
  stakeAmountLuna: null,
  stakedAt: null,
  stakeTxHash: null,
  stakeExplorerUrl: null,
  payoutType: null,
  lastPaymentAt: null,
  lastPaymentLuna: null,
  lastPaymentTxHash: null,
  lastPaymentExplorerUrl: null,
  lastStakerBalanceLuna: null,
  lastStakerBalanceAt: null,
  observationCount: 0,
  firstObservedAt: null,
  lastObservedAt: null,
  historyDepthDays: 0,
  note: 'No Steakout canary probe is configured for this validator.',
  dataStatus: 'unavailable',
}

let cachedRoster: ProbeRosterFile | null | undefined
let cachedPath: string | null = null
let byValidatorCompact: Map<string, ProbeRosterEntry> | null = null

function resolveRosterPath(): string {
  const fromEnv = process.env.PROBE_ROSTER_PATH?.trim()
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : join(process.cwd(), fromEnv)
  }
  return DEFAULT_ROSTER_PATH
}

function asPayoutType(value: unknown): ProbePayoutType {
  if (value === 'direct' || value === 'restake' || value === 'unknown') return value
  return 'unknown'
}

function normalizeEntry(raw: Record<string, unknown>): ProbeRosterEntry | null {
  const probeAddress =
    typeof raw.probeAddress === 'string' ? raw.probeAddress.trim() : ''
  const validatorAddress =
    typeof raw.validatorAddress === 'string' ? raw.validatorAddress.trim() : ''
  if (!probeAddress || !validatorAddress) return null

  const stakeLunaRaw = raw.stakeAmountLuna
  let stakeAmountLuna: number | null = null
  if (typeof stakeLunaRaw === 'number' && Number.isFinite(stakeLunaRaw)) {
    stakeAmountLuna = Math.trunc(stakeLunaRaw)
  } else if (typeof stakeLunaRaw === 'string' && /^\d+$/.test(stakeLunaRaw)) {
    stakeAmountLuna = Number(stakeLunaRaw)
  }

  return {
    probeId: typeof raw.probeId === 'string' ? raw.probeId : 'probe',
    probeAddress,
    probeAddressCompact:
      typeof raw.probeAddressCompact === 'string'
        ? raw.probeAddressCompact
        : normalizeAddress(probeAddress),
    validatorName: typeof raw.validatorName === 'string' ? raw.validatorName : null,
    validatorAddress,
    validatorAddressCompact:
      typeof raw.validatorAddressCompact === 'string'
        ? raw.validatorAddressCompact
        : normalizeAddress(validatorAddress),
    declaredFee: typeof raw.declaredFee === 'string' ? raw.declaredFee : null,
    payoutType: asPayoutType(raw.payoutType),
    payoutSchedule:
      typeof raw.payoutSchedule === 'string' ? raw.payoutSchedule : null,
    stakeAmountNim:
      typeof raw.stakeAmountNim === 'string' ? raw.stakeAmountNim : null,
    stakeAmountLuna,
    stakedAt: typeof raw.stakedAt === 'string' ? raw.stakedAt : null,
    stakeTxHash: typeof raw.stakeTxHash === 'string' ? raw.stakeTxHash : null,
  }
}

/**
 * Load (and cache) the public probe roster. Missing file → empty roster.
 */
export function loadProbeRoster(options?: {
  path?: string
  /** Force re-read from disk (tests). */
  reload?: boolean
}): ProbeRosterFile {
  // Prefer explicit path, then already-cached path, then default / env.
  const path = options?.path ?? cachedPath ?? resolveRosterPath()
  if (
    !options?.reload &&
    cachedRoster !== undefined &&
    cachedPath === path
  ) {
    return (
      cachedRoster ?? {
        version: 1,
        kind: 'steakout-probe-roster-public',
        batchId: 'none',
        network: 'main',
        createdAt: new Date(0).toISOString(),
        probes: [],
      }
    )
  }

  cachedPath = path
  byValidatorCompact = null

  if (!existsSync(path)) {
    cachedRoster = {
      version: 1,
      kind: 'steakout-probe-roster-public',
      batchId: 'none',
      network: 'main',
      createdAt: new Date(0).toISOString(),
      probes: [],
    }
    return cachedRoster
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const probesRaw = Array.isArray(raw.probes) ? raw.probes : []
    const probes: ProbeRosterEntry[] = []
    for (const item of probesRaw) {
      if (!item || typeof item !== 'object') continue
      const entry = normalizeEntry(item as Record<string, unknown>)
      if (entry) probes.push(entry)
    }
    cachedRoster = {
      version: typeof raw.version === 'number' ? raw.version : 1,
      kind:
        typeof raw.kind === 'string' ? raw.kind : 'steakout-probe-roster-public',
      batchId: typeof raw.batchId === 'string' ? raw.batchId : 'unknown',
      network: typeof raw.network === 'string' ? raw.network : 'main',
      createdAt:
        typeof raw.createdAt === 'string'
          ? raw.createdAt
          : new Date(0).toISOString(),
      description:
        typeof raw.description === 'string' ? raw.description : undefined,
      probes,
    }
  } catch {
    cachedRoster = {
      version: 1,
      kind: 'steakout-probe-roster-public',
      batchId: 'error',
      network: 'main',
      createdAt: new Date(0).toISOString(),
      probes: [],
    }
  }
  return cachedRoster
}

export function resetProbeRosterCache(): void {
  cachedRoster = undefined
  cachedPath = null
  byValidatorCompact = null
}

function indexByValidator(): Map<string, ProbeRosterEntry> {
  if (byValidatorCompact) return byValidatorCompact
  const roster = loadProbeRoster()
  const map = new Map<string, ProbeRosterEntry>()
  for (const probe of roster.probes) {
    map.set(normalizeAddress(probe.validatorAddress), probe)
  }
  byValidatorCompact = map
  return map
}

export function getProbeForValidator(
  validatorAddress: string,
): ProbeRosterEntry | null {
  return indexByValidator().get(normalizeAddress(validatorAddress)) ?? null
}

interface LastPaymentRow {
  timestamp: string
  value_luna: number
  hash: string
}

interface ProbeObservationHistory {
  count: number
  firstAt: string | null
  lastAt: string | null
}

/**
 * Latest successful inbound tx to the probe from the validator reward address
 * (when both are known and the indexer has the row).
 */
export function findLastProbePayment(
  database: Database.Database,
  options: {
    probeAddress: string
    rewardAddress: string | null
  },
): LastPaymentRow | null {
  if (!options.rewardAddress) return null
  const probe = normalizeAddress(options.probeAddress)
  const reward = normalizeAddress(options.rewardAddress)

  // Match compact or spaced forms in DB.
  const row = database
    .prepare(
      `
      SELECT hash, value_luna, timestamp
      FROM transactions
      WHERE execution_result = 'ok'
        AND REPLACE(UPPER(to_address), ' ', '') = ?
        AND REPLACE(UPPER(from_address), ' ', '') = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    )
    .get(probe, reward) as LastPaymentRow | undefined

  return row ?? null
}

/**
 * Latest staker snapshot for the probe address (if snapshots exist).
 */
export function findLastProbeStakerSnapshot(
  database: Database.Database,
  probeAddress: string,
): { total_balance_luna: number; observed_at: string } | null {
  const probe = normalizeAddress(probeAddress)
  const row = database
    .prepare(
      `
      SELECT total_balance_luna, observed_at
      FROM staker_snapshots
      WHERE REPLACE(UPPER(user_address), ' ', '') = ?
      ORDER BY observed_at DESC
      LIMIT 1
    `,
    )
    .get(probe) as { total_balance_luna: number; observed_at: string } | undefined
  return row ?? null
}

/**
 * Count indexed evidence for one probe. Transactions are restricted to an
 * execution-successful reward→probe path; snapshots are chain reads stored by
 * the indexer. This is evidence metadata only, never a payout-rate claim.
 */
function findProbeObservationHistory(
  database: Database.Database,
  options: {
    probeAddress: string
    rewardAddress?: string | null
    payoutType: ProbePayoutType
  },
): ProbeObservationHistory {
  const probe = normalizeAddress(options.probeAddress)
  let paymentCount = 0
  let paymentFirst: string | null = null
  let paymentLast: string | null = null
  if (options.payoutType !== 'restake' && options.rewardAddress) {
    const reward = normalizeAddress(options.rewardAddress)
    const row = database
      .prepare(
        `
        SELECT COUNT(*) AS count, MIN(timestamp) AS first_at, MAX(timestamp) AS last_at
        FROM transactions
        WHERE execution_result = 'ok'
          AND REPLACE(UPPER(to_address), ' ', '') = ?
          AND REPLACE(UPPER(from_address), ' ', '') = ?
        `,
      )
      .get(probe, reward) as {
      count: number
      first_at: string | null
      last_at: string | null
    }
    paymentCount = Number.isFinite(row?.count) ? row.count : 0
    paymentFirst = row?.first_at ?? null
    paymentLast = row?.last_at ?? null
  }

  const snapshot = options.payoutType === 'direct'
    ? { count: 0, first_at: null, last_at: null }
    : database
    .prepare(
      `
      SELECT COUNT(*) AS count, MIN(observed_at) AS first_at, MAX(observed_at) AS last_at
      FROM staker_snapshots
      WHERE REPLACE(UPPER(user_address), ' ', '') = ?
      `,
    )
    .get(probe) as {
    count: number
    first_at: string | null
    last_at: string | null
  }
  const snapshotCount = Number.isFinite(snapshot?.count) ? snapshot.count : 0
  const firstCandidates = [paymentFirst, snapshot?.first_at].filter(
    (value): value is string => Boolean(value),
  )
  const lastCandidates = [paymentLast, snapshot?.last_at].filter(
    (value): value is string => Boolean(value),
  )
  return {
    count: paymentCount + snapshotCount,
    firstAt:
      firstCandidates.length > 0
        ? firstCandidates.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
        : null,
    lastAt:
      lastCandidates.length > 0
        ? lastCandidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
        : null,
  }
}

export function buildCanaryProbeSummary(
  validatorAddress: string,
  options?: {
    database?: Database.Database
    rewardAddress?: string | null
    nowMs?: number
  },
): CanaryProbeSummary {
  const entry = getProbeForValidator(validatorAddress)
  if (!entry) return { ...NOT_CONFIGURED }

  let lastPaymentAt: string | null = null
  let lastPaymentLuna: number | null = null
  let lastPaymentTxHash: string | null = null
  let lastStakerBalanceLuna: number | null = null
  let lastStakerBalanceAt: string | null = null
  let observationCount = 0
  let firstObservedAt: string | null = null
  let lastObservedAt: string | null = null

  if (options?.database) {
    const payment = findLastProbePayment(options.database, {
      probeAddress: entry.probeAddress,
      rewardAddress: options.rewardAddress ?? null,
    })
    if (payment) {
      lastPaymentAt = payment.timestamp
      lastPaymentLuna = payment.value_luna
      lastPaymentTxHash = payment.hash
    }
    const snap = findLastProbeStakerSnapshot(
      options.database,
      entry.probeAddress,
    )
    if (snap) {
      lastStakerBalanceLuna = snap.total_balance_luna
      lastStakerBalanceAt = snap.observed_at
    }
    const history = findProbeObservationHistory(options.database, {
      probeAddress: entry.probeAddress,
      rewardAddress: options.rewardAddress ?? null,
      payoutType: entry.payoutType,
    })
    observationCount = history.count
    firstObservedAt = history.firstAt
    lastObservedAt = history.lastAt
  }

  const hasObservation = entry.payoutType === 'direct'
    ? lastPaymentAt != null
    : entry.payoutType === 'restake'
      ? lastStakerBalanceAt != null
      : lastPaymentAt != null || lastStakerBalanceAt != null

  const status: CanaryProbeSummary['status'] = hasObservation
    ? 'active'
    : 'pending'

  const note = hasObservation
    ? 'Canary probe observations are partial; more history improves reliability.'
    : 'Canary probe is staked. Payout and position fields stay pending until Steakout indexes enough history (typically days to weeks).'
  const historyDepthDays =
    firstObservedAt && Number.isFinite(Date.parse(firstObservedAt))
      ? Math.max(
        0,
        ((options?.nowMs ?? Date.now()) - Date.parse(firstObservedAt)) / 86_400_000,
      )
      : 0

  return {
    configured: true,
    status,
    statusLabel: hasObservation ? 'Observing' : 'Pending observation',
    probeId: entry.probeId,
    probeAddress: entry.probeAddress,
    probeExplorerUrl: buildNimiqAddressExplorerUrl(entry.probeAddress),
    stakeAmountLuna: entry.stakeAmountLuna,
    stakedAt: entry.stakedAt,
    stakeTxHash: entry.stakeTxHash,
    stakeExplorerUrl: entry.stakeTxHash
      ? buildNimiqExplorerUrl(entry.stakeTxHash)
      : null,
    payoutType: entry.payoutType,
    lastPaymentAt,
    lastPaymentLuna,
    lastPaymentTxHash,
    lastPaymentExplorerUrl: lastPaymentTxHash
      ? buildNimiqExplorerUrl(lastPaymentTxHash)
      : null,
    lastStakerBalanceLuna,
    lastStakerBalanceAt,
    observationCount,
    firstObservedAt,
    lastObservedAt,
    historyDepthDays,
    note,
    dataStatus: hasObservation ? 'verified' : 'insufficient',
  }
}

/**
 * Aggregate configured canaries and classify each from indexed evidence.
 * `pending` means the evidence path is checkable but no evidence is indexed;
 * `unavailable` means the roster/registry cannot currently support that check.
 */
export function buildCanaryCoverageSummary(
  database?: Database.Database,
): CanaryCoverageSummary {
  const roster = loadProbeRoster()
  const summary: CanaryCoverageSummary = {
    configuredCount: roster.probes.length,
    payoutTypes: { direct: 0, restake: 0, unknown: 0 },
    statuses: { pending: 0, observed: 0, unavailable: 0 },
  }
  if (!database) {
    for (const probe of roster.probes) {
      summary.payoutTypes[probe.payoutType] += 1
      summary.statuses.unavailable += 1
    }
    return summary
  }

  const rewardRows = database.prepare(`
    SELECT address, reward_address FROM validators
  `).all() as Array<{ address: string; reward_address: string | null }>
  const rewardByValidator = new Map<string, string | null>()
  for (const row of rewardRows) {
    rewardByValidator.set(normalizeAddress(row.address), row.reward_address)
  }

  for (const probe of roster.probes) {
    summary.payoutTypes[probe.payoutType] += 1
    const rewardAddress = rewardByValidator.get(normalizeAddress(probe.validatorAddress)) ?? null
    const payment = database && rewardAddress
      ? findLastProbePayment(database, {
        probeAddress: probe.probeAddress,
        rewardAddress,
      })
      : null
    const snapshot = database
      ? findLastProbeStakerSnapshot(database, probe.probeAddress)
      : null
    const observed = probe.payoutType === 'direct'
      ? payment != null
      : probe.payoutType === 'restake'
        ? snapshot != null
        : payment != null || snapshot != null
    if (observed) {
      summary.statuses.observed += 1
      continue
    }
    const checkable = probe.payoutType === 'restake'
      || (probe.payoutType === 'direct' && rewardAddress != null)
    summary.statuses[checkable ? 'pending' : 'unavailable'] += 1
  }
  return summary
}

/** List-level compact flag (no DB observation fan-out). */
export function canaryConfiguredForValidator(validatorAddress: string): boolean {
  return getProbeForValidator(validatorAddress) != null
}
