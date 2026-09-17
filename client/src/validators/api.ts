/**
 * Client types + fetch for GET /api/validators and observations (P1-10, P2-08).
 * Envelope matches docs/API.md §1 and §3.
 *
 * Public GETs use a short client cache (memory + sessionStorage, ~45s) aligned
 * with server PUBLIC_RESPONSE_CACHE_TTL so revisits paint without waiting.
 */
import {
  peekPublicCache,
  peekPublicCacheAnyAge,
  publicCacheKey,
  withPublicCache,
} from './publicDataCache'

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

/** Steakout-researched min payout (not in official validators-api). */
export type MinPayoutKind =
  | 'fixed'
  | 'none'
  | 'stake-based'
  | 'not_applicable'
  | 'unknown'

export interface DeclaredMinPayout {
  nim: number | null
  kind: MinPayoutKind
  confidence: 'high' | 'medium' | 'low' | null
}

/** Inferred floor from indexed reward outflows (not registry policy). */
export interface ObservedPaymentFloor {
  minNim: number | null
  /** Prefer for display — robust to dust under a hard floor. */
  p5Nim: number | null
  sampleSize: number
  recipientCount: number
  historyDepthDays: number | null
  status: 'inferred' | 'insufficient' | 'unavailable'
  computedAt: string
}

export interface ValidatorListItem {
  address: string
  name: string | null
  isListed: boolean
  logoUrl: string | null
  /** Operator website from registry when present. */
  website?: string | null
  officialScore: number | null
  stakeLuna: number | null
  dominanceRatio: number | null
  stakersCount: number | null
  declared: {
    fee: string | null
    payoutType: DeclaredPayoutType
    payoutSchedule: string | null
    scheduleNormalized: { everyHours: number } | null
    /** Operator/researched min payout; caption as Registry declaration. */
    minPayout?: DeclaredMinPayout
  }
  observation: {
    status: ObservationStatus
    lastObservedAt: string | null
    historyDepthDays: number
    /** Present when schedule is graded from indexed runs. */
    observedWindows?: number | null
    expectedWindows?: number | null
  }
  /** Live chain floor (p5); status inferred | insufficient | unavailable. */
  observedPaymentFloor?: ObservedPaymentFloor
  registryUpdatedAt?: string
  /** True when Steakout runs a canary probe stake on this validator. */
  canaryConfigured?: boolean
}

/** Canary probe monitoring block on GET /api/validators/:address. */
export interface CanaryProbeSummary {
  configured: boolean
  status: 'not-configured' | 'pending' | 'active'
  statusLabel: string
  probeId: string | null
  probeAddress: string | null
  probeExplorerUrl: string | null
  stakeAmountLuna: number | null
  stakedAt: string | null
  stakeTxHash: string | null
  stakeExplorerUrl: string | null
  payoutType: DeclaredPayoutType | null
  lastPaymentAt: string | null
  lastPaymentLuna: number | null
  lastPaymentTxHash: string | null
  lastPaymentExplorerUrl: string | null
  lastStakerBalanceLuna: number | null
  lastStakerBalanceAt: string | null
  observationCount: number
  firstObservedAt: string | null
  lastObservedAt: string | null
  historyDepthDays: number
  note: string
  dataStatus: 'insufficient' | 'verified' | 'unavailable'
}

export interface CanaryCoverageSummary {
  configuredCount: number
  payoutTypes: { direct: number; restake: number; unknown: number }
  statuses: { pending: number; observed: number; unavailable: number }
}

export interface NetworkSummaryEnvelope {
  updatedAt: string
  source: string
  status: 'ok' | 'stale' | 'partial' | 'unavailable' | string
  dataFreshness: { ageSeconds: number; historyDepthDays?: number }
  data: {
    canary: CanaryCoverageSummary
  }
}

export interface ValidatorsListEnvelope {
  updatedAt: string
  source: string
  status: 'ok' | 'stale' | 'partial' | 'unavailable'
  dataFreshness?: { ageSeconds?: number; historyDepthDays?: number }
  data: { validators: ValidatorListItem[] }
}

/** One payout-run row from GET /api/validators/:address/observations (API.md §3). */
export interface ObservationRunItem {
  windowStart: string
  windowEnd: string
  txCount: number
  recipientCount: number
  /** Null when known-staker set is unavailable (METHODOLOGY §4.3). */
  knownStakersCovered: number | null
  knownStakersTotal: number | null
  txHashes: string[]
  blockRange: [number, number]
}

