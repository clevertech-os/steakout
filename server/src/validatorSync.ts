/**
 * P1-04 — Validator registry sync + public list/detail serialization.
 *
 * Fetches known-only + all-observable registry modes via `validators-api.ts`,
 * resolves reward addresses for validators that lack one, upserts into
 * `validators` (including `schedule_every_hours` from P2-02 normalizeSchedule),
 * and exposes query helpers for GET /api/validators[/:address].
 */

import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { isValidNimiqAddress, normalizeAddress } from './addresses.js'
import { buildNimiqAddressExplorerUrl } from './explorer.js'
import {
  applyIndexerStaleStatus,
  buildDataFreshness,
  getIndexerWatermarkIso,
  type EnvelopeStatus,
} from './freshness.js'
import { incrementMetric, METRIC_KEYS } from './metrics.js'
import { loadObservationSummaries } from './observationScoring.js'
import {
  buildPublicCacheKey,
  clearPublicResponseCache,
  getCachedPublicResponse,
  PUBLIC_CACHE_CONTROL,
  setCachedPublicResponse,
} from './responseCache.js'
import {
  fetchValidators,
  type FetchValidatorsOptions,
  type NormalizedValidator,
  type RewardAddressResolver,
  type ValidatorSnapshot,
} from './validators-api.js'

const DEFAULT_SYNC_INTERVAL_MS = 60 * 60_000

export type ValidatorSort =
  | 'recommended'
  | 'score'
  | 'dominance'
  | 'stake'
  | 'direct-payout'
  | 'restake'
  | 'new'

export type ObservationStatus =
  | 'on-schedule'
  | 'mostly-on-schedule'
  | 'irregular'
  | 'insufficient-data'
  | 'unavailable'

export type DeclaredPayoutType = 'direct' | 'restake' | 'unknown'

export interface ValidatorRow {
  address: string
  name: string | null
  website: string | null
  description: string | null
  logo_url: string | null
  fee_declared: string | null
  payout_type_declared: string | null
  payout_schedule_declared: string | null
  schedule_every_hours: number | null
  reward_address: string | null
  official_score: number | null
  dominance_ratio: number | null
  stake_luna: number | null
  stakers_count: number | null
  is_listed: number
  registry_updated_at: string | null
}

export interface ValidatorListItem {
  address: string
  name: string | null
  isListed: boolean
  logoUrl: string | null
  officialScore: number | null
  stakeLuna: number | null
  dominanceRatio: number | null
  stakersCount: number | null
  declared: {
    fee: string | null
    payoutType: DeclaredPayoutType
    payoutSchedule: string | null
    scheduleNormalized: { everyHours: number } | null
  }
  observation: {
    status: ObservationStatus
    lastObservedAt: string | null
    historyDepthDays: number
  }
  registryUpdatedAt: string
}

export interface ValidatorProfile extends ValidatorListItem {
  website: string | null
  description: string | null
  rewardAddress: string | null
  rewardExplorerUrl: string | null
  /** Registry score components are not persisted in v1 schema; always null until stored. */
  scoreComponents: null
}

export interface SyncResult {
  knownOnly: ValidatorSnapshot
  allObservable: ValidatorSnapshot
  upserted: number
  rewardAddressesResolved: number
  registryUpdatedAt: string
}

export interface ValidatorSyncOptions {
  database: Database.Database
  fetchOptions?: FetchValidatorsOptions
  /** When true (default), resolve reward addresses only for rows missing one. */
  resolveRewardAddresses?: boolean
  now?: () => string
  logger?: (line: string) => void
}

export interface ListValidatorsOptions {
  sort?: ValidatorSort
  listed?: boolean
  /** Wall clock for historyDepthDays (earliest → now). Defaults to Date.now(). */
  nowMs?: number
}

const VALID_SORTS = new Set<ValidatorSort>([
  'recommended',
  'score',
  'dominance',
  'stake',
  'direct-payout',
  'restake',
  'new',
])

