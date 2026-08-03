/**
 * P2-13 — Light in-process response cache for public GET endpoints.
 *
 * Keys: path + sorted query + indexer watermark (MAX index_cursors.updated_at).
 * Short TTL (default 45s). When the watermark advances, keys miss automatically
 * (no explicit invalidation sweep required).
 */

export const PUBLIC_RESPONSE_CACHE_TTL_MS = 45_000
export const PUBLIC_CACHE_CONTROL = `public, max-age=${Math.floor(PUBLIC_RESPONSE_CACHE_TTL_MS / 1000)}`

interface CacheEntry {
  body: unknown
  status: number
  expiresAt: number
  watermark: string | null
}

const store = new Map<string, CacheEntry>()

let hits = 0
let misses = 0

/**
 * Stable cache key for a public GET. Query keys are sorted so equivalent
 * parameter sets collide. Watermark is the invalidation dimension.
 */
export function buildPublicCacheKey(
  path: string,
  query: Record<string, unknown> | URLSearchParams | string,
  watermark: string | null,
): string {
  const qs = normalizeQuery(query)
  const wm = watermark ?? 'none'
  return `${path}?${qs}#wm=${wm}`
}

function normalizeQuery(
  query: Record<string, unknown> | URLSearchParams | string,
): string {
  if (typeof query === 'string') {
    const trimmed = query.startsWith('?') ? query.slice(1) : query
    if (!trimmed) return ''
    const params = new URLSearchParams(trimmed)
    return sortSearchParams(params)
  }
  if (query instanceof URLSearchParams) {
    return sortSearchParams(query)
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) params.append(key, String(item))
      }
    } else {
      params.set(key, String(value))
    }
  }
  return sortSearchParams(params)
}

function sortSearchParams(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = []
  params.forEach((value, key) => {
    pairs.push([key, value])
  })
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

export function getCachedPublicResponse(
  key: string,
  nowMs: number = Date.now(),
): { body: unknown; status: number } | null {
  const entry = store.get(key)
  if (!entry) {
    misses += 1
    return null
  }
  if (entry.expiresAt <= nowMs) {
    store.delete(key)
    misses += 1
    return null
  }
  hits += 1
  return { body: entry.body, status: entry.status }
}

export function setCachedPublicResponse(
  key: string,
  body: unknown,
  options: {
    status?: number
    watermark?: string | null
    ttlMs?: number
    nowMs?: number
  } = {},
): void {
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? PUBLIC_RESPONSE_CACHE_TTL_MS
  store.set(key, {
    body,
    status: options.status ?? 200,
    expiresAt: nowMs + ttlMs,
    watermark: options.watermark ?? null,
  })
  // Soft bound so a long-lived process cannot grow without limit.
  if (store.size > 500) {
    evictExpired(nowMs)
    if (store.size > 500) {
      // Drop oldest half by expiry.
      const entries = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      const drop = Math.ceil(entries.length / 2)
      for (let i = 0; i < drop; i += 1) {
        store.delete(entries[i][0])
      }
    }
  }
}

function evictExpired(nowMs: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= nowMs) store.delete(key)
  }
}

/** Test helper: clear entries and counters. */
export function clearPublicResponseCache(): void {
  store.clear()
  hits = 0
  misses = 0
}

export function publicResponseCacheStats(): {
  size: number
  hits: number
  misses: number
  ttlMs: number
} {
  return {
    size: store.size,
    hits,
    misses,
    ttlMs: PUBLIC_RESPONSE_CACHE_TTL_MS,
  }
}
