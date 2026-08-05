/**
 * P2-13 — Light in-process response cache for public GET endpoints.
 *
 * Stable keys: path + sorted query (no watermark). Short fresh TTL (default 45s)
 * plus a longer last-good stale window so watermark advances / TTL expiry never
 * force a cold recompute on the request path (stale-while-revalidate).
 *
 * Prefer `lookupPublicResponse` + `schedulePublicRevalidate` for public GETs.
 * `buildPublicCacheKey(..., watermark)` remains for callers that still embed
 * watermark in the key (legacy); new code should use stable keys.
 */

export const PUBLIC_RESPONSE_CACHE_TTL_MS = 45_000
/** How long a last-good body may be served after fresh TTL expires. */
export const PUBLIC_RESPONSE_STALE_MS = 60 * 60_000
export const PUBLIC_CACHE_CONTROL = `public, max-age=${Math.floor(PUBLIC_RESPONSE_CACHE_TTL_MS / 1000)}`

interface CacheEntry {
  body: unknown
  status: number
  /** Fresh until this timestamp (HIT). */
  expiresAt: number
  /** Last-good until this timestamp (STALE serve + background revalidate). */
  staleUntil: number
  watermark: string | null
}

export type PublicCacheLookup =
  | {
      kind: 'fresh'
      body: unknown
      status: number
      watermark: string | null
    }
  | {
      kind: 'stale'
      body: unknown
      status: number
      watermark: string | null
    }
  | { kind: 'miss' }

const store = new Map<string, CacheEntry>()
/** Deduped background revalidations keyed by stable cache key. */
const revalidateInflight = new Map<string, Promise<void>>()

let hits = 0
let misses = 0
let staleServes = 0

/**
 * Stable cache key for a public GET (path + sorted query only).
 * Use this for SWR so watermark advances do not drop last-good bodies.
 */
export function buildPublicCacheStableKey(
  path: string,
  query: Record<string, unknown> | URLSearchParams | string = {},
): string {
  const qs = normalizeQuery(query)
  return qs ? `${path}?${qs}` : path
}

/**
 * Cache key that includes watermark (legacy invalidation dimension).
 * Prefer `buildPublicCacheStableKey` + stored entry.watermark for new code.
 */
export function buildPublicCacheKey(
  path: string,
  query: Record<string, unknown> | URLSearchParams | string,
  watermark: string | null,
): string {
  const stable = buildPublicCacheStableKey(path, query)
  const wm = watermark ?? 'none'
  return `${stable}#wm=${wm}`
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

/**
 * Fresh-only lookup (legacy). Stale last-good entries are not returned so
 * callers that only understand HIT/MISS keep re-fetching after TTL.
 * Prefer `lookupPublicResponse` for SWR endpoints.
 */
export function getCachedPublicResponse(
  key: string,
  nowMs: number = Date.now(),
): { body: unknown; status: number } | null {
  const lookup = lookupPublicResponse(key, nowMs)
  if (lookup.kind === 'fresh') {
    return { body: lookup.body, status: lookup.status }
  }
  // Stale was already counted as staleServes; treat as miss for legacy stats.
  if (lookup.kind === 'stale') {
    misses += 1
  }
  return null
}

/**
 * Stale-while-revalidate lookup.
 * - fresh: within TTL
 * - stale: past TTL but within last-good window (caller should revalidate async)
 * - miss: nothing usable
 */
export function lookupPublicResponse(
  key: string,
  nowMs: number = Date.now(),
): PublicCacheLookup {
  const entry = store.get(key)
  if (!entry) {
    misses += 1
    return { kind: 'miss' }
  }
  if (entry.expiresAt > nowMs) {
    hits += 1
    return {
      kind: 'fresh',
      body: entry.body,
      status: entry.status,
      watermark: entry.watermark,
    }
  }
  if (entry.staleUntil > nowMs) {
    staleServes += 1
    return {
      kind: 'stale',
      body: entry.body,
      status: entry.status,
      watermark: entry.watermark,
    }
  }
  store.delete(key)
  misses += 1
  return { kind: 'miss' }
}

export function setCachedPublicResponse(
  key: string,
  body: unknown,
  options: {
    status?: number
    watermark?: string | null
    ttlMs?: number
    /** How long past TTL to keep last-good. Defaults to PUBLIC_RESPONSE_STALE_MS. */
    staleMs?: number
    nowMs?: number
  } = {},
): void {
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? PUBLIC_RESPONSE_CACHE_TTL_MS
  const staleMs = options.staleMs ?? PUBLIC_RESPONSE_STALE_MS
  store.set(key, {
    body,
    status: options.status ?? 200,
    expiresAt: nowMs + ttlMs,
    staleUntil: nowMs + ttlMs + staleMs,
    watermark: options.watermark ?? null,
  })
  // Soft bound so a long-lived process cannot grow without limit.
  if (store.size > 500) {
    evictExpired(nowMs)
    if (store.size > 500) {
      const entries = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      const drop = Math.ceil(entries.length / 2)
      for (let i = 0; i < drop; i += 1) {
        store.delete(entries[i]![0])
      }
    }
  }
}

/**
 * Fire-and-forget revalidate. Concurrent callers share one in-flight loader
 * per key. Errors are swallowed so background work never rejects unhandled.
 */
export function schedulePublicRevalidate(
  key: string,
  loader: () => unknown | Promise<unknown>,
  options: {
    status?: number
    watermark?: string | null
    ttlMs?: number
    staleMs?: number
  } = {},
): void {
  if (revalidateInflight.has(key)) return
  const promise = (async () => {
    try {
      const body = await loader()
      setCachedPublicResponse(key, body, options)
    } catch {
      // Keep last-good; next request may try again.
    } finally {
      revalidateInflight.delete(key)
    }
  })()
  revalidateInflight.set(key, promise)
}

/** True when a revalidate is already running for this key (tests / diagnostics). */
export function isPublicRevalidateInflight(key: string): boolean {
  return revalidateInflight.has(key)
}

/**
 * When serving a last-good body past fresh TTL, mark envelope status `stale`
 * if it was still `ok` so clients show honest freshness (API.md §1).
 * Does not mutate the cached object.
 */
export function markEnvelopeStaleForServe(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return body
  }
  const record = body as Record<string, unknown>
  if (record.status === 'ok') {
    return { ...record, status: 'stale' }
  }
  return body
}

function evictExpired(nowMs: number): void {
  for (const [key, entry] of store) {
    if (entry.staleUntil <= nowMs) store.delete(key)
  }
}

/** Test helper: clear entries, counters, and inflight revalidates. */
export function clearPublicResponseCache(): void {
  store.clear()
  revalidateInflight.clear()
  hits = 0
  misses = 0
  staleServes = 0
}

export function publicResponseCacheStats(): {
  size: number
  hits: number
  misses: number
  staleServes: number
  ttlMs: number
  staleMs: number
} {
  return {
    size: store.size,
    hits,
    misses,
    staleServes,
    ttlMs: PUBLIC_RESPONSE_CACHE_TTL_MS,
    staleMs: PUBLIC_RESPONSE_STALE_MS,
  }
}
