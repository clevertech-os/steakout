/**
 * Pay getNetwork() returns coin id "nimiq", not mainnet/testnet.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('assertProviderNetworkCompatibleWithApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('allows coin id "nimiq" on a testnet app build', async () => {
    vi.stubEnv('VITE_NIMIQ_NETWORK', 'testnet')
    const {
      assertProviderNetworkCompatibleWithApp,
      isNimiqCoinNetworkLabel,
    } = await import('../../../client/src/nimiq.ts')
    expect(isNimiqCoinNetworkLabel('nimiq')).toBe(true)
    expect(() => assertProviderNetworkCompatibleWithApp('nimiq')).not.toThrow()
    expect(() => assertProviderNetworkCompatibleWithApp('')).not.toThrow()
    expect(() => assertProviderNetworkCompatibleWithApp(null)).not.toThrow()
  })

  it('refuses explicit mainnet label on a testnet app build', async () => {
    vi.stubEnv('VITE_NIMIQ_NETWORK', 'testnet')
    const { assertProviderNetworkCompatibleWithApp } = await import(
      '../../../client/src/nimiq.ts'
    )
    expect(() => assertProviderNetworkCompatibleWithApp('mainnet')).toThrow(
      /testnet/i,
    )
  })

  it('refuses explicit testnet label on a mainnet app build', async () => {
    vi.stubEnv('VITE_NIMIQ_NETWORK', 'mainnet')
    const { assertProviderNetworkCompatibleWithApp } = await import(
      '../../../client/src/nimiq.ts'
    )
    expect(() => assertProviderNetworkCompatibleWithApp('testnet')).toThrow(
      /mainnet/i,
    )
    expect(() => assertProviderNetworkCompatibleWithApp('nimiq')).not.toThrow()
  })
})
