import { afterEach, describe, expect, it, vi } from 'vitest'

// session.ts uses sessionStorage; provide a minimal in-memory stub for node vitest.
function installSessionStorage() {
  const store = new Map<string, string>()
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  }
  vi.stubGlobal('sessionStorage', sessionStorage)
  return store
}

describe('session persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('save/load/clear round-trip with token', async () => {
    installSessionStorage()
    const { saveSession, loadSession, clearSession } = await import('../../../client/src/session.ts')

    expect(loadSession()).toBeNull()
    saveSession({ token: 'tok-1', address: 'NQ0700000000000000000000000000000000' })
    expect(loadSession()).toEqual({
      token: 'tok-1',
      address: 'NQ0700000000000000000000000000000000',
    })
    clearSession()
    expect(loadSession()).toBeNull()
  })

  it('allows address-only session without token', async () => {
    installSessionStorage()
    const { saveSession, loadSession } = await import('../../../client/src/session.ts')

    saveSession({ address: 'NQ0700000000000000000000000000000000' })
    expect(loadSession()).toEqual({ address: 'NQ0700000000000000000000000000000000' })
  })

  it('rejects malformed payloads', async () => {
    const store = installSessionStorage()
    const { loadSession } = await import('../../../client/src/session.ts')
    store.set('steakout-session', JSON.stringify({ token: 'x' }))
    expect(loadSession()).toBeNull()
    store.set('steakout-session', 'not-json')
    expect(loadSession()).toBeNull()
  })
})
