/**
 * Client types + fetch for GET /api/validators and observations (P1-10, P2-08).
 * Envelope matches docs/API.md §1 and §3.
 */

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
  note: string
  dataStatus: 'insufficient' | 'verified' | 'unavailable'
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
  { value: 'dominance', label: 'Lowest dominance' },
  { value: 'stake', label: 'Largest by stake' },
  { value: 'direct-payout', label: 'Direct payout' },
  { value: 'restake', label: 'Restake' },
  { value: 'new', label: 'New or insufficient data' },
] as const

export interface FetchValidatorsOptions {
  sort?: ValidatorSort
  /** When true, only listed/known validators. Default false = all observable. */
  listed?: boolean
  signal?: AbortSignal
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

export async function fetchValidators(
  options: FetchValidatorsOptions = {},
): Promise<ValidatorsListEnvelope> {
  const sort = options.sort ?? 'recommended'
  const listed = options.listed === true
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
}

export interface FetchObservationsOptions {
  /** Pagination cursor from a previous envelope (`data.nextCursor`). */
  cursor?: string | null
  /** Page size (server clamps; default 25). */
  limit?: number
  signal?: AbortSignal
}

/**
 * Evidence payload for a validator profile (P2-08 / API.md §3).
 * Empty history is still HTTP 200 with insufficient-data / unavailable status.
 */
export async function fetchValidatorObservations(
  address: string,
  options: FetchObservationsOptions = {},
): Promise<ObservationsEnvelope> {
  const params = new URLSearchParams()
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.limit != null && Number.isFinite(options.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(options.limit))))
  }
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