export interface ObservationsPayload {
  observationStatus: ObservationStatus
  schedule: {
    declared: string | null
    normalized: { everyHours: number } | null
    normalizable: boolean
  }
  window: {
    from: string | null
    to: string | null
    expectedWindows: number
    observedWindows: number
  }
  runs: ObservationRunItem[]
  nextCursor: string | null
  /** Machine-stable limitation keys; client maps to neutral copy. */
  limitations: string[]
}

export interface ObservationsEnvelope {
  updatedAt: string
  source: string
  status: 'ok' | 'stale' | 'partial' | 'unavailable'
  dataFreshness: { ageSeconds: number; historyDepthDays: number }
  data: ObservationsPayload
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryAfterSeconds?: number }
}

export class ValidatorsApiError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus: number) {
    super(message)
    this.name = 'ValidatorsApiError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export const VALIDATOR_SORTS: readonly {
  value: ValidatorSort
  label: string
}[] = [
  { value: 'recommended', label: 'Recommended for transparency' },
  { value: 'score', label: 'Official score' },
  { value: 'dominance', label: 'Lowest network share' },
  { value: 'stake', label: 'Largest by stake' },
  { value: 'direct-payout', label: 'Direct payout' },
  { value: 'restake', label: 'Restake' },
  { value: 'new', label: 'Newest or not enough data' },
] as const

export interface FetchValidatorsOptions {
  sort?: ValidatorSort
  /** When true, only listed/known validators. Default false = all observable. */
  listed?: boolean
  signal?: AbortSignal
  /** Bypass client cache and refetch. */
  force?: boolean
}

/** Profile envelope from GET /api/validators/:address (API.md §2). */
export interface ValidatorProfileEnvelope {
  updatedAt: string
  source: string
  status: 'ok' | 'stale' | 'partial' | 'unavailable' | string
  dataFreshness: { ageSeconds: number; historyDepthDays?: number }
  data: ValidatorListItem & {
    website?: string | null
    description?: string | null
    rewardAddress?: string | null
    rewardExplorerUrl?: string | null
    scoreComponents?: null
    registryUpdatedAt?: string
    canaryProbe?: CanaryProbeSummary
  }
}

export interface FetchProfileOptions {
  signal?: AbortSignal
  force?: boolean
}

export interface FetchObservationsOptions {
  /** Pagination cursor from a previous envelope (`data.nextCursor`). */
  cursor?: string | null
  /** Page size (server clamps; default 25). */
  limit?: number
  signal?: AbortSignal
  force?: boolean
}

async function parseJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw new ValidatorsApiError(
      'VALIDATION',
      'Could not read the API response.',
      res.status,
    )
  }
}

function throwIfError(res: Response, body: unknown): void {
  if (res.ok) return
  const err = body as ApiErrorBody
  const code = err?.error?.code ?? 'VALIDATION'
  const message = err?.error?.message ?? `Request failed (${res.status})`
  throw new ValidatorsApiError(code, message, res.status)
}

function listCacheKey(sort: ValidatorSort, listed: boolean): string {
  return publicCacheKey(['validators', sort, listed ? '1' : '0'])
}

function profileCacheKey(address: string): string {
  return publicCacheKey(['profile', address.trim().toUpperCase().replace(/\s+/g, '')])
}

function observationsCacheKey(
  address: string,
  cursor: string | null | undefined,
  limit: number | null | undefined,
): string {
  return publicCacheKey([
    'observations',
    address.trim().toUpperCase().replace(/\s+/g, ''),
    cursor ?? '',
    limit != null && Number.isFinite(limit) ? String(Math.floor(limit)) : '',
  ])
}

function networkSummaryCacheKey(): string {
  return publicCacheKey(['network-summary'])
}

/** Sync peek for directory SWR (fresh or slightly stale). */
export function peekValidatorsList(
  sort: ValidatorSort = 'recommended',
  listed = false,
): { envelope: ValidatorsListEnvelope; fresh: boolean } | null {
  const hit = peekPublicCacheAnyAge<ValidatorsListEnvelope>(listCacheKey(sort, listed))
  return hit ? { envelope: hit.data, fresh: hit.fresh } : null
}

export function peekValidatorProfile(
  address: string,
): { envelope: ValidatorProfileEnvelope; fresh: boolean } | null {
  const hit = peekPublicCacheAnyAge<ValidatorProfileEnvelope>(profileCacheKey(address))
  return hit ? { envelope: hit.data, fresh: hit.fresh } : null
}

