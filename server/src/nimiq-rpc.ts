const RPC_TIMEOUT_MS = 10_000

interface RpcRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is RpcRecord {
  return typeof value === 'object' && value !== null
}

export async function getBlockNumber(
  rpcUrl = process.env.NIMIQ_RPC_URL,
): Promise<number> {
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
        method: 'getBlockNumber',
        params: [],
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
      throw new Error('RPC returned an error')
    }

    const result = payload.result
    if (!isRecord(result) || typeof result.data !== 'number' || !Number.isInteger(result.data)) {
      throw new Error('RPC block number is malformed')
    }

    return result.data
  } finally {
    clearTimeout(timeout)
  }
}
