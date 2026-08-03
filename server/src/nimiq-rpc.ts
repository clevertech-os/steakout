/**
 * Single Nimiq JSON-RPC gateway for the server.
 * Ported transport/retry patterns from VeriLock `server/src/nimiq-rpc.ts`
 * (document attestation, broadcast, and light-client paths stripped).
 *
 * Config: NIMIQ_RPC_URL, 10s timeout, exponential backoff base 2s → max 5 min + jitter.
 * All server-side chain reads must go through this module.
 */

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_MS = 2_000
const DEFAULT_RETRY_MAX_MS = 5 * 60_000
const DEFAULT_RETRY_JITTER = 0.2

export type RpcApiErrorCode = 'RPC_UNAVAILABLE' | 'RPC_MALFORMED' | 'RPC_METHOD_ERROR'

export interface RpcClientConfig {
  timeoutMs: number
  maxAttempts: number
  retryBaseMs: number
  retryMaxMs: number
  retryJitter: number
  sleep: (milliseconds: number) => Promise<void>
  fetchImpl: typeof fetch
}

export interface RpcMethodMetrics {
  calls: number
  successes: number
  errors: number
  retries: number
  totalLatencyMs: number
}

export interface RpcMetrics {
  calls: number
  successes: number
  errors: number
  retries: number
  totalLatencyMs: number
  lastCallAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
  byMethod: Record<string, RpcMethodMetrics>
}

export class RpcError extends Error {
  readonly code: RpcApiErrorCode
  readonly retriable: boolean
  readonly httpStatus: number | null
  readonly method: string | null

  constructor(
    message: string,
    options: {
      code: RpcApiErrorCode
      retriable?: boolean
      httpStatus?: number | null
      method?: string | null
      cause?: unknown
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'RpcError'
    this.code = options.code
    this.retriable = options.retriable ?? options.code === 'RPC_UNAVAILABLE'
    this.httpStatus = options.httpStatus ?? null
    this.method = options.method ?? null
  }
}

interface RpcRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is RpcRecord {
  return typeof value === 'object' && value !== null
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function defaultFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Resolve global fetch at call time so vitest `stubGlobal('fetch', …)` works.
  return globalThis.fetch(input, init)
}

const defaultConfig: RpcClientConfig = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  retryBaseMs: DEFAULT_RETRY_BASE_MS,
  retryMaxMs: DEFAULT_RETRY_MAX_MS,
  retryJitter: DEFAULT_RETRY_JITTER,
  sleep: defaultSleep,
  fetchImpl: defaultFetch,
}

let clientConfig: RpcClientConfig = { ...defaultConfig }

const emptyMetrics = (): RpcMetrics => ({
  calls: 0,
  successes: 0,
  errors: 0,
  retries: 0,
  totalLatencyMs: 0,
  lastCallAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  byMethod: {},
})

let metrics: RpcMetrics = emptyMetrics()

function methodMetrics(method: string): RpcMethodMetrics {
  const existing = metrics.byMethod[method]
  if (existing) return existing
  const created: RpcMethodMetrics = {
    calls: 0,
    successes: 0,
    errors: 0,
    retries: 0,
    totalLatencyMs: 0,
  }
  metrics.byMethod[method] = created
  return created
}

/** Override client config (tests). Partial merge; call `resetRpcClientConfig` in afterEach. */
export function setRpcClientConfig(partial: Partial<RpcClientConfig>): void {
  clientConfig = { ...clientConfig, ...partial }
}

export function resetRpcClientConfig(): void {
  clientConfig = { ...defaultConfig }
}

export function getRpcMetrics(): RpcMetrics {
  return {
    ...metrics,
    byMethod: Object.fromEntries(
      Object.entries(metrics.byMethod).map(([method, value]) => [method, { ...value }]),
    ),
  }
}

export function resetRpcMetrics(): void {
  metrics = emptyMetrics()
}

/** Nimiq RPC often returns message "Internal error" with details in `data`. */
export function formatRpcError(error: { message?: string; data?: unknown }): string {
  const message = error.message?.trim() || 'Nimiq RPC error'
  const data = typeof error.data === 'string' ? error.data.trim() : ''
  if (!data || message.toLowerCase().includes(data.toLowerCase())) return message
  return `${message}: ${data}`
}

export function isTransactionNotFoundError(message: string): boolean {
  return /transaction not found/i.test(message)
}

export function isStakerNotFoundError(message: string): boolean {
  return /no staker with address/i.test(message)
}

export function normalizeTxHash(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase()
}

/** Map transport/parse failures to API error codes for Express handlers. */
export function toRpcApiError(error: unknown): {
  code: RpcApiErrorCode
  message: string
  httpStatus: number
} {
  if (error instanceof RpcError) {
    const httpStatus =
      error.code === 'RPC_UNAVAILABLE' ? 503 : error.code === 'RPC_MALFORMED' ? 502 : 502
    return { code: error.code, message: error.message, httpStatus }
  }
  if (error instanceof Error) {
    return {
      code: 'RPC_UNAVAILABLE',
      message: error.message || 'The Nimiq RPC is unavailable.',
      httpStatus: 503,
    }
  }
  return {
    code: 'RPC_UNAVAILABLE',
    message: 'The Nimiq RPC is unavailable.',
    httpStatus: 503,
  }
}

