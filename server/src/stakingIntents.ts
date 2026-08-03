/**
 * P1-06 — Staking intent / confirm + chain matcher.
 *
 * Trust core: the server never marks a staking action confirmed from the
 * client's word alone. Confirm always loads the tx from chain and matches
 * authenticated address + recorded intent (operation, amount where applicable).
 *
 * Provider return-value residual (P0-03): device evidence still required for
 * host semantics. Package types document basic txs as serialized; staking
 * methods share Promise<string | ErrorResponse>. `normalizeProviderTxRef`
 * accepts 64-hex hashes and, provisionally, long hex via Transaction.fromAny.
 */

import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import {
  addressesEqual,
  isValidNimiqAddress,
  normalizeAddress,
} from './addresses.js'
import {
  fetchTransaction,
  normalizeTxHash,
  toRpcApiError,
  type NimiqTransaction,
} from './nimiq-rpc.js'
import { tryDeriveTxHash } from './txHashFromSerialized.js'
import {
  clearPositionCache,
  readStakingPosition,
  resolveValidatorName,
  type PositionState,
  type StakingPositionEnvelope,
} from './stakingState.js'

export const INTENT_TTL_MS = 15 * 60_000
export const LUNA_PER_NIM = 100_000

export type StakingOperation =
  | 'new-staker'
  | 'stake'
  | 'set-active'
  | 'update-staker'
  | 'retire'
  | 'remove'

export type IntentStatus = 'pending' | 'confirmed' | 'failed' | 'expired'

export interface IntentParams {
  valueLuna?: number
  delegation?: string
  newActiveBalanceLuna?: number
  newDelegation?: string
  reactivateAllStake?: boolean
  retireStakeLuna?: number
}

export interface IntentSummary {
  operation: StakingOperation
  operationLabel: string
  amountNim: number | null
  amountLuna: number | null
  validatorAddress: string | null
  validatorName: string | null
  fromState: PositionState
  toStateHint: PositionState
  waitingPeriodNote: string | null
  networkNote: string
}

export interface CreateIntentResult {
  intentId: string
  expiresAt: string
  summary: IntentSummary
}

export interface ConfirmSuccess {
  status: 'confirmed'
  blockNumber: number | null
  position: StakingPositionEnvelope
}

export interface StakingIntentRow {
  id: string
  user_address: string
  operation: string
  params_json: string
  status: string
  tx_hash: string | null
  created_at: string
  expires_at: string
  confirmed_at: string | null
}

export class StakingIntentError extends Error {
  readonly httpStatus: number
  readonly code: string
  readonly retryAfterSeconds?: number

  constructor(
    message: string,
    httpStatus: number,
    code: string,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'StakingIntentError'
    this.httpStatus = httpStatus
    this.code = code
    if (retryAfterSeconds != null) this.retryAfterSeconds = retryAfterSeconds
  }
}

const OPERATIONS = new Set<StakingOperation>([
  'new-staker',
  'stake',
  'set-active',
  'update-staker',
  'retire',
  'remove',
])

const OPERATION_LABELS: Record<StakingOperation, string> = {
  'new-staker': 'Create staker',
  stake: 'Add stake',
  'set-active': 'Set active stake',
  'update-staker': 'Change validator',
  retire: 'Retire stake',
  remove: 'Remove stake',
}

/** Max safe Luna on the wire (JSON number). */
const MAX_SAFE_LUNA = Number.MAX_SAFE_INTEGER

export interface StakingIntentsOptions {
  database: Database.Database
  now?: () => number
  rpcUrl?: string
  /** Inject for tests. */
  readPosition?: typeof readStakingPosition
  /** Inject for tests. */
  fetchTx?: (hash: string) => Promise<NimiqTransaction | null>
}

/**
 * Normalize a client/provider return value into a chain tx hash.
 * Accepts:
 * - 64-hex (optional 0x)
 * - `{ hash: string }` / `{ txHash: string }`
 * - longer hex provisionally treated as serialized tx → Transaction.fromAny → hash()
 *
 * Device must still confirm that the Pay host returns serialized txs vs hashes.
 */
