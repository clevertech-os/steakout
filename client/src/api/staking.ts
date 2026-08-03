/**
 * Staking intent + confirm clients (API.md §6).
 * Credentials always included so the session cookie is sent.
 *
 * Server matching is authoritative: the client never claims success from the
 * provider return alone (invariant #2). P1-06 owns the server routes; this
 * client is written to the published contract so tests can mock fetch.
 */

import { ApiError, apiPost, type ErrorEnvelope } from './http'
import type { StakingPositionData } from './position'

/** Wire operations for POST /api/staking/intent. */
export type StakingOperation =
  | 'new-staker'
  | 'stake'
  | 'set-active'
  | 'update-staker'
  | 'retire'
  | 'remove'

export interface StakingIntentParams {
  valueLuna?: number
  delegation?: string
  newActiveBalanceLuna?: number
  newDelegation?: string
  reactivateAllStake?: boolean
  retireStakeLuna?: number
}

/**
 * Server-built review payload. Client renders this on the review sheet
 * without inventing fields the server did not provide.
 */
export interface IntentSummary {
  operation: StakingOperation
  /** Plain-language action label, e.g. "Create staker and delegate". */
  operationLabel: string
  amountLuna: number | null
  /** NIM amount when the server includes it (optional; client may derive). */
  amountNim?: number | null
  validatorName: string | null
  validatorAddress: string | null
  /** Position state before the operation (when known). */
  stateFrom: string | null
  /** Expected position state after confirmation (when known). */
  stateTo: string | null
  /**
   * True when the protocol enforces a multi-step waiting period (retire/remove).
   * Change-validator notes a reporting window separately via waitingPeriodNote.
   */
  hasWaitingPeriod: boolean
  waitingPeriodNote: string | null
  /** Optional free-form notes from the server (neutral). */
  notes?: string[]
  /** Network context from the server (mainnet/testnet). */
  networkNote?: string | null
}

/** Raw wire summary may use server field names (fromState / toStateHint). */
type WireIntentSummary = IntentSummary & {
  fromState?: string | null
  toStateHint?: string | null
}

/**
 * Normalize server summary field names to the client review contract.
 * Server (P1-06) uses fromState/toStateHint; client ReviewSheet uses stateFrom/stateTo.
 */
export function normalizeIntentSummary(raw: WireIntentSummary): IntentSummary {
  const stateFrom = raw.stateFrom ?? raw.fromState ?? null
  const stateTo = raw.stateTo ?? raw.toStateHint ?? null
  const waitingPeriodNote = raw.waitingPeriodNote ?? null
  const hasWaitingPeriod =
    typeof raw.hasWaitingPeriod === 'boolean'
      ? raw.hasWaitingPeriod
      : raw.operation === 'retire' || raw.operation === 'remove'
  const notes = raw.notes
    ? [...raw.notes]
    : raw.networkNote
      ? [raw.networkNote]
      : undefined
  return {
    operation: raw.operation,
    operationLabel: raw.operationLabel,
    amountLuna: raw.amountLuna ?? null,
    amountNim: raw.amountNim ?? null,
    validatorName: raw.validatorName ?? null,
    validatorAddress: raw.validatorAddress ?? null,
    stateFrom,
    stateTo,
    hasWaitingPeriod,
    waitingPeriodNote,
    notes,
    networkNote: raw.networkNote ?? null,
  }
}

export interface CreateIntentRequest {
  operation: StakingOperation
  params: StakingIntentParams
}

export interface CreateIntentResponse {
  intentId: string
  expiresAt: string
  summary: IntentSummary
}

export interface ConfirmRequest {
  intentId: string
  txHash: string
}

export interface ConfirmConfirmed {
  status: 'confirmed'
  blockNumber: number | null
  position: StakingPositionData
}

export interface ConfirmPending {
  status: 'pending'
  code: 'TX_PENDING'
  message: string
}

export type ConfirmResult = ConfirmConfirmed | ConfirmPending

const CONFIRM_POLL_MAX_MS = 120_000
const CONFIRM_POLL_INITIAL_MS = 1_500
const CONFIRM_POLL_MAX_BACKOFF_MS = 8_000

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (!body || typeof body !== 'object') return false
  const err = (body as ErrorEnvelope).error
  return (
    err != null &&
    typeof err === 'object' &&
    typeof err.code === 'string' &&
    typeof err.message === 'string'
  )
}

/**
 * Create a single-use staking intent (15 min expiry on the server).
 * Requires an authenticated session cookie.
 */