export function isRetriableRpcError(error: unknown): boolean {
  if (error instanceof RpcError) return error.retriable
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  const message = error.message
  if (/HTTP status 429/i.test(message)) return true
  if (/HTTP status 5\d\d/i.test(message)) return true
  if (/HTTP status 408/i.test(message)) return true
  if (/fetch failed|network|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket/i.test(message)) return true
  return false
}

function backoffDelayMs(attempt: number): number {
  const exponential = Math.min(
    clientConfig.retryMaxMs,
    clientConfig.retryBaseMs * 2 ** (attempt - 1),
  )
  const randomized = exponential * (1 + Math.random() * clientConfig.retryJitter)
  return Math.round(randomized)
}

async function requestOnce<T>(
  method: string,
  params: unknown[],
  rpcUrl: string,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), clientConfig.timeoutMs)

  try {
    let response: Response
    try {
      response = await clientConfig.fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
          id: 1,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RpcError(`RPC ${method} timed out after ${clientConfig.timeoutMs}ms`, {
          code: 'RPC_UNAVAILABLE',
          retriable: true,
          method,
          cause: error,
        })
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new RpcError(`RPC ${method} transport failed: ${message}`, {
        code: 'RPC_UNAVAILABLE',
        retriable: true,
        method,
        cause: error,
      })
    }

    if (response.status === 429 || response.status === 408 || response.status >= 500) {
      throw new RpcError(`RPC HTTP status ${response.status}`, {
        code: 'RPC_UNAVAILABLE',
        retriable: true,
        httpStatus: response.status,
        method,
      })
    }

    if (!response.ok) {
      throw new RpcError(`RPC HTTP status ${response.status}`, {
        code: 'RPC_UNAVAILABLE',
        retriable: false,
        httpStatus: response.status,
        method,
      })
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throw new RpcError(`RPC ${method} response is not JSON`, {
        code: 'RPC_MALFORMED',
        retriable: false,
        method,
        cause: error,
      })
    }

    if (!isRecord(payload)) {
      throw new RpcError('RPC response is not an object', {
        code: 'RPC_MALFORMED',
        retriable: false,
        method,
      })
    }

    if ('error' in payload && payload.error != null) {
      const rpcError = isRecord(payload.error) ? payload.error : {}
      const formatted = formatRpcError({
        message: typeof rpcError.message === 'string' ? rpcError.message : undefined,
        data: rpcError.data,
      })
      throw new RpcError(`RPC ${method} returned an error: ${formatted}`, {
        code: 'RPC_METHOD_ERROR',
        retriable: false,
        method,
      })
    }

    const result = payload.result
    if (!isRecord(result) || !('data' in result)) {
      throw new RpcError(`RPC ${method} result is malformed`, {
        code: 'RPC_MALFORMED',
        retriable: false,
        method,
      })
    }

    return result.data as T
  } finally {
    clearTimeout(timeout)
  }
}

async function requestRpcData<T>(
  method: string,
  params: unknown[],
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<T> {
  if (!rpcUrl) {
    throw new RpcError('NIMIQ_RPC_URL is not configured', {
      code: 'RPC_UNAVAILABLE',
      retriable: false,
      method,
    })
  }

  const startedAt = performance.now()
  const perMethod = methodMetrics(method)
  perMethod.calls += 1
  metrics.calls += 1
  metrics.lastCallAt = new Date().toISOString()

  let lastError: unknown = null
  const maxAttempts = Math.max(1, clientConfig.maxAttempts)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await requestOnce<T>(method, params, rpcUrl)
      const latency = Math.round(performance.now() - startedAt)
      perMethod.successes += 1
      perMethod.totalLatencyMs += latency
      metrics.successes += 1
      metrics.totalLatencyMs += latency
      return data
    } catch (error) {
      lastError = error
      const retriable = isRetriableRpcError(error) && attempt < maxAttempts
      if (retriable) {
        perMethod.retries += 1
        metrics.retries += 1
        await clientConfig.sleep(backoffDelayMs(attempt))
        continue
      }
      break
    }
  }

  const latency = Math.round(performance.now() - startedAt)
  perMethod.errors += 1
  perMethod.totalLatencyMs += latency
  metrics.errors += 1
  metrics.totalLatencyMs += latency
  metrics.lastErrorAt = new Date().toISOString()
  metrics.lastErrorMessage =
    lastError instanceof Error ? lastError.message : String(lastError ?? 'RPC failed')

  if (lastError instanceof Error) throw lastError
  throw new RpcError(`RPC ${method} failed`, {
    code: 'RPC_UNAVAILABLE',
    retriable: false,
    method,
  })
}

export interface NimiqValidator {
  address: string
  rewardAddress: string
  signingKey?: string
  votingKey?: string
  signalData?: string | null
  balance?: number
  numStakers?: number
  inactivityFlag?: number | null
  retired?: boolean
  jailedFrom?: number | null
  [key: string]: unknown
}

