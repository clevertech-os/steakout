const RPC_TIMEOUT_MS = 10_000

interface RpcRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is RpcRecord {
  return typeof value === 'object' && value !== null
}

export interface NimiqValidator {
  address: string
  rewardAddress: string
  [key: string]: unknown
}

export interface NimiqTransaction {
  hash: string
  blockNumber?: number
  timestamp?: number
  from: string
  to: string
  value: number
  fee: number
  executionResult: boolean
  [key: string]: unknown
}

async function requestRpcData<T>(
  method: string,
  params: unknown[],
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<T> {
  if (!rpcUrl) {
    throw new Error('NIMIQ_RPC_URL is not configured')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)

  try {
    const response = await fetch(rpcUrl, {
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

    if (!response.ok) {
      throw new Error(`RPC HTTP status ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload)) {
      throw new Error('RPC response is not an object')
    }

    if ('error' in payload) {
      throw new Error(`RPC ${method} returned an error`)
    }

    const result = payload.result
    if (!isRecord(result) || !('data' in result)) {
      throw new Error(`RPC ${method} result is malformed`)
    }

    return result.data as T
  } finally {
    clearTimeout(timeout)
  }
}

export async function getBlockNumber(
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<number> {
  const blockNumber = await requestRpcData<unknown>('getBlockNumber', [], rpcUrl)
  if (typeof blockNumber !== 'number' || !Number.isInteger(blockNumber)) {
    throw new Error('RPC block number is malformed')
  }

  return blockNumber
}

export async function getValidatorByAddress(
  address: string,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqValidator> {
  const validator = await requestRpcData<unknown>('getValidatorByAddress', [address], rpcUrl)
  if (
    !isRecord(validator) ||
    typeof validator.address !== 'string' ||
    typeof validator.rewardAddress !== 'string'
  ) {
    throw new Error('RPC validator response is malformed')
  }

  return validator as NimiqValidator
}

export async function fetchTransactionsByAddress(
  address: string,
  max = 500,
  startAt: string | null = null,
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<NimiqTransaction[]> {
  const transactions = await requestRpcData<unknown>(
    'getTransactionsByAddress',
    [address, max, startAt],
    rpcUrl,
  )
  if (!Array.isArray(transactions)) {
    throw new Error('RPC transactions response is malformed')
  }

  return transactions.map((transaction) => {
    if (
      typeof transaction !== 'object' ||
      transaction === null ||
      typeof transaction.hash !== 'string' ||
      typeof transaction.from !== 'string' ||
      typeof transaction.to !== 'string' ||
      typeof transaction.value !== 'number' ||
      typeof transaction.fee !== 'number' ||
      typeof transaction.executionResult !== 'boolean'
    ) {
      throw new Error('RPC transaction response is malformed')
    }
    return transaction as NimiqTransaction
  })
}