const STUB_OBSERVATION: ValidatorListItem['observation'] = {
  status: 'insufficient-data',
  lastObservedAt: null,
  historyDepthDays: 0,
}

function defaultLogger(line: string): void {
  console.log(line)
}

function compactKey(address: string): string {
  return normalizeAddress(address)
}

function asPayoutType(value: string | null): DeclaredPayoutType {
  if (value === 'direct' || value === 'restake') return value
  return 'unknown'
}

/**
 * Map a NormalizedValidator into DB bind params.
 * `schedule_every_hours` is written from `scheduleEveryHours` (P2-02 wire-in).
 */
function rowFromNormalized(
  validator: NormalizedValidator,
  rewardAddress: string | null,
  registryUpdatedAt: string,
): Omit<ValidatorRow, never> {
  return {
    address: validator.address,
    name: validator.name,
    website: validator.website,
    description: validator.description,
    logo_url: null,
    fee_declared: validator.fee,
    payout_type_declared: validator.payoutType,
    payout_schedule_declared: validator.payoutSchedule,
    schedule_every_hours: validator.scheduleEveryHours,
    reward_address: rewardAddress,
    official_score: validator.officialScore,
    dominance_ratio: validator.dominanceRatio,
    stake_luna: validator.stakeLuna,
    stakers_count: validator.stakersCount,
    is_listed: validator.isListed === true ? 1 : 0,
    registry_updated_at: registryUpdatedAt,
  }
}

export function upsertValidators(
  database: Database.Database,
  validators: readonly NormalizedValidator[],
  options: {
    existingRewardByCompact?: Map<string, string | null>
    registryUpdatedAt: string
  },
): { upserted: number; rewardAddressesKept: number } {
  const statement = database.prepare(`
    INSERT INTO validators (
      address, name, website, description, logo_url,
      fee_declared, payout_type_declared, payout_schedule_declared, schedule_every_hours,
      reward_address, official_score, dominance_ratio, stake_luna, stakers_count,
      is_listed, registry_updated_at
    ) VALUES (
      @address, @name, @website, @description, @logo_url,
      @fee_declared, @payout_type_declared, @payout_schedule_declared, @schedule_every_hours,
      @reward_address, @official_score, @dominance_ratio, @stake_luna, @stakers_count,
      @is_listed, @registry_updated_at
    )
    ON CONFLICT(address) DO UPDATE SET
      name = excluded.name,
      website = excluded.website,
      description = excluded.description,
      logo_url = COALESCE(excluded.logo_url, validators.logo_url),
      fee_declared = excluded.fee_declared,
      payout_type_declared = excluded.payout_type_declared,
      payout_schedule_declared = excluded.payout_schedule_declared,
      schedule_every_hours = excluded.schedule_every_hours,
      reward_address = COALESCE(excluded.reward_address, validators.reward_address),
      official_score = excluded.official_score,
      dominance_ratio = excluded.dominance_ratio,
      stake_luna = excluded.stake_luna,
      stakers_count = excluded.stakers_count,
      is_listed = excluded.is_listed,
      registry_updated_at = excluded.registry_updated_at
  `)

  let upserted = 0
  let rewardAddressesKept = 0
  const run = database.transaction((rows: readonly NormalizedValidator[]) => {
    for (const validator of rows) {
      const existing = options.existingRewardByCompact?.get(compactKey(validator.address))
      const resolved = validator.rewardAddress ?? existing ?? null
      if (!validator.rewardAddress && existing) rewardAddressesKept += 1
      statement.run(rowFromNormalized(validator, resolved, options.registryUpdatedAt))
      upserted += 1
    }
  })
  run(validators)
  return { upserted, rewardAddressesKept }
}

function loadExistingRewardMap(database: Database.Database): Map<string, string | null> {
  const rows = database.prepare(`
    SELECT address, reward_address FROM validators
  `).all() as Array<{ address: string; reward_address: string | null }>
  const map = new Map<string, string | null>()
  for (const row of rows) {
    map.set(compactKey(row.address), row.reward_address)
  }
  return map
}

