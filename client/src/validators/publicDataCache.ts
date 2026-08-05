/**
 * Client-side cache for public validator GETs.
 * Aligns TTL with server `PUBLIC_RESPONSE_CACHE_TTL_MS` (45s).
 * Memory + optional sessionStorage so revisits within a tab session paint instantly.
 */

export const CLIENT_PUBLIC_CACHE_TTL_MS = 45_000

const STORAGE_PREFIX = 'steakout:pub:'
const STORAGE_VERSION = '1'

interface CacheRecord<T> {
  v: typeof STORAGE_VERSION
  expiresAt: number
  data: T
}

const memory = new Map<string, CacheRecord<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

function nowMs(): number {
  return Date.now()
}

export function publicCacheKey(parts: string[]): string {
  return parts.join('|')
}

function readSession<T>(key: string): CacheRecord<T> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheRecord<T>
    if (!parsed || parsed.v !== STORAGE_VERSION || typeof parsed.expiresAt !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeSession<T>(key: string, record: CacheRecord<T>): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(record))
  } catch {
    // Quota / private mode — memory cache still works.
  }
}

/** Synchronous peek: fresh memory, else fresh sessionStorage (hydrates memory). */
export function peekPublicCache<T>(key: string, now: number = nowMs()): T | null {
  const mem = memory.get(key) as CacheRecord<T> | undefined
  if (mem && mem.expiresAt > now) return mem.data
  if (mem) memory.delete(key)

  const sess = readSession<T>(key)
  if (sess && sess.expiresAt > now) {
    memory.set(key, sess)
    return sess.data
  }
  return null
}

/** Stale-or-fresh peek for SWR (may be expired). */
export function peekPublicCacheAnyAge<T>(
  key: string,
  maxStaleMs: number = CLIENT_PUBLIC_CACHE_TTL_MS * 4,
  now: number = nowMs(),
): { data: T; fresh: boolean } | null {
  const mem = memory.get(key) as CacheRecord<T> | undefined
  if (mem) {
    const fresh = mem.expiresAt > now
    if (fresh || mem.expiresAt + maxStaleMs > now) {
      return { data: mem.data, fresh }
    }
  }
  const sess = readSession<T>(key)
  if (sess) {
    const fresh = sess.expiresAt > now
    if (fresh || sess.expiresAt + maxStaleMs > now) {
      memory.set(key, sess)
      return { data: sess.data, fresh }
    }
  }
  return null
}

export function setPublicCache<T>(
  key: string,
  data: T,
  ttlMs: number = CLIENT_PUBLIC_CACHE_TTL_MS,
  now: number = nowMs(),
): void {
  const record: CacheRecord<T> = {
    v: STORAGE_VERSION,
    expiresAt: now + ttlMs,
    data,
  }
  memory.set(key, record as CacheRecord<unknown>)
  writeSession(key, record)
}

/**
 * Deduped fetch-or-return-cache. When `preferCache` is true and a fresh entry
 * exists, skips the network. Concurrent callers share one in-flight promise.
 */
export async function withPublicCache<T>(
  key: string,
  loader: () => Promise<T>,
  options: {
    force?: boolean
    preferCache?: boolean
    ttlMs?: number
  } = {},
): Promise<T> {
  const preferCache = options.preferCache !== false
  const force = options.force === true
  const ttlMs = options.ttlMs ?? CLIENT_PUBLIC_CACHE_TTL_MS

  if (!force && preferCache) {
    const hit = peekPublicCache<T>(key)
    if (hit !== null) return hit
  }

  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const promise = (async () => {
    const data = await loader()
    setPublicCache(key, data, ttlMs)
    return data
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

/** Test / HMR helper. */
export function clearPublicDataCache(): void {
  memory.clear()
  inflight.clear()
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k)
    }
    for (const k of keys) sessionStorage.removeItem(k)
  } catch {
    // ignore
  }
}