export function normalizeProviderTxRef(raw: unknown): string {
  if (raw == null) {
    throw new StakingIntentError(
      'A transaction hash is required.',
      400,
      'VALIDATION',
    )
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if (typeof record.hash === 'string') {
      return normalizeProviderTxRef(record.hash)
    }
    if (typeof record.txHash === 'string') {
      return normalizeProviderTxRef(record.txHash)
    }
    throw new StakingIntentError(
      'Transaction reference must be a hex hash or serialized transaction hex (optional 0x), or an object with hash/txHash.',
      400,
      'VALIDATION',
    )
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new StakingIntentError(
      'Transaction reference must be a hex hash or serialized transaction hex (optional 0x).',
      400,
      'VALIDATION',
    )
  }

  const derived = tryDeriveTxHash(raw)
  if (derived) return derived.hash

  throw new StakingIntentError(
    'Transaction reference must be a 64-character hex hash or a parseable serialized transaction hex (optional 0x).',
    400,
    'VALIDATION',
  )
}

export function countPendingIntents(
  database: Database.Database,
  address: string,
  nowMs: number,
): number {
  const normalized = normalizeAddress(address)
  const nowIso = new Date(nowMs).toISOString()
  const row = database
    .prepare(
      `SELECT COUNT(*) AS n FROM staking_intents
       WHERE replace(upper(user_address), ' ', '') = ?
         AND status = 'pending'
         AND expires_at > ?`,
    )
    .get(normalized, nowIso) as { n: number }
  return Number(row?.n ?? 0)
}

export function getIntentById(
  database: Database.Database,
  intentId: string,
): StakingIntentRow | null {
  const row = database
    .prepare(
      `SELECT id, user_address, operation, params_json, status, tx_hash,
              created_at, expires_at, confirmed_at
       FROM staking_intents WHERE id = ?`,
    )
    .get(intentId) as StakingIntentRow | undefined
  return row ?? null
}

function isPositiveLuna(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_SAFE_LUNA
  )
}

function isNonNegativeLuna(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_LUNA
  )
}

function parseOperation(value: unknown): StakingOperation {
  if (typeof value !== 'string' || !OPERATIONS.has(value as StakingOperation)) {
    throw new StakingIntentError(
      'operation must be one of new-staker|stake|set-active|update-staker|retire|remove.',
      400,
      'VALIDATION',
    )
  }
  return value as StakingOperation
}

