import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBlockNumber } from '../../../server/src/nimiq-rpc.js'
import { loadFixtureWithMeta } from '../../helpers/fixtures.js'
import { createMockRpc, type JsonRpcResponse } from '../../helpers/mockRpc.js'

describe('fixture harness', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads typed P0-04 data and serves it through the RPC mock', async () => {
    const loaded = loadFixtureWithMeta<JsonRpcResponse>('rpc/p0-04-get-block-number-mainnet.json')
    expect(loaded.data.result).toEqual({ data: 57873409, metadata: null })
    expect(loaded.capture.method).toBe('getBlockNumber')

    const rpc = createMockRpc({
      fixtures: { getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json' },
    })
    vi.stubGlobal('fetch', rpc.fetch)

    await expect(getBlockNumber('https://rpc.example.test')).resolves.toBe(57873409)
    expect(rpc.getCallCount('getBlockNumber')).toBe(1)
    expect(rpc.getCalls('getBlockNumber')[0]?.params).toEqual([])
  })

  it('injects finite errors and timeouts while counting failed calls', async () => {
    const errorRpc = createMockRpc({
      fixtures: { getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json' },
      errors: { getBlockNumber: { message: 'upstream unavailable', times: 1 } },
    })
    await expect(errorRpc.fetch('https://rpc.example.test', {
      method: 'POST',
      body: JSON.stringify({ method: 'getBlockNumber', params: [] }),
    })).rejects.toThrow('upstream unavailable')
    expect(errorRpc.getCallCount('getBlockNumber')).toBe(1)
    await expect(errorRpc.fetch('https://rpc.example.test', {
      method: 'POST',
      body: JSON.stringify({ method: 'getBlockNumber', params: [] }),
    })).resolves.toMatchObject({ ok: true })
    expect(errorRpc.getCallCount('getBlockNumber')).toBe(2)

    const timeoutRpc = createMockRpc({
      fixtures: { getBlockNumber: 'rpc/p0-04-get-block-number-mainnet.json' },
      timeouts: { getBlockNumber: true },
    })
    await expect(timeoutRpc.fetch('https://rpc.example.test', {
      method: 'POST',
      body: JSON.stringify({ method: 'getBlockNumber', params: [] }),
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(timeoutRpc.getCallCount('getBlockNumber')).toBe(1)
  })
})
