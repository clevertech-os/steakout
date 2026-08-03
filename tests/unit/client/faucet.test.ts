import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestTestnetFaucet } from '../../../client/src/api/faucet.ts'

describe('requestTestnetFaucet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects invalid addresses before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestTestnetFaucet('not-an-address')).rejects.toThrow(/valid Nimiq address/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts form body and returns success payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          success: true,
          msg: 'Your NIM are on its way!',
          expectedBlocks: 1,
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestTestnetFaucet('NQ0700000000000000000000000000000000')
    expect(result.success).toBe(true)
    expect(result.expectedBlocks).toBe(1)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('faucet.pos.nimiq-testnet.com')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toContain('address=')
  })

  it('throws when faucet reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ success: false, msg: 'Rate limited' }),
      }),
    )
    await expect(requestTestnetFaucet('NQ0700000000000000000000000000000000')).rejects.toThrow(
      /Rate limited/,
    )
  })
})