/**
 * Merge known-only + all-observable snapshots by address.
 * All-observable is the superset; known-only overwrites when both present
 * (listed metadata is the more curated registry view).
 */
export function mergeSnapshots(
  knownOnly: ValidatorSnapshot,
  allObservable: ValidatorSnapshot,
): NormalizedValidator[] {
  const byCompact = new Map<string, NormalizedValidator>()
  for (const validator of allObservable.validators) {
    byCompact.set(compactKey(validator.address), validator)
  }
  for (const validator of knownOnly.validators) {
    byCompact.set(compactKey(validator.address), {
      ...validator,
      // Prefer an already-resolved reward address from either mode.
      rewardAddress:
        validator.rewardAddress
        ?? byCompact.get(compactKey(validator.address))?.rewardAddress
        ?? null,
      isListed: validator.isListed ?? true,
    })
  }
  return [...byCompact.values()]
}

async function resolveMissingRewards(
  validators: NormalizedValidator[],
  existing: Map<string, string | null>,
  resolver: RewardAddressResolver,
): Promise<number> {
  let resolved = 0
  for (const validator of validators) {
    const key = compactKey(validator.address)
    if (validator.rewardAddress) continue
    if (existing.get(key)) continue
    try {
      const reward = await resolver(validator.address)
      if (reward) {
        validator.rewardAddress = reward
        resolved += 1
      }
    } catch {
      // Leave null; next sync can backfill. Do not fail the whole cycle.
    }
  }
  return resolved
}

export async function syncValidators(options: ValidatorSyncOptions): Promise<SyncResult> {
  const now = options.now?.() ?? new Date().toISOString()
  const logger = options.logger ?? defaultLogger
  const resolveRewardAddresses = options.resolveRewardAddresses ?? true
  const fetchOptions: FetchValidatorsOptions = {
    ...options.fetchOptions,
    // Sync controls reward resolution (new validators only) after merge.
    resolveRewardAddresses: false,
    now: () => now,
  }

  const knownOnly = await fetchValidators('known-only', fetchOptions)
  const allObservable = await fetchValidators('all-observable', fetchOptions)
  const merged = mergeSnapshots(knownOnly, allObservable)
  const existing = loadExistingRewardMap(options.database)

  let rewardAddressesResolved = 0
  if (resolveRewardAddresses) {
    const resolver =
      options.fetchOptions?.resolveRewardAddress
      ?? (async () => null)
    // Prefer injected resolver; when none, only resolve if fetchOptions would have
    // (tests inject; production wires resolveRewardAddress via start options).
    if (options.fetchOptions?.resolveRewardAddress) {
      rewardAddressesResolved = await resolveMissingRewards(merged, existing, resolver)
    } else {
      // Live path: use validators-api default RPC resolver via a one-off fetch helper.
      const { getValidatorByAddress } = await import('./nimiq-rpc.js')
      rewardAddressesResolved = await resolveMissingRewards(
        merged,
        existing,
        async (address) => {
          const validator = await getValidatorByAddress(address, options.fetchOptions?.rpcUrl)
          return validator.rewardAddress
        },
      )
    }
  }

  const { upserted } = upsertValidators(options.database, merged, {
    existingRewardByCompact: existing,
    registryUpdatedAt: now,
  })

  // Drop rows not in this registry snapshot so a network switch (main ↔ test)
  // cannot leave the other chain's validators in the directory.
  const pruned = pruneValidatorsNotIn(
    options.database,
    merged.map((validator) => validator.address),
  )
  if (pruned > 0 || upserted > 0) {
    clearPublicResponseCache()
  }

  logger(JSON.stringify({
    validatorSync: 'cycle',
    upserted,
    pruned,
    rewardAddressesResolved,
    knownOnly: knownOnly.validators.length,
    allObservable: allObservable.validators.length,
    registryUpdatedAt: now,
    source: knownOnly.source,
  }))

  return {
    knownOnly,
    allObservable,
    upserted,
    rewardAddressesResolved,
    registryUpdatedAt: now,
  }
}

