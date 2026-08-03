import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBlockNumber } from '../../../server/src/nimiq-rpc.js'

describe('Nimiq RPC block probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests getBlockNumber and unwraps result.data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: { data: 12345, metadata: null }, id: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBlockNumber('https://rpc.example.test')).resolves.toBe(12345)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rpc.example.test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'getBlockNumber', params: [], id: 1 }),
      }),
    )
  })

  it('rejects malformed block responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: { data: '12345' }, id: 1 }),
    }))

    await expect(getBlockNumber('https://rpc.example.test')).rejects.toThrow('malformed')
  })
})
