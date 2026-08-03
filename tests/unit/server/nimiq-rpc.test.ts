import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchTransaction,
  fetchTransactionsByAddress,
  getAccountByAddress,
  getActiveValidators,
  getBlockNumber,
  getRpcHealth,
  getRpcMetrics,
  getStakerByAddress,
  getValidatorByAddress,
  isRetriableRpcError,
  isStakerNotFoundError,
  isTransactionNotFoundError,
  normalizeTxHash,
  resetRpcClientConfig,
  resetRpcMetrics,
  resolveRpcEndpoints,
  RpcError,
  setRpcClientConfig,
  toRpcApiError,
} from '../../../server/src/nimiq-rpc.js'
import { createMockRpc } from '../../helpers/mockRpc.js'

const RPC_URL = 'https://rpc.example.test'
const PRIMARY_URL = 'https://primary.example.test'
const FALLBACK_URL = 'https://fallback.example.test'

describe('Nimiq RPC client', () => {
  beforeEach(() => {
    resetRpcClientConfig()
    resetRpcMetrics()
    setRpcClientConfig({
      maxAttempts: 5,
      retryBaseMs: 1,
      retryMaxMs: 5,
      retryJitter: 0,
      sleep: async () => undefined,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetRpcClientConfig()
    resetRpcMetrics()
  })

  it('requests getBlockNumber and unwraps result.data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', result: { data: 12345, metadata: null }, id: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBlockNumber(RPC_URL)).resolves.toBe(12345)
    expect(fetchMock).toHaveBeenCalledWith(
      RPC_URL,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'getBlockNumber', params: [], id: 1 }),
      }),
    )
  })

  it('rejects malformed block responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', result: { data: '12345' }, id: 1 }),
      }),
    )

    await expect(getBlockNumber(RPC_URL)).rejects.toThrow('malformed')
  })

  it('serves all P0-04 fixture-backed methods through mockRpc', async () => {
    const rpc = createMockRpc({
      fixtures: {
        getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json',
        getValidatorByAddress: 'rpc/p0-04-validator-by-address-mainnet.json',
        getActiveValidators: 'rpc/p0-04-active-validators-mainnet.json',
        getAccountByAddress: 'rpc/p0-04-account-by-address-mainnet.json',
        getStakerByAddress: 'rpc/p0-04-staker-by-address-mainnet.json',
        getTransactionsByAddress: 'rpc/p0-04-transactions-by-address-page-1-mainnet.json',
        getTransactionByHash: 'rpc/p0-04-transaction-by-hash-mainnet.json',
      },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    await expect(getBlockNumber(RPC_URL)).resolves.toBe(57873409)

    const validator = await getValidatorByAddress(
      'NQ26 0000 0000 02A5 YAK7 4QNF 9MH0 TE2B GVRU',
      RPC_URL,
    )
    expect(validator.rewardAddress).toMatch(/^NQ/)

    const active = await getActiveValidators(RPC_URL)
    expect(active.length).toBeGreaterThan(0)
    expect(active[0]?.address).toMatch(/^NQ/)

    const account = await getAccountByAddress(
      'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      RPC_URL,
    )
    expect(account).toMatchObject({ balance: 0, type: 'basic' })

    await expect(
      getStakerByAddress('NQ00 0000 0000 0000 0000 0000 0000 0000 0000', RPC_URL),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error && isStakerNotFoundError(error.message),
    )

    const txs = await fetchTransactionsByAddress(
      'NQ26 0000 0000 02A5 YAK7 4QNF 9MH0 TE2B GVRU',
      3,
      null,
      RPC_URL,
    )
    expect(txs[0]?.hash).toMatch(/^[a-f0-9]{64}$/i)
    expect(txs[0]?.executionResult).toBe(true)

    const tx = await fetchTransaction(
      '07f7a5e236aad83e3631c0544ab4756cba091ebf5ced6593669b750c8afa8a73',
      RPC_URL,
    )
    expect(tx?.hash).toBe('07f7a5e236aad83e3631c0544ab4756cba091ebf5ced6593669b750c8afa8a73')

    expect(rpc.getCallCount('getBlockNumber')).toBe(1)
    expect(rpc.getCallCount('getValidatorByAddress')).toBe(1)
    expect(rpc.getCallCount('getActiveValidators')).toBe(1)
    expect(rpc.getCallCount('getAccountByAddress')).toBe(1)
    expect(rpc.getCallCount('getStakerByAddress')).toBe(1)
    expect(rpc.getCallCount('getTransactionsByAddress')).toBe(1)
    expect(rpc.getCallCount('getTransactionByHash')).toBe(1)
  })

  it('retries on injected timeouts then succeeds', async () => {
    const rpc = createMockRpc({
      fixtures: { getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json' },
      timeouts: { getBlockNumber: { times: 2 } },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    const sleeps: number[] = []
    setRpcClientConfig({
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      retryBaseMs: 10,
      retryMaxMs: 1000,
      retryJitter: 0,
    })

    await expect(getBlockNumber(RPC_URL)).resolves.toBe(57873409)
    expect(rpc.getCallCount('getBlockNumber')).toBe(3)
    expect(sleeps).toEqual([10, 20])

    const snapshot = getRpcMetrics()
    expect(snapshot.calls).toBe(1)
    expect(snapshot.successes).toBe(1)
    expect(snapshot.retries).toBe(2)
    expect(snapshot.errors).toBe(0)
    expect(snapshot.byMethod.getBlockNumber?.retries).toBe(2)
  })

  it('retries on HTTP 429 and 5xx then succeeds', async () => {
    const successBody = {
      jsonrpc: '2.0',
      result: { data: 99, metadata: null },
      id: 1,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => successBody,
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBlockNumber(RPC_URL)).resolves.toBe(99)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getRpcMetrics().retries).toBe(2)
  })

  it('does not retry permanent JSON-RPC method errors', async () => {
    const rpc = createMockRpc({
      fixtures: { getStakerByAddress: 'rpc/p0-04-staker-by-address-mainnet.json' },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    await expect(
      getStakerByAddress('NQ00 0000 0000 0000 0000 0000 0000 0000 0000', RPC_URL),
    ).rejects.toThrow(/No staker/i)
    expect(rpc.getCallCount('getStakerByAddress')).toBe(1)
    expect(getRpcMetrics().retries).toBe(0)
    expect(getRpcMetrics().errors).toBe(1)
  })

  it('exhausts retries on persistent transport failures', async () => {
    const rpc = createMockRpc({
      fixtures: { getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json' },
      timeouts: { getBlockNumber: { times: 10 } },
    })
    vi.stubGlobal('fetch', rpc.fetch)
    setRpcClientConfig({ maxAttempts: 3 })

    await expect(getBlockNumber(RPC_URL)).rejects.toBeInstanceOf(RpcError)
    expect(rpc.getCallCount('getBlockNumber')).toBe(3)
    expect(getRpcMetrics()).toMatchObject({
      calls: 1,
      successes: 0,
      errors: 1,
      retries: 2,
    })
  })

  it('returns null for transaction-not-found method errors', async () => {
    const rpc = createMockRpc({
      fixtures: {
        getTransactionByHash: {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error',
            data: 'Transaction not found: abcd',
          },
          id: 1,
        },
      },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    await expect(fetchTransaction('abcd', RPC_URL)).resolves.toBeNull()
  })

  it('maps errors to API taxonomy helpers', () => {
    const unavailable = new RpcError('down', { code: 'RPC_UNAVAILABLE', retriable: true })
    expect(toRpcApiError(unavailable)).toEqual({
      code: 'RPC_UNAVAILABLE',
      message: 'down',
      httpStatus: 503,
    })
    expect(isRetriableRpcError(unavailable)).toBe(true)
    expect(isTransactionNotFoundError('Transaction not found: abc')).toBe(true)
    expect(isStakerNotFoundError('Internal error: No staker with address: NQ00')).toBe(true)
    expect(normalizeTxHash('0xAbCd')).toBe('abcd')
  })

  it('throws when NIMIQ_RPC_URL is missing', async () => {
    const previous = process.env.NIMIQ_RPC_URL
    const previousFallback = process.env.NIMIQ_RPC_URL_FALLBACK
    delete process.env.NIMIQ_RPC_URL
    delete process.env.NIMIQ_RPC_URL_FALLBACK
    try {
      await expect(getBlockNumber(undefined)).rejects.toThrow('NIMIQ_RPC_URL is not configured')
    } finally {
      if (previous !== undefined) process.env.NIMIQ_RPC_URL = previous
      else delete process.env.NIMIQ_RPC_URL
      if (previousFallback !== undefined) process.env.NIMIQ_RPC_URL_FALLBACK = previousFallback
      else delete process.env.NIMIQ_RPC_URL_FALLBACK
    }
  })

  it('resolveRpcEndpoints: custom URL is pinned; primary includes fallback', () => {
    const previous = process.env.NIMIQ_RPC_URL
    const previousFallback = process.env.NIMIQ_RPC_URL_FALLBACK
    process.env.NIMIQ_RPC_URL = PRIMARY_URL
    process.env.NIMIQ_RPC_URL_FALLBACK = FALLBACK_URL
    try {
      expect(resolveRpcEndpoints(RPC_URL)).toEqual([{ url: RPC_URL, source: 'primary' }])
      expect(resolveRpcEndpoints(PRIMARY_URL)).toEqual([
        { url: PRIMARY_URL, source: 'primary' },
        { url: FALLBACK_URL, source: 'fallback' },
      ])
      expect(resolveRpcEndpoints()).toEqual([
        { url: PRIMARY_URL, source: 'primary' },
        { url: FALLBACK_URL, source: 'fallback' },
      ])
    } finally {
      if (previous !== undefined) process.env.NIMIQ_RPC_URL = previous
      else delete process.env.NIMIQ_RPC_URL
      if (previousFallback !== undefined) process.env.NIMIQ_RPC_URL_FALLBACK = previousFallback
      else delete process.env.NIMIQ_RPC_URL_FALLBACK
    }
  })

  it('failovers to NIMIQ_RPC_URL_FALLBACK after primary transport exhaustion', async () => {
    const previous = process.env.NIMIQ_RPC_URL
    const previousFallback = process.env.NIMIQ_RPC_URL_FALLBACK
    process.env.NIMIQ_RPC_URL = PRIMARY_URL
    process.env.NIMIQ_RPC_URL_FALLBACK = FALLBACK_URL
    setRpcClientConfig({ maxAttempts: 2 })

    const successBody = {
      jsonrpc: '2.0',
      result: { data: 42_000, metadata: null },
      id: 1,
    }
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input)
      if (url === PRIMARY_URL) {
        throw new Error('fetch failed: primary down')
      }
      if (url === FALLBACK_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => successBody,
        }
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      await expect(getBlockNumber()).resolves.toBe(42_000)
      // primary: 2 attempts, then fallback: 1 success
      expect(fetchMock).toHaveBeenCalled()
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.filter((u) => u === PRIMARY_URL).length).toBe(2)
      expect(urls.filter((u) => u === FALLBACK_URL).length).toBe(1)

      const health = getRpcHealth()
      expect(health.activeSource).toBe('fallback')
      expect(health.activeHost).toBe('fallback.example.test')
      expect(health.available).toBe(true)
      expect(health.degraded).toBe(true)
      expect(health.liveReads).toBe(true)
      expect(health.fallbackConfigured).toBe(true)
    } finally {
      if (previous !== undefined) process.env.NIMIQ_RPC_URL = previous
      else delete process.env.NIMIQ_RPC_URL
      if (previousFallback !== undefined) process.env.NIMIQ_RPC_URL_FALLBACK = previousFallback
      else delete process.env.NIMIQ_RPC_URL_FALLBACK
    }
  })

  it('marks health unavailable when all endpoints fail', async () => {
    const previous = process.env.NIMIQ_RPC_URL
    const previousFallback = process.env.NIMIQ_RPC_URL_FALLBACK
    process.env.NIMIQ_RPC_URL = PRIMARY_URL
    process.env.NIMIQ_RPC_URL_FALLBACK = FALLBACK_URL
    setRpcClientConfig({ maxAttempts: 1 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('fetch failed: all down')),
    )

    try {
      await expect(getBlockNumber()).rejects.toBeInstanceOf(RpcError)
      const health = getRpcHealth()
      expect(health.available).toBe(false)
      expect(health.degraded).toBe(true)
      expect(health.liveReads).toBe(false)
      expect(health.activeSource).toBeNull()
    } finally {
      if (previous !== undefined) process.env.NIMIQ_RPC_URL = previous
      else delete process.env.NIMIQ_RPC_URL
      if (previousFallback !== undefined) process.env.NIMIQ_RPC_URL_FALLBACK = previousFallback
      else delete process.env.NIMIQ_RPC_URL_FALLBACK
    }
  })
})
