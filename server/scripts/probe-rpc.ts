import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type RpcError = {
  code: number
  message: string
  data?: unknown
}

type RpcResponse = {
  jsonrpc: '2.0'
  id: number
  result?: {
    data: unknown
    metadata: unknown
  }
  error?: RpcError
}

type CaptureMetadata = {
  file: string
  method: string
  params: unknown[]
  httpStatus: number
  latencyMs: number
  retryAfter: string | null
  outcome: 'result' | 'error'
}

const DEFAULT_MAX = 3
const DEFAULT_TIMEOUT_MS = 10_000
const RPC_ID = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

function parsePositiveInteger(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function parseRpcResponse(payload: unknown): RpcResponse {
  if (!isRecord(payload) || payload.jsonrpc !== '2.0' || payload.id !== RPC_ID) {
    throw new Error('RPC response is not a JSON-RPC 2.0 response with id 1')
  }

  const hasResult = 'result' in payload
  const hasError = 'error' in payload
  if (hasResult === hasError) {
    throw new Error('RPC response must contain exactly one of result or error')
  }

  if (hasResult) {
    const result = payload.result
    if (!isRecord(result) || !('data' in result) || !('metadata' in result)) {
      throw new Error('RPC result must contain data and metadata')
    }
    return payload as unknown as RpcResponse
  }

  const error = payload.error
  if (!isRecord(error) || typeof error.code !== 'number' || typeof error.message !== 'string') {
    throw new Error('RPC error must contain a numeric code and message')
  }
  return payload as unknown as RpcResponse
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function publicEndpoint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '[invalid RPC URL]'
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeValue(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === 'string') {
    let sanitized = value
    for (const [source, replacement] of replacements) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(source), 'gi'), replacement)
      sanitized = sanitized.replace(
        new RegExp(escapeRegExp(source.replaceAll(' ', '')), 'gi'),
        replacement.replaceAll(' ', ''),
      )
    }
    return sanitized
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, replacements))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, replacements)]),
    )
  }
  return value
}

function assertNoSensitiveKeys(value: unknown, path = 'response'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return

  for (const [key, item] of Object.entries(value)) {
    if (/seed|mnemonic|private.?key|passphrase|secret/i.test(key)) {
      throw new Error(`Refusing to write sensitive RPC field ${path}.${key}`)
    }
    assertNoSensitiveKeys(item, `${path}.${key}`)
  }
}

async function requestRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<{ response: RpcResponse; httpStatus: number; latencyMs: number; retryAfter: string | null }> {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: RPC_ID }),
      signal: controller.signal,
    })
    const body = await response.json()
    return {
      response: parseRpcResponse(body),
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      retryAfter: response.headers.get('retry-after'),
    }
  } catch (error) {
    throw new Error(`${method} failed: ${errorMessage(error)}`)
  } finally {
    clearTimeout(timeout)
  }
}

function responseData(response: RpcResponse): unknown {
  return response.result?.data
}

function firstTransactionHash(response: RpcResponse): string | undefined {
  const data = responseData(response)
  if (!Array.isArray(data) || !isRecord(data[0]) || typeof data[0].hash !== 'string') return undefined
  return data[0].hash
}

async function main(): Promise<void> {
  const rpcUrl = requiredEnv('NIMIQ_RPC_URL')
  const network = requiredEnv('NIMIQ_NETWORK')
  const validatorAddress = requiredEnv('RPC_VALIDATOR_ADDRESS')
  const accountAddress = process.env.RPC_ACCOUNT_ADDRESS?.trim() || validatorAddress
  const stakerAddress = process.env.RPC_STAKER_ADDRESS?.trim() || accountAddress
  const transactionsAddress = process.env.RPC_TRANSACTIONS_ADDRESS?.trim() || validatorAddress
  const max = parsePositiveInteger('RPC_TRANSACTIONS_MAX', DEFAULT_MAX)
  const timeoutMs = parsePositiveInteger('RPC_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
  const outputDirectory = resolve(process.env.RPC_FIXTURE_DIR?.trim() || 'tests/fixtures/rpc')
  const capturedAt = new Date().toISOString()
  const fileSuffix = network.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const replacements = new Map<string, string>()
  const sensitiveAddresses = new Set([accountAddress, stakerAddress])
  let replacementIndex = 0
  for (const address of sensitiveAddresses) {
    replacements.set(
      address,
      `NQ00 0000 0000 0000 0000 0000 0000 0000 ${String(replacementIndex).padStart(4, '0')}`,
    )
    replacementIndex += 1
  }

  await mkdir(outputDirectory, { recursive: true })
  const captures: CaptureMetadata[] = []

  const capture = async (name: string, method: string, params: unknown[]): Promise<RpcResponse> => {
    const result = await requestRpc(rpcUrl, method, params, timeoutMs)
    const sanitizedResponse = sanitizeValue(result.response, replacements)
    assertNoSensitiveKeys(sanitizedResponse)
    const file = `${name}-${fileSuffix}.json`
    await writeFile(`${outputDirectory}/${file}`, `${JSON.stringify(sanitizedResponse, null, 2)}\n`)
    captures.push({
      file,
      method,
      params: sanitizeValue(params, replacements) as unknown[],
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      retryAfter: result.retryAfter,
      outcome: result.response.error ? 'error' : 'result',
    })
    return result.response
  }

  await capture('p0-04-get-block-number', 'getBlockNumber', [])
  await capture('p0-04-validator-by-address', 'getValidatorByAddress', [validatorAddress])
  await capture('p0-04-active-validators', 'getActiveValidators', [])
  await capture('p0-04-account-by-address', 'getAccountByAddress', [accountAddress])
  await capture('p0-04-staker-by-address', 'getStakerByAddress', [stakerAddress])

  const pageOne = await capture('p0-04-transactions-by-address-page-1', 'getTransactionsByAddress', [
    transactionsAddress,
    max,
    null,
  ])
  const cursor = process.env.RPC_TRANSACTION_CURSOR?.trim() || firstTransactionHash(pageOne)
  if (!cursor) {
    throw new Error('Cannot capture transaction page 2: set RPC_TRANSACTION_CURSOR when page 1 is empty')
  }
  await capture('p0-04-transactions-by-address-page-2', 'getTransactionsByAddress', [
    transactionsAddress,
    max,
    cursor,
  ])

  const transactionHash = process.env.RPC_TRANSACTION_HASH?.trim() || firstTransactionHash(pageOne)
  if (!transactionHash) {
    throw new Error('Cannot capture getTransactionByHash: set RPC_TRANSACTION_HASH when page 1 is empty')
  }
  await capture('p0-04-transaction-by-hash', 'getTransactionByHash', [transactionHash])

  const metadata = {
    capture: 'P0-04 RPC read-layer probe',
    endpoint: publicEndpoint(rpcUrl),
    network,
    capturedAt,
    timeoutMs,
    transactionPageSize: max,
    redaction: {
      userAddressInputs: 'replaced with deterministic NQ00 test addresses',
      validatorAddresses: 'retained as public chain data',
      secrets: 'probe refuses fields named seed, mnemonic, privateKey, passphrase, or secret',
    },
    captures,
  }
  await writeFile(`${outputDirectory}/_meta.json`, `${JSON.stringify(metadata, null, 2)}\n`)
  console.log(`Captured ${captures.length} RPC responses to ${outputDirectory}`)
}

main().catch((error: unknown) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