export async function createStakingIntent(
  body: CreateIntentRequest,
): Promise<CreateIntentResponse> {
  const res = await apiPost<CreateIntentResponse>('/api/staking/intent', body)
  return {
    ...res,
    summary: normalizeIntentSummary(res.summary as WireIntentSummary),
  }
}

/**
 * Clear abandoned pending intents (review started, no chain tx submitted).
 * Safe when Pay/Hub never opened; does not cancel intents that already have a tx hash.
 */
export async function cancelPendingStakingIntents(): Promise<{
  cancelled: number
  message: string
}> {
  return apiPost<{ cancelled: number; message: string }>('/api/staking/cancel-pending', {})
}

/**
 * One confirm attempt. 202 TX_PENDING → pending; 200 → confirmed;
 * other non-2xx → ApiError (TX_FAILED, TX_MISMATCH, INTENT_NOT_FOUND, …).
 */
export async function confirmStakingIntent(
  body: ConfirmRequest,
): Promise<ConfirmResult> {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })

  const response = await fetch('/api/staking/confirm', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })

  let parsed: unknown = null
  const text = await response.text()
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      parsed = null
    }
  }

  // 202 — keep polling
  if (response.status === 202) {
    const code =
      isErrorEnvelope(parsed) ? parsed.error.code : 'TX_PENDING'
    const message =
      isErrorEnvelope(parsed)
        ? parsed.error.message
        : parsed &&
            typeof parsed === 'object' &&
            'message' in parsed &&
            typeof (parsed as { message: unknown }).message === 'string'
          ? (parsed as { message: string }).message
          : 'Transaction is still pending on chain.'
    return { status: 'pending', code: code as 'TX_PENDING', message }
  }

  if (!response.ok) {
    if (isErrorEnvelope(parsed)) {
      throw new ApiError(
        parsed.error.code,
        parsed.error.message,
        response.status,
        parsed.error.retryAfterSeconds,
      )
    }
    throw new ApiError(
      'VALIDATION',
      response.statusText || `Confirm failed (${response.status})`,
      response.status,
    )
  }

  // 200 confirmed
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as ConfirmConfirmed).status === 'confirmed'
  ) {
    const confirmed = parsed as ConfirmConfirmed
    return {
      status: 'confirmed',
      blockNumber: confirmed.blockNumber ?? null,
      position: confirmed.position,
    }
  }

  // Tolerate a bare success body with position and no status field
  if (parsed && typeof parsed === 'object' && 'position' in parsed) {
    const loose = parsed as {
      blockNumber?: number | null
      position: StakingPositionData
    }
    return {
      status: 'confirmed',
      blockNumber: loose.blockNumber ?? null,
      position: loose.position,
    }
  }

  throw new ApiError(
    'VALIDATION',
    'Unexpected confirm response from server.',
    response.status,
  )
}

export interface PollConfirmOptions {
  intentId: string
  txHash: string
  /** Wall-clock budget (default ~2 min). */
  maxMs?: number
  signal?: AbortSignal
  onTick?: (info: { attempt: number; message: string }) => void
}

/**
 * Poll confirm with exponential backoff until confirmed, hard failure, or timeout.
 * Timeout surfaces as ApiError code `CONFIRM_TIMEOUT` (client-side).
 */
export async function pollConfirmStakingIntent(
  options: PollConfirmOptions,
): Promise<ConfirmConfirmed> {
  const maxMs = options.maxMs ?? CONFIRM_POLL_MAX_MS
  const started = Date.now()
  let delay = CONFIRM_POLL_INITIAL_MS
  let attempt = 0

  while (Date.now() - started < maxMs) {
    if (options.signal?.aborted) {
      throw new ApiError('CONFIRM_ABORTED', 'Confirmation polling was cancelled.', 499)
    }

    attempt += 1
    const result = await confirmStakingIntent({
      intentId: options.intentId,
      txHash: options.txHash,
    })

    if (result.status === 'confirmed') {
      return result
    }

    options.onTick?.({ attempt, message: result.message })

    const remaining = maxMs - (Date.now() - started)
    if (remaining <= 0) break

    const wait = Math.min(delay, remaining, CONFIRM_POLL_MAX_BACKOFF_MS)
    await sleep(wait, options.signal)
    delay = Math.min(delay * 1.6, CONFIRM_POLL_MAX_BACKOFF_MS)
  }

  throw new ApiError(
    'CONFIRM_TIMEOUT',
    'Confirmation is taking longer than expected. Check Activity later; the server only confirms from chain data.',
    408,
  )
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('CONFIRM_ABORTED', 'Confirmation polling was cancelled.', 499))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ApiError('CONFIRM_ABORTED', 'Confirmation polling was cancelled.', 499))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