export interface NimiqAccount {
  address: string
  balance: number
  type: string
  [key: string]: unknown
}

export interface NimiqStaker {
  address: string
  balance: number
  delegation: string | null
  inactiveBalance: number
  inactiveFrom: number | null
  retiredBalance: number
  [key: string]: unknown
}

export interface NimiqTransaction {
  hash: string
  blockNumber?: number
  timestamp?: number
  confirmations?: number
  from: string
  to: string
  value: number
  fee: number
  executionResult: boolean
  recipientData?: string
  validityStartHeight?: number
  [key: string]: unknown
}

function parseValidator(value: unknown, context: string): NimiqValidator {
  if (
    !isRecord(value) ||
    typeof value.address !== 'string' ||
    typeof value.rewardAddress !== 'string'
  ) {
    throw new RpcError(`${context} is malformed`, {
      code: 'RPC_MALFORMED',
      retriable: false,
    })
  }
  return value as NimiqValidator
}

function parseTransaction(value: unknown): NimiqTransaction {
  if (
    !isRecord(value) ||
    typeof value.hash !== 'string' ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.value !== 'number' ||
    typeof value.fee !== 'number' ||
    typeof value.executionResult !== 'boolean'
  ) {
    throw new RpcError('RPC transaction response is malformed', {
      code: 'RPC_MALFORMED',
      retriable: false,
    })
  }
  return value as NimiqTransaction
}

export async function getBlockNumber(
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<number> {
  const blockNumber = await requestRpcData<unknown>('getBlockNumber', [], rpcUrl)
  if (typeof blockNumber !== 'number' || !Number.isInteger(blockNumber)) {
    throw new RpcError('RPC block number is malformed', {
      code: 'RPC_MALFORMED',
      retriable: false,
      method: 'getBlockNumber',
    })
  }
  return blockNumber
}

export async function getValidatorByAddress(
  address: string,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqValidator> {
  const validator = await requestRpcData<unknown>('getValidatorByAddress', [address], rpcUrl)
  return parseValidator(validator, 'RPC validator response')
}

export async function getActiveValidators(
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqValidator[]> {
  const validators = await requestRpcData<unknown>('getActiveValidators', [], rpcUrl)
  if (!Array.isArray(validators)) {
    throw new RpcError('RPC active validators response is malformed', {
      code: 'RPC_MALFORMED',
      retriable: false,
      method: 'getActiveValidators',
    })
  }
  return validators.map((item, index) =>
    parseValidator(item, `RPC active validator at index ${index}`),
  )
}

export async function getAccountByAddress(
  address: string,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqAccount> {
  const account = await requestRpcData<unknown>('getAccountByAddress', [address], rpcUrl)
  if (
    !isRecord(account) ||
    typeof account.address !== 'string' ||
    typeof account.balance !== 'number' ||
    typeof account.type !== 'string'
  ) {
    throw new RpcError('RPC account response is malformed', {
      code: 'RPC_MALFORMED',
      retriable: false,
      method: 'getAccountByAddress',
    })
  }
  return account as NimiqAccount
}

/**
 * Staker read. Throws RpcError with RPC_METHOD_ERROR when the address has no staker
 * (detect via `isStakerNotFoundError(error.message)`).
 */
export async function getStakerByAddress(
  address: string,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqStaker> {
  const staker = await requestRpcData<unknown>('getStakerByAddress', [address], rpcUrl)
  if (
    !isRecord(staker) ||
    typeof staker.address !== 'string' ||
    typeof staker.balance !== 'number'
  ) {
    throw new RpcError('RPC staker response is malformed', {
      code: 'RPC_MALFORMED',
      retriable: false,
      method: 'getStakerByAddress',
    })
  }
  return staker as NimiqStaker
}

export async function fetchTransactionsByAddress(
  address: string,
  max = 500,
  startAt: string | null = null,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqTransaction[]> {
  const limit = Math.min(Math.max(1, Math.floor(max)), 500)
  const start =
    startAt == null || startAt === ''
      ? null
      : normalizeTxHash(startAt)

  const transactions = await requestRpcData<unknown>(
    'getTransactionsByAddress',
    [address, limit, start],
    rpcUrl,
  )
  if (!Array.isArray(transactions)) {
    throw new RpcError('RPC transactions response is malformed', {
      code: 'RPC_MALFORMED',
      retriable: false,
      method: 'getTransactionsByAddress',
    })
  }
  return transactions.map(parseTransaction)
}

/**
 * Transaction by hash. Returns null when the chain reports the tx as not found.
 * Other RPC failures throw.
 */
export async function fetchTransaction(
  hash: string,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqTransaction | null> {
  const cleanHash = normalizeTxHash(hash)
  try {
    const transaction = await requestRpcData<unknown>('getTransactionByHash', [cleanHash], rpcUrl)
    return parseTransaction(transaction)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isTransactionNotFoundError(message)) return null
    throw error
  }
}