/**
 * Delete validators whose address is not in `keepAddresses` (normalized).
 * Used after a full registry sync so mainnet rows do not linger on testnet.
 */
export function pruneValidatorsNotIn(
  database: Database.Database,
  keepAddresses: readonly string[],
): number {
  const keep = new Set(
    keepAddresses
      .filter((address) => isValidNimiqAddress(address))
      .map((address) => compactKey(address)),
  )
  const rows = listValidatorRows(database)
  const del = database.prepare('DELETE FROM validators WHERE address = ?')
  let pruned = 0
  const run = database.transaction(() => {
    for (const row of rows) {
      if (!keep.has(compactKey(row.address))) {
        del.run(row.address)
        pruned += 1
      }
    }
  })
  run()
  return pruned
}

export function startValidatorSyncScheduler(
  options: ValidatorSyncOptions,
  intervalMs = DEFAULT_SYNC_INTERVAL_MS,
): { stop: () => void; runNow: () => Promise<SyncResult | null> } {
  let running = false
  const runNow = async (): Promise<SyncResult | null> => {
    if (running) return null
    running = true
    try {
      return await syncValidators(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ;(options.logger ?? defaultLogger)(JSON.stringify({
        validatorSync: 'cycle-error',
        error: message,
      }))
      return null
    } finally {
      running = false
    }
  }

  void runNow()
  const timer = setInterval(() => void runNow(), intervalMs)
  return { stop: () => clearInterval(timer), runNow }
}

export function listValidatorRows(database: Database.Database): ValidatorRow[] {
  return database.prepare(`
    SELECT
      address, name, website, description, logo_url,
      fee_declared, payout_type_declared, payout_schedule_declared, schedule_every_hours,
      reward_address, official_score, dominance_ratio, stake_luna, stakers_count,
      is_listed, registry_updated_at
    FROM validators
  `).all() as ValidatorRow[]
}

export function getValidatorRowByAddress(
  database: Database.Database,
  address: string,
): ValidatorRow | null {
  if (!isValidNimiqAddress(address)) return null
  const compact = compactKey(address)
  const rows = listValidatorRows(database)
  return rows.find((row) => compactKey(row.address) === compact) ?? null
}

function nullsLastCompare(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

/**
 * Lower rank = earlier in “recommended for transparency”.
 * Live schedule-adherence status when present; stubs default to insufficient-data.
 * Not a quality endorsement — prioritizes clearer observability signals first.
 */
export function observationTransparencyRank(status: ObservationStatus | null | undefined): number {
  switch (status) {
    case 'on-schedule':
      return 0
    case 'mostly-on-schedule':
      return 1
    case 'irregular':
      return 2
    case 'insufficient-data':
      return 3
    case 'unavailable':
      return 4
    default:
      return 3
  }
}

export interface CompareValidatorsOptions {
  /** Live observation status for A (from loadObservationSummaries); defaults to insufficient-data. */
  statusA?: ObservationStatus | null
  /** Live observation status for B. */
  statusB?: ObservationStatus | null
}

/**
 * Sort comparators for GET /api/validators?sort=
 *
 * `recommended` inputs (ordering keys only — not financial advice, not a
 * "best validator" ranking, not a quality claim):
 * 1. `is_listed` — listed/known registry flag first (curated metadata present)
 * 2. `schedule_every_hours` non-null — declared schedule is normalizable (METHODOLOGY §4.2),
 *    which is a prerequisite for schedule observation (not an endorsement)
 * 3. `payout_type_declared` — direct before restake before unknown (direct payouts are
 *    more chain-observable for the indexer; not a preference for stakers)
 * 4. live Steakout observation status when available (on-schedule → unavailable)
 * 5. `dominance_ratio` ascending — lower dominance first (SPEC §6.2: default sort must
 *    not simply reward the largest validator)
 * 6. `official_score` descending — official Nimiq Validator Trust Score when present; null last
 * 7. `address` ascending — stable deterministic tie-break
 *
 * Remaining sorts are explicit user-selected orderings (score, dominance, stake,
 * direct-payout, restake, new). None of these are labeled "best" or APY claims.
 */
export function compareValidators(
  a: ValidatorRow,
  b: ValidatorRow,
  sort: ValidatorSort,
  options: CompareValidatorsOptions = {},
): number {
  switch (sort) {
    case 'score':
      return nullsLastCompare(a.official_score, b.official_score, 'desc')
        || a.address.localeCompare(b.address)
    case 'dominance':
      return nullsLastCompare(a.dominance_ratio, b.dominance_ratio, 'asc')
        || a.address.localeCompare(b.address)
    case 'stake':
      return nullsLastCompare(a.stake_luna, b.stake_luna, 'desc')
        || a.address.localeCompare(b.address)
    case 'direct-payout': {
      const rank = (type: string | null) => (type === 'direct' ? 0 : type === 'restake' ? 1 : 2)
      return rank(a.payout_type_declared) - rank(b.payout_type_declared)
        || nullsLastCompare(a.stake_luna, b.stake_luna, 'desc')
        || a.address.localeCompare(b.address)
    }
    case 'restake': {
      const rank = (type: string | null) => (type === 'restake' ? 0 : type === 'direct' ? 1 : 2)
      return rank(a.payout_type_declared) - rank(b.payout_type_declared)
        || nullsLastCompare(a.stake_luna, b.stake_luna, 'desc')
        || a.address.localeCompare(b.address)
    }
    case 'new': {
      // Prefer validators with no official score / no normalizable schedule (insufficient data).
      const scoreA = a.official_score === null ? 0 : 1
      const scoreB = b.official_score === null ? 0 : 1
      if (scoreA !== scoreB) return scoreA - scoreB
      const schedA = a.schedule_every_hours === null ? 0 : 1
      const schedB = b.schedule_every_hours === null ? 0 : 1
      if (schedA !== schedB) return schedA - schedB
      const timeA = a.registry_updated_at ? Date.parse(a.registry_updated_at) : 0
      const timeB = b.registry_updated_at ? Date.parse(b.registry_updated_at) : 0
      return timeB - timeA || a.address.localeCompare(b.address)
    }
    case 'recommended':
    default: {
      if (a.is_listed !== b.is_listed) return b.is_listed - a.is_listed
      const schedA = a.schedule_every_hours === null ? 1 : 0
      const schedB = b.schedule_every_hours === null ? 1 : 0
      if (schedA !== schedB) return schedA - schedB
      const typeRank = (type: string | null) => {
        if (type === 'direct') return 0
        if (type === 'restake') return 1
        return 2
      }
      const typeCmp = typeRank(a.payout_type_declared) - typeRank(b.payout_type_declared)
      if (typeCmp !== 0) return typeCmp
      const obsCmp =
        observationTransparencyRank(options.statusA)
        - observationTransparencyRank(options.statusB)
      if (obsCmp !== 0) return obsCmp
      return nullsLastCompare(a.dominance_ratio, b.dominance_ratio, 'asc')
        || nullsLastCompare(a.official_score, b.official_score, 'desc')
        || a.address.localeCompare(b.address)
    }
  }
}

export type ObservationSummary = ValidatorListItem['observation']

export function toListItem(
  row: ValidatorRow,
  observation?: ObservationSummary | null,
): ValidatorListItem {
  const everyHours = row.schedule_every_hours
  return {
    address: row.address,
    name: row.name,
    isListed: row.is_listed === 1,
    logoUrl: row.logo_url,
    // official_score is already null for registry -1/missing (normalizeOfficialScore).
    officialScore: row.official_score,
    stakeLuna: row.stake_luna,
    dominanceRatio: row.dominance_ratio,
    stakersCount: row.stakers_count,
    declared: {
      fee: row.fee_declared,
      payoutType: asPayoutType(row.payout_type_declared),
      payoutSchedule: row.payout_schedule_declared,
      scheduleNormalized:
        everyHours !== null && Number.isFinite(everyHours)
          ? { everyHours }
          : null,
    },
    // Prefer latest schedule-adherence observation (P2-03/P2-06); else insufficient-data stub.
    observation: observation ? { ...observation } : { ...STUB_OBSERVATION },
    registryUpdatedAt: row.registry_updated_at ?? '',
  }
}

export function toProfile(
  row: ValidatorRow,
  observation?: ObservationSummary | null,
): ValidatorProfile {
  const list = toListItem(row, observation)
  const rewardAddress = row.reward_address
  return {
    ...list,
    website: row.website,
    description: row.description,
    rewardAddress,
    rewardExplorerUrl: rewardAddress ? buildNimiqAddressExplorerUrl(rewardAddress) : null,
    scoreComponents: null,
  }
}

function observationForRow(
  row: ValidatorRow,
  summaries: Map<string, ObservationSummary>,
): ObservationSummary {
  return summaries.get(compactKey(row.address)) ?? STUB_OBSERVATION
}

export function listValidators(
  database: Database.Database,
  options: ListValidatorsOptions = {},
): ValidatorListItem[] {
  const sort = options.sort ?? 'recommended'
  let rows = listValidatorRows(database)
  if (options.listed === true) {
    rows = rows.filter((row) => row.is_listed === 1)
  }
  // Load live observation summaries before sort so `recommended` can use them (P2-09).
  const summaries = loadObservationSummaries(database, { nowMs: options.nowMs })
  // listed=false (default) → all observable rows already stored from all-observable sync.
  rows = [...rows].sort((a, b) =>
    compareValidators(a, b, sort, {
      statusA: observationForRow(a, summaries).status,
      statusB: observationForRow(b, summaries).status,
    }),
  )
  return rows.map((row) => toListItem(row, observationForRow(row, summaries)))
}

function parseSort(value: unknown): ValidatorSort | null {
  if (typeof value !== 'string' || value.trim() === '') return 'recommended'
  const sort = value.trim().toLowerCase() as ValidatorSort
  return VALID_SORTS.has(sort) ? sort : null
}

function parseListed(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null || value === '') return false
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return null
}

function maxRegistryUpdatedAt(rows: ValidatorRow[]): string | null {
  let max: string | null = null
  let maxMs = -1
  for (const row of rows) {
    if (!row.registry_updated_at) continue
    const ms = Date.parse(row.registry_updated_at)
    if (!Number.isNaN(ms) && ms >= maxMs) {
      maxMs = ms
      max = row.registry_updated_at
    }
  }
  return max
}

/**
 * Max historyDepthDays across a list of validators (for list envelope).
 * Undefined when no validator has indexed depth yet.
 */
function maxHistoryDepthDays(
  items: readonly { observation: { historyDepthDays: number } }[],
): number | undefined {
  let max = 0
  let any = false
  for (const item of items) {
    const d = item.observation.historyDepthDays
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
      any = true
      if (d > max) max = d
    }
  }
  return any ? max : undefined
}

