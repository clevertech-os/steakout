import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPublicDataCache,
  CLIENT_PUBLIC_CACHE_TTL_MS,
  peekPublicCache,
  peekPublicCacheAnyAge,
  publicCacheKey,
  setPublicCache,
  withPublicCache,
} from '../../../client/src/validators/publicDataCache'

describe('publicDataCache', () => {
  afterEach(() => {
    clearPublicDataCache()
    vi.useRealTimers()
  })

  it('returns fresh memory hits and expires after TTL', () => {
    vi.useFakeTimers()
    const key = publicCacheKey(['t', '1'])
    setPublicCache(key, { ok: true }, CLIENT_PUBLIC_CACHE_TTL_MS, Date.now())
    expect(peekPublicCache(key)).toEqual({ ok: true })

    vi.advanceTimersByTime(CLIENT_PUBLIC_CACHE_TTL_MS + 1)
    expect(peekPublicCache(key)).toBeNull()
  })

  it('peekPublicCacheAnyAge still serves slightly stale entries', () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)
    const key = publicCacheKey(['t', 'stale'])
    setPublicCache(key, { n: 1 }, CLIENT_PUBLIC_CACHE_TTL_MS, now)

    vi.advanceTimersByTime(CLIENT_PUBLIC_CACHE_TTL_MS + 5_000)
    const any = peekPublicCacheAnyAge<{ n: number }>(key)
    expect(any).toEqual({ data: { n: 1 }, fresh: false })
  })

  it('dedupes concurrent withPublicCache loaders', async () => {
    const key = publicCacheKey(['t', 'dedupe'])
    let loads = 0
    const loader = async () => {
      loads += 1
      await new Promise((r) => setTimeout(r, 20))
      return { loads }
    }

    const [a, b] = await Promise.all([
      withPublicCache(key, loader),
      withPublicCache(key, loader),
    ])
    expect(a).toEqual({ loads: 1 })
    expect(b).toEqual({ loads: 1 })
    expect(loads).toBe(1)
  })

  it('force bypasses preferCache', async () => {
    const key = publicCacheKey(['t', 'force'])
    setPublicCache(key, { v: 1 })
    let loads = 0
    const out = await withPublicCache(
      key,
      async () => {
        loads += 1
        return { v: 2 }
      },
      { force: true },
    )
    expect(out).toEqual({ v: 2 })
    expect(loads).toBe(1)
    expect(peekPublicCache(key)).toEqual({ v: 2 })
  })
})
