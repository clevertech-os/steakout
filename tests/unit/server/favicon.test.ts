import { afterEach, describe, expect, it } from 'vitest'
import {
  clearFaviconCache,
  FAVICON_CACHE_TTL_MS,
  getFavicon,
  safeFaviconSource,
} from '../../../server/src/favicon.js'

function imageResponse(body = 'icon'): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/x-icon',
    },
  })
}

describe('favicon cache', () => {
  afterEach(() => clearFaviconCache())

  it('accepts public HTTP(S) websites and resolves their conventional favicon URL', () => {
    expect(safeFaviconSource('https://pool.example/path')).toEqual(
      new URL('https://pool.example/favicon.ico'),
    )
    expect(safeFaviconSource('javascript:alert(1)')).toBeNull()
    expect(safeFaviconSource('http://127.0.0.1:8080')).toBeNull()
    expect(safeFaviconSource('http://localhost:8080')).toBeNull()
  })

  it('serves a cached icon until the 24-hour TTL expires', async () => {
    let nowMs = 1_000
    let fetches = 0
    const fetcher = async (): Promise<Response> => {
      fetches += 1
      return imageResponse()
    }

    const first = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs,
      staleMs: 0,
    })
    expect(first.cache).toBe('MISS')
    expect(fetches).toBe(1)

    const hit = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs + FAVICON_CACHE_TTL_MS - 1,
      staleMs: 0,
    })
    expect(hit.cache).toBe('HIT')
    expect(fetches).toBe(1)

    nowMs += FAVICON_CACHE_TTL_MS
    const refreshed = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs,
      staleMs: 0,
    })
    expect(refreshed.cache).toBe('MISS')
    expect(fetches).toBe(2)
    expect(refreshed.contentType).toBe('image/x-icon')
  })

  it('serves the last icon while a stale entry refreshes', async () => {
    let nowMs = 1_000
    let fetches = 0
    let resolveRefresh: (() => void) | null = null
    const fetcher = async (): Promise<Response> => {
      fetches += 1
      if (fetches === 2) await new Promise<void>((resolve) => { resolveRefresh = resolve })
      return imageResponse()
    }

    const first = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs,
      ttlMs: 100,
      staleMs: 100,
    })
    expect(first.body).not.toBeNull()

    nowMs = 1_150
    const stale = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs,
      ttlMs: 100,
      staleMs: 100,
    })
    expect(stale.cache).toBe('STALE')
    expect(stale.body).not.toBeNull()
    expect(fetches).toBe(2)

    resolveRefresh?.()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })

  it('keeps the last icon when a refresh fails', async () => {
    let nowMs = 1_000
    let fetches = 0
    const fetcher = async (): Promise<Response> => {
      fetches += 1
      return fetches === 1
        ? imageResponse()
        : new Response('unavailable', { status: 503 })
    }

    const first = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs,
      ttlMs: 100,
      staleMs: 100,
    })
    nowMs = 1_150
    const stale = await getFavicon('https://pool.example', {
      fetcher,
      nowMs: () => nowMs,
      ttlMs: 100,
      staleMs: 100,
    })
    expect(first.body).not.toBeNull()
    expect(stale.body).toEqual(first.body)
    expect(fetches).toBe(2)
  })

  it('caches unavailable icons as a negative result for the TTL', async () => {
    let fetches = 0
    const fetcher = async (): Promise<Response> => {
      fetches += 1
      return new Response('<html>not an icon</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }

    const first = await getFavicon('https://pool.example', { fetcher, ttlMs: 100 })
    const second = await getFavicon('https://pool.example', { fetcher, ttlMs: 100 })
    expect(first.body).toBeNull()
    expect(second.body).toBeNull()
    expect(fetches).toBe(2)
  })

  it('discovers a declared icon when the conventional favicon is unavailable', async () => {
    const requests: string[] = []
    const fetcher = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/favicon.ico')) return new Response('missing', { status: 404 })
      if (url === 'https://pool.example' || url === 'https://pool.example/') {
        return new Response('<link rel="icon" type="image/png" href="/brand.png">', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response('declared icon', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }

    const result = await getFavicon('https://pool.example', { fetcher })
    expect(result.body).not.toBeNull()
    expect(result.contentType).toBe('image/png')
    expect(requests).toEqual([
      'https://pool.example/favicon.ico',
      'https://pool.example/',
      'https://pool.example/brand.png',
    ])
  })
})