function sendApiError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    error: { code, message },
  })
}

export function mountValidatorsApi(app: Express, database: Database.Database): void {
  app.get('/api/validators', (req: Request, res: Response) => {
    const sort = parseSort(req.query.sort)
    if (sort === null) {
      sendApiError(
        res,
        400,
        'VALIDATION',
        'sort must be one of recommended|score|dominance|stake|direct-payout|restake|new.',
      )
      return
    }
    const listed = parseListed(req.query.listed)
    if (listed === null) {
      sendApiError(res, 400, 'VALIDATION', 'listed must be true or false.')
      return
    }

    // P2-13: short-TTL cache keyed by path + query + indexer watermark.
    const watermarkIso = getIndexerWatermarkIso(database)
    const cacheKey = buildPublicCacheKey(
      '/api/validators',
      { sort, listed: listed === true ? 'true' : 'false' },
      watermarkIso,
    )
    const cached = getCachedPublicResponse(cacheKey)
    if (cached) {
      res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
      res.setHeader('X-Cache', 'HIT')
      res.status(cached.status).json(cached.body)
      return
    }

    const nowMs = Date.now()
    const allRows = listValidatorRows(database)
    const validators = listValidators(database, { sort, listed, nowMs })
    const updatedAt = maxRegistryUpdatedAt(allRows) ?? new Date(0).toISOString()
    const baseStatus: EnvelopeStatus = allRows.length === 0 ? 'unavailable' : 'ok'
    // List embeds observation fields; mark stale when indexer watermark is old.
    const status = applyIndexerStaleStatus(baseStatus, { nowMs, watermarkIso })
    const historyDepthDays = maxHistoryDepthDays(validators)

    const body = {
      updatedAt,
      source: 'registry' as const,
      status,
      dataFreshness: buildDataFreshness({
        updatedAt,
        nowMs,
        historyDepthDays,
        // Prefer indexer watermark for ageSeconds when present so stale + age align.
        ageFromIso: watermarkIso ?? updatedAt,
      }),
      data: { validators },
    }
    setCachedPublicResponse(cacheKey, body, { watermark: watermarkIso })
    res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.setHeader('X-Cache', 'MISS')
    res.json(body)
  })

  app.get('/api/validators/:address', (req: Request, res: Response) => {
    const param = req.params.address
    const raw = (Array.isArray(param) ? param[0] : param) ?? ''
    // Express may leave encoded spaces; accept spaced or compact NQ addresses.
    const address = decodeURIComponent(raw)
    if (!isValidNimiqAddress(address)) {
      sendApiError(res, 400, 'VALIDATION', 'A valid Nimiq validator address is required.')
      return
    }

    const row = getValidatorRowByAddress(database, address)
    if (!row) {
      sendApiError(res, 404, 'VALIDATOR_NOT_FOUND', 'No registry record for this validator address.')
      return
    }

    const normalized = normalizeAddress(address)
    const watermarkIso = getIndexerWatermarkIso(database)
    const cacheKey = buildPublicCacheKey(
      `/api/validators/${normalized}`,
      {},
      watermarkIso,
    )
    const cached = getCachedPublicResponse(cacheKey)
    if (cached) {
      // P3-04: count cache hits as profile views (client still requested the profile).
      try {
        incrementMetric(database, METRIC_KEYS.validatorProfileViews)
      } catch {
        // Metrics must never break public profiles.
      }
      res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
      res.setHeader('X-Cache', 'HIT')
      res.status(cached.status).json(cached.body)
      return
    }

    const nowMs = Date.now()
    const summaries = loadObservationSummaries(database, { nowMs })
    const profile = toProfile(row, observationForRow(row, summaries))
    const updatedAt = row.registry_updated_at ?? new Date(0).toISOString()
    const status = applyIndexerStaleStatus('ok', { nowMs, watermarkIso })

    const body = {
      updatedAt,
      source: 'registry' as const,
      status,
      dataFreshness: buildDataFreshness({
        updatedAt,
        nowMs,
        historyDepthDays: profile.observation.historyDepthDays,
        ageFromIso: watermarkIso ?? updatedAt,
      }),
      data: profile,
    }
    setCachedPublicResponse(cacheKey, body, { watermark: watermarkIso })
    try {
      incrementMetric(database, METRIC_KEYS.validatorProfileViews)
    } catch {
      // Metrics must never break public profiles.
    }
    res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.setHeader('X-Cache', 'MISS')
    res.json(body)
  })
}