export async function fetchValidators(
  options: FetchValidatorsOptions = {},
): Promise<ValidatorsListEnvelope> {
  const sort = options.sort ?? 'recommended'
  const listed = options.listed === true
  const key = listCacheKey(sort, listed)

  return withPublicCache(
    key,
    async () => {
      const params = new URLSearchParams({
        sort,
        listed: listed ? 'true' : 'false',
      })
      const res = await fetch(`/api/validators?${params}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: options.signal,
      })

      const body = await parseJsonBody(res)
      throwIfError(res, body)

      const envelope = body as ValidatorsListEnvelope
      if (!envelope?.data || !Array.isArray(envelope.data.validators)) {
        throw new ValidatorsApiError(
          'VALIDATION',
          'Validators response was missing a list.',
          res.status,
        )
      }
      return envelope
    },
    { force: options.force, preferCache: !options.force },
  )
}

/**
 * Single validator profile. Throws ValidatorsApiError with httpStatus 404 when missing.
 */
export async function fetchValidatorProfile(
  address: string,
  options: FetchProfileOptions = {},
): Promise<ValidatorProfileEnvelope> {
  const trimmed = address.trim()
  const key = profileCacheKey(trimmed)

  return withPublicCache(
    key,
    async () => {
      const path = `/api/validators/${encodeURIComponent(trimmed)}`
      const res = await fetch(path, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: options.signal,
      })
      const body = await parseJsonBody(res)
      if (!res.ok) {
        throwIfError(res, body)
      }
      const envelope = body as ValidatorProfileEnvelope
      if (!envelope?.data || typeof envelope.data.address !== 'string') {
        throw new ValidatorsApiError(
          'VALIDATION',
          'Profile response was missing validator data.',
          res.status,
        )
      }
      return envelope
    },
    { force: options.force, preferCache: !options.force },
  )
}

/**
 * Evidence payload for a validator profile (P2-08 / API.md §3).
 * Empty history is still HTTP 200 with insufficient-data / unavailable status.
 */
export async function fetchValidatorObservations(
  address: string,
  options: FetchObservationsOptions = {},
): Promise<ObservationsEnvelope> {
  const cursor = options.cursor ?? null
  const limit =
    options.limit != null && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : null
  // Paginated "load more" pages skip cache (cursor-specific, less reuse).
  const useCache = !cursor
  const key = observationsCacheKey(address, cursor, limit)

  const loader = async () => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (limit != null) params.set('limit', String(limit))
    const qs = params.toString()
    const path = `/api/validators/${encodeURIComponent(address.trim())}/observations${
      qs ? `?${qs}` : ''
    }`

    const res = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    })

    const body = await parseJsonBody(res)
    throwIfError(res, body)

    const envelope = body as ObservationsEnvelope
    if (!envelope?.data || !Array.isArray(envelope.data.runs)) {
      throw new ValidatorsApiError(
        'VALIDATION',
        'Observations response was missing run data.',
        res.status,
      )
    }
    return envelope
  }

  if (!useCache) return loader()

  return withPublicCache(key, loader, {
    force: options.force,
    preferCache: !options.force,
  })
}

/** Public aggregate canary coverage, backed by the indexed network summary. */
export async function fetchNetworkSummary(options: {
  signal?: AbortSignal
  force?: boolean
} = {}): Promise<NetworkSummaryEnvelope> {
  const key = networkSummaryCacheKey()
  return withPublicCache(
    key,
    async () => {
      const res = await fetch('/api/network/summary', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: options.signal,
      })
      const body = await parseJsonBody(res)
      throwIfError(res, body)
      const envelope = body as NetworkSummaryEnvelope
      if (!envelope?.data?.canary) {
        throw new ValidatorsApiError(
          'VALIDATION',
          'Network summary was missing canary coverage.',
          res.status,
        )
      }
      return envelope
    },
    { force: options.force, preferCache: !options.force },
  )
}

/**
 * Warm listed directory list after Home is ready or on nav intent.
 * Fire-and-forget; errors are ignored. Unlisted validators are not shown in UI.
 */
export function prefetchValidatorsDirectory(): void {
  void fetchValidators({ sort: 'recommended', listed: true }).catch(() => {})
}

/** Warm a profile when the user is about to open it (card hover, etc.). */
export function prefetchValidatorProfile(address: string): void {
  const a = address.trim()
  if (!a) return
  if (peekPublicCache(profileCacheKey(a))) return
  void fetchValidatorProfile(a).catch(() => {})
}