function parseAndValidateParams(
  operation: StakingOperation,
  raw: unknown,
): IntentParams {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StakingIntentError(
      'params must be an object.',
      400,
      'VALIDATION',
    )
  }
  const input = raw as Record<string, unknown>
  const params: IntentParams = {}

  if (input.valueLuna !== undefined) {
    if (!isPositiveLuna(input.valueLuna)) {
      throw new StakingIntentError(
        'valueLuna must be a positive integer Luna amount.',
        400,
        'VALIDATION',
      )
    }
    params.valueLuna = input.valueLuna
  }
  if (input.retireStakeLuna !== undefined) {
    if (!isPositiveLuna(input.retireStakeLuna)) {
      throw new StakingIntentError(
        'retireStakeLuna must be a positive integer Luna amount.',
        400,
        'VALIDATION',
      )
    }
    params.retireStakeLuna = input.retireStakeLuna
  }
  if (input.newActiveBalanceLuna !== undefined) {
    if (!isNonNegativeLuna(input.newActiveBalanceLuna)) {
      throw new StakingIntentError(
        'newActiveBalanceLuna must be a non-negative integer Luna amount.',
        400,
        'VALIDATION',
      )
    }
    params.newActiveBalanceLuna = input.newActiveBalanceLuna
  }
  if (input.delegation !== undefined) {
    if (typeof input.delegation !== 'string' || !isValidNimiqAddress(input.delegation)) {
      throw new StakingIntentError(
        'delegation must be a valid Nimiq address.',
        400,
        'VALIDATION',
      )
    }
    params.delegation = normalizeAddress(input.delegation)
  }
  if (input.newDelegation !== undefined) {
    if (
      typeof input.newDelegation !== 'string' ||
      !isValidNimiqAddress(input.newDelegation)
    ) {
      throw new StakingIntentError(
        'newDelegation must be a valid Nimiq address.',
        400,
        'VALIDATION',
      )
    }
    params.newDelegation = normalizeAddress(input.newDelegation)
  }
  if (input.reactivateAllStake !== undefined) {
    if (typeof input.reactivateAllStake !== 'boolean') {
      throw new StakingIntentError(
        'reactivateAllStake must be a boolean.',
        400,
        'VALIDATION',
      )
    }
    params.reactivateAllStake = input.reactivateAllStake
  }

  switch (operation) {
    case 'new-staker':
      if (params.valueLuna == null) {
        throw new StakingIntentError(
          'new-staker requires valueLuna.',
          400,
          'VALIDATION',
        )
      }
      if (params.delegation == null) {
        throw new StakingIntentError(
          'new-staker requires delegation (validator address).',
          400,
          'VALIDATION',
        )
      }
      break
    case 'stake':
      if (params.valueLuna == null) {
        throw new StakingIntentError(
          'stake requires valueLuna.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'set-active':
      if (params.newActiveBalanceLuna == null) {
        throw new StakingIntentError(
          'set-active requires newActiveBalanceLuna.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'update-staker':
      if (params.newDelegation == null && params.reactivateAllStake == null) {
        throw new StakingIntentError(
          'update-staker requires newDelegation and/or reactivateAllStake.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'retire':
      if (params.retireStakeLuna == null) {
        throw new StakingIntentError(
          'retire requires retireStakeLuna.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'remove':
      if (params.valueLuna == null) {
        throw new StakingIntentError(
          'remove requires valueLuna.',
          400,
          'VALIDATION',
        )
      }
      break
  }

  return params
}

function assertStatePreconditions(
  operation: StakingOperation,
  state: PositionState,
): void {
  switch (operation) {
    case 'new-staker':
      if (state !== 'NotStaked') {
        throw new StakingIntentError(
          state === 'Pending'
            ? 'A staking action is already pending. Wait for it to complete before creating a staker.'
            : 'Create staker is only available when no staker position exists (NotStaked).',
          400,
          'VALIDATION',
        )
      }
      break
    case 'stake':
      if (state !== 'Active' && state !== 'Inactive') {
        throw new StakingIntentError(
          state === 'Pending'
            ? 'A staking action is already pending. Wait for it to complete before adding stake.'
            : state === 'NotStaked'
              ? 'Add stake requires an existing staker. Use create staker first.'
              : 'Add stake is only available for Active or Inactive positions.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'set-active':
      if (state !== 'Active' && state !== 'Inactive') {
        throw new StakingIntentError(
          state === 'Pending'
            ? 'A staking action is already pending. Wait for it to complete before set-active.'
            : 'Set active stake requires an Active or Inactive position.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'update-staker':
      if (state !== 'Active' && state !== 'Inactive') {
        throw new StakingIntentError(
          state === 'Pending'
            ? 'A staking action is already pending. Wait for it to complete before updating the staker.'
            : 'Update staker requires an Active or Inactive position.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'retire':
      // Active / Inactive: first retire. Retiring: remaining active/inactive may still retire.
      if (state !== 'Active' && state !== 'Inactive' && state !== 'Retiring') {
        throw new StakingIntentError(
          state === 'Pending'
            ? 'A staking action is already pending. Wait for it to complete before retiring stake.'
            : state === 'Withdrawable'
              ? 'This position is already fully retired and Withdrawable. Use remove stake to return NIM to your account.'
              : 'Retire stake requires an Active, Inactive, or Retiring position with retirable stake.',
          400,
          'VALIDATION',
        )
      }
      break
    case 'remove':
      if (state === 'Withdrawable') break
      if (state === 'Retiring') {
        throw new StakingIntentError(
          'Stake is still retiring and is not yet ready to remove. Wait until the position is Withdrawable (retired balance only). Retire stake does not immediately return NIM.',
          400,
          'VALIDATION',
        )
      }
      throw new StakingIntentError(
        'Remove stake is available when the position is Withdrawable. It is not an instant unstake from Active stake.',
        400,
        'VALIDATION',
      )
  }
}

/**
 * Soft balance checks against the latest position read.
 * Chain remains authoritative at confirm; this rejects obvious over-asks early.
 */
function assertAmountAgainstPosition(
  operation: StakingOperation,
  params: IntentParams,
  staker: {
    activeLuna: number
    inactiveLuna: number
    retiredLuna: number
  },
): void {
  if (operation === 'retire' && params.retireStakeLuna != null) {
    const retirable = Math.max(
      0,
      Math.floor(staker.activeLuna) + Math.floor(staker.inactiveLuna),
    )
    if (retirable <= 0) {
      throw new StakingIntentError(
        'No active or inactive stake is available to retire on this position.',
        400,
        'VALIDATION',
      )
    }
    if (params.retireStakeLuna > retirable) {
      throw new StakingIntentError(
        `retireStakeLuna exceeds retirable stake (${retirable} Luna from active + inactive).`,
        400,
        'VALIDATION',
      )
    }
  }
  if (operation === 'remove' && params.valueLuna != null) {
    const removable = Math.max(0, Math.floor(staker.retiredLuna))
    if (removable <= 0) {
      throw new StakingIntentError(
        'No retired stake is available to remove on this position.',
        400,
        'VALIDATION',
      )
    }
    if (params.valueLuna > removable) {
      throw new StakingIntentError(
        `valueLuna exceeds retired (removable) stake (${removable} Luna).`,
        400,
        'VALIDATION',
      )
    }
  }
}

function toStateHint(
  operation: StakingOperation,
  params: IntentParams,
  fromState: PositionState,
): PositionState {
  switch (operation) {
    case 'new-staker':
      return 'Active'
    case 'stake':
      return 'Active'
    case 'set-active':
      if (params.newActiveBalanceLuna != null && params.newActiveBalanceLuna === 0) {
        return 'Inactive'
      }
      return 'Active'
    case 'update-staker':
      return fromState === 'Inactive' && params.reactivateAllStake ? 'Active' : fromState
    case 'retire':
      return 'Retiring'
    case 'remove':
      return 'NotStaked'
  }
}

function amountFromParams(params: IntentParams): number | null {
  if (params.valueLuna != null) return params.valueLuna
  if (params.retireStakeLuna != null) return params.retireStakeLuna
  if (params.newActiveBalanceLuna != null) return params.newActiveBalanceLuna
  return null
}

function validatorFromParamsAndPosition(
  operation: StakingOperation,
  params: IntentParams,
  positionDelegation: string | null,
): string | null {
  if (operation === 'new-staker' && params.delegation) return params.delegation
  if (operation === 'update-staker' && params.newDelegation) return params.newDelegation
  if (positionDelegation) return normalizeAddress(positionDelegation)
  return null
}

function waitingPeriodNote(
  operation: StakingOperation,
  params: IntentParams = {},
): string | null {
  if (operation === 'retire') {
    return 'Retire stake does not immediately return NIM. Funds move to a retired balance. Remove is only available after the protocol waiting period when the position is Withdrawable. This is not instant unstake.'
  }
  if (operation === 'remove') {
    return 'Remove returns retired stake that is already Withdrawable to your available account balance. It does not skip the retire waiting period and cannot remove Active stake.'
  }
  if (operation === 'update-staker') {
    if (params.reactivateAllStake) {
      return 'Changing validator is not the multi-step retire/remove wait. Delegation updates on confirmation. Reactivate is requested so stake aims to stay (or become) active after the current network reporting window; exact timing follows the protocol, not Steakout.'
    }
    return 'Changing validator is not the multi-step retire/remove wait. Delegation updates on confirmation. Stake may sit inactive until reactivated after the current network reporting window.'
  }
  if (operation === 'set-active') {
    return 'Set active adjusts how much of your stake is active versus inactive. It is not retire or remove and does not return NIM to your account balance.'
  }
  return null
}

function networkNote(): string {
  const n = (process.env.NIMIQ_NETWORK ?? 'main').trim().toLowerCase()
  if (n === 'main' || n === 'mainnet') {
    return 'This action will be submitted on mainnet.'
  }
  if (n === 'test' || n === 'testnet') {
    return 'This action will be submitted on testnet.'
  }
  return `This action will be submitted on network: ${n}.`
}

function buildSummary(
  database: Database.Database,
  operation: StakingOperation,
  params: IntentParams,
  fromState: PositionState,
  positionDelegation: string | null,
): IntentSummary {
  const amountLuna = amountFromParams(params)
  const validatorAddress = validatorFromParamsAndPosition(
    operation,
    params,
    positionDelegation,
  )
  const validatorName = resolveValidatorName(database, validatorAddress)
  const note = waitingPeriodNote(operation, params)
  return {
    operation,
    operationLabel: OPERATION_LABELS[operation],
    amountNim: amountLuna != null ? amountLuna / LUNA_PER_NIM : null,
    amountLuna,
    validatorAddress,
    validatorName,
    fromState,
    toStateHint: toStateHint(operation, params, fromState),
    waitingPeriodNote: note,
    networkNote: networkNote(),
  }
}

/**
 * Validate + record a pending staking intent (15 min expiry, single-use).
 */
export async function createStakingIntent(
  options: StakingIntentsOptions,
  userAddress: string,
  body: { operation?: unknown; params?: unknown },
): Promise<CreateIntentResult> {
  const nowMs = (options.now ?? Date.now)()
  const address = normalizeAddress(userAddress)
  const operation = parseOperation(body.operation)
  const params = parseAndValidateParams(operation, body.params ?? {})

  const readPosition = options.readPosition ?? readStakingPosition
  const envelope = await readPosition({
    database: options.database,
    address,
    rpcUrl: options.rpcUrl,
    now: () => nowMs,
    bypassCache: true,
  })
  // For preconditions, ignore Pending overlay from other intents — use chain-derived
  // state when available, but still block when Pending (concurrent intent).
  const fromState = envelope.data.state
  assertStatePreconditions(operation, fromState)
  assertAmountAgainstPosition(operation, params, envelope.data.staker)

  const positionDelegation = envelope.data.staker.delegation
  // Change-validator must target a different address when newDelegation is set.
  if (
    operation === 'update-staker' &&
    params.newDelegation &&
    positionDelegation &&
    addressesEqual(params.newDelegation, positionDelegation)
  ) {
    throw new StakingIntentError(
      'newDelegation must differ from the current delegation. Pick a different validator to change to.',
      400,
      'VALIDATION',
    )
  }

  const summary = buildSummary(
    options.database,
    operation,
    params,
    fromState === 'Pending' ? 'Pending' : fromState,
    positionDelegation,
  )

  const intentId = randomUUID()
  const expiresAt = new Date(nowMs + INTENT_TTL_MS).toISOString()
  const paramsJson = JSON.stringify(params)

  options.database
    .prepare(
      `INSERT INTO staking_intents (
         id, user_address, operation, params_json, status, expires_at
       ) VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(intentId, address, operation, paramsJson, expiresAt)

  return { intentId, expiresAt, summary }
}

function parseStoredParams(paramsJson: string): IntentParams {
  try {
    const parsed = JSON.parse(paramsJson) as IntentParams
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function matchAmount(params: IntentParams, txValue: number): boolean {
  // Hard-match only when valueLuna or retireStakeLuna was recorded.
  if (params.valueLuna != null) return params.valueLuna === txValue
  if (params.retireStakeLuna != null) return params.retireStakeLuna === txValue
  return true
}

function expectedDelegation(params: IntentParams): string | null {
  if (params.delegation) return normalizeAddress(params.delegation)
  if (params.newDelegation) return normalizeAddress(params.newDelegation)
  return null
}

/**
 * Confirm a pending intent by matching chain tx data.
 * Never trusts a client "success" claim without this match.
 */
export async function confirmStakingIntent(
  options: StakingIntentsOptions,
  userAddress: string,
  body: { intentId?: unknown; txHash?: unknown },
): Promise<ConfirmSuccess> {
  const nowMs = (options.now ?? Date.now)()
  const address = normalizeAddress(userAddress)

  if (typeof body.intentId !== 'string' || body.intentId.trim() === '') {
    throw new StakingIntentError(
      'intentId is required.',
      400,
      'VALIDATION',
    )
  }
  const intentId = body.intentId.trim()
  const txHash = normalizeProviderTxRef(body.txHash)

  const row = getIntentById(options.database, intentId)
  if (!row) {
    throw new StakingIntentError(
      'Staking intent was not found.',
      404,
      'INTENT_NOT_FOUND',
    )
  }

  if (!addressesEqual(row.user_address, address)) {
    // Do not leak existence of another user's intent.
    throw new StakingIntentError(
      'Staking intent was not found.',
      404,
      'INTENT_NOT_FOUND',
    )
  }

  if (row.status === 'confirmed') {
    throw new StakingIntentError(
      'This intent has already been confirmed and cannot be reused.',
      400,
      'VALIDATION',
    )
  }
  if (row.status === 'failed' || row.status === 'expired') {
    throw new StakingIntentError(
      'This intent is no longer pending.',
      400,
      'VALIDATION',
    )
  }
  if (row.status !== 'pending') {
    throw new StakingIntentError(
      'This intent is no longer pending.',
      400,
      'VALIDATION',
    )
  }

  const expiresAtMs = Date.parse(row.expires_at)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    options.database
      .prepare(
        `UPDATE staking_intents SET status = 'expired' WHERE id = ? AND status = 'pending'`,
      )
      .run(intentId)
    throw new StakingIntentError(
      'Staking intent has expired.',
      404,
      'INTENT_NOT_FOUND',
    )
  }

  const fetchTx =
    options.fetchTx ??
    ((hash: string) => fetchTransaction(hash, options.rpcUrl))

  let tx: NimiqTransaction | null
  try {
    tx = await fetchTx(txHash)
  } catch (error) {
    const api = toRpcApiError(error)
    throw new StakingIntentError(api.message, api.httpStatus, api.code)
  }

  if (tx == null) {
    throw new StakingIntentError(
      'Transaction is not yet visible on chain. Keep polling.',
      202,
      'TX_PENDING',
      5,
    )
  }

  if (tx.executionResult === false) {
    options.database
      .prepare(
        `UPDATE staking_intents
         SET status = 'failed', tx_hash = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(normalizeTxHash(tx.hash), intentId)
    throw new StakingIntentError(
      'The transaction executed unsuccessfully on chain.',
      422,
      'TX_FAILED',
    )
  }

  const params = parseStoredParams(row.params_json)
  const operation = row.operation as StakingOperation

  // Hard match: from-address must be the authenticated user.
  if (!addressesEqual(tx.from, address)) {
    throw new StakingIntentError(
      'The observed transaction does not match the recorded intent (sender).',
      422,
      'TX_MISMATCH',
    )
  }

  // Hard match: amount when valueLuna / retireStakeLuna present.
  if (!matchAmount(params, tx.value)) {
    throw new StakingIntentError(
      'The observed transaction does not match the recorded intent (amount).',
      422,
      'TX_MISMATCH',
    )
  }

  // Hash identity: prefer chain hash when present.
  const confirmedHash = normalizeTxHash(
    typeof tx.hash === 'string' && tx.hash.trim() !== '' ? tx.hash : txHash,
  )
  const confirmedAt = new Date(nowMs).toISOString()

  const updated = options.database
    .prepare(
      `UPDATE staking_intents
       SET status = 'confirmed', tx_hash = ?, confirmed_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(confirmedHash, confirmedAt, intentId)

  if (updated.changes !== 1) {
    throw new StakingIntentError(
      'This intent has already been confirmed and cannot be reused.',
      400,
      'VALIDATION',
    )
  }

  // Soft-check delegation for operations that set it (new-staker / update).
  // Stake keeps existing delegation; hard mismatch already covered above.
  // Intent is already confirmed — position read failure must not undo that.
  clearPositionCache()
  const readPosition = options.readPosition ?? readStakingPosition
  let position: StakingPositionEnvelope
  try {
    position = await readPosition({
      database: options.database,
      address,
      rpcUrl: options.rpcUrl,
      now: () => nowMs,
      bypassCache: true,
      // Intent is confirmed — do not overlay Pending for this read.
      hasPendingTx: false,
    })
  } catch {
    position = {
      updatedAt: confirmedAt,
      source: 'rpc',
      status: 'unavailable',
      dataFreshness: { ageSeconds: 0 },
      data: {
        state: 'NotStaked',
        accountBalanceLuna: null,
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

  const wantDelegation = expectedDelegation(params)
  if (
    wantDelegation &&
    (operation === 'new-staker' ||
      operation === 'update-staker' ||
      operation === 'stake')
  ) {
    const observed = position.data.staker.delegation
    if (observed != null && !addressesEqual(observed, wantDelegation)) {
      console.warn(
        JSON.stringify({
          event: 'staking-confirm:delegation-soft-mismatch',
          intentId,
          operation,
          expected: wantDelegation,
          observed: normalizeAddress(observed),
        }),
      )
    }
  }

  const blockNumber =
    typeof tx.blockNumber === 'number' && Number.isFinite(tx.blockNumber)
      ? tx.blockNumber
      : null

  return {
    status: 'confirmed',
    blockNumber,
    position,
  }
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): void {
  const error: { code: string; message: string; retryAfterSeconds?: number } = {
    code,
    message,
  }
  if (retryAfterSeconds != null) {
    error.retryAfterSeconds = retryAfterSeconds
    res.setHeader('Retry-After', String(retryAfterSeconds))
  }
  res.status(status).json({ error })
}

/**
 * Mount POST /api/staking/intent and POST /api/staking/confirm.
 * Auth is already applied to `/api/staking` by mountAuth.
 */
export function mountStakingIntents(
  app: Express,
  options: StakingIntentsOptions,
): void {
  app.post('/api/staking/intent', async (req: Request, res: Response) => {
    const address = res.locals.address as string | undefined
    if (!address) {
      sendError(res, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.')
      return
    }
    try {
      const body =
        req.body != null && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as { operation?: unknown; params?: unknown })
          : {}
      const result = await createStakingIntent(options, address, body)
      res.status(200).json(result)
    } catch (error) {
      if (error instanceof StakingIntentError) {
        sendError(
          res,
          error.httpStatus,
          error.code,
          error.message,
          error.retryAfterSeconds,
        )
        return
      }
      // PositionReadError or RPC failures during precondition read.
      if (
        error != null &&
        typeof error === 'object' &&
        'httpStatus' in error &&
        'code' in error &&
        'message' in error
      ) {
        const e = error as { httpStatus: number; code: string; message: string }
        sendError(res, e.httpStatus, e.code, e.message)
        return
      }
      const api = toRpcApiError(error)
      sendError(res, api.httpStatus, api.code, api.message)
    }
  })

  app.post('/api/staking/confirm', async (req: Request, res: Response) => {
    const address = res.locals.address as string | undefined
    if (!address) {
      sendError(res, 401, 'WALLET_NOT_CONNECTED', 'No valid wallet session.')
      return
    }
    try {
      const body =
        req.body != null && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as { intentId?: unknown; txHash?: unknown })
          : {}
      const result = await confirmStakingIntent(options, address, body)
      res.status(200).json(result)
    } catch (error) {
      if (error instanceof StakingIntentError) {
        sendError(
          res,
          error.httpStatus,
          error.code,
          error.message,
          error.retryAfterSeconds,
        )
        return
      }
      if (
        error != null &&
        typeof error === 'object' &&
        'httpStatus' in error &&
        'code' in error &&
        'message' in error
      ) {
        const e = error as { httpStatus: number; code: string; message: string }
        sendError(res, e.httpStatus, e.code, e.message)
        return
      }
      const api = toRpcApiError(error)
      sendError(res, api.httpStatus, api.code, api.message)
    }
  })
}
