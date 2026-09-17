import { isIP } from 'node:net'

export const FAVICON_CACHE_TTL_MS = 24 * 60 * 60_000
export const FAVICON_STALE_MS = 60 * 60_000
const FAVICON_FETCH_TIMEOUT_MS = 5_000
const FAVICON_MAX_BYTES = 256 * 1024

type FaviconEntry = {
  body: Buffer | null
  contentType: string | null
  expiresAt: number
  staleUntil: number
}

export type FaviconLookup = {
  body: Buffer | null
  contentType: string | null
  cache: 'HIT' | 'STALE' | 'MISS'
}

export type FaviconFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface FaviconOptions {
  fetcher?: FaviconFetch
  nowMs?: () => number
  ttlMs?: number
  staleMs?: number
}

const cache = new Map<string, FaviconEntry>()
const inflight = new Map<string, Promise<FaviconEntry>>()

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '0.0.0.0'
    || host === '::'
    || host === '::1'
  ) {
    return true
  }

  const version = isIP(host)
  if (version === 4) {
    const octets = host.split('.').map(Number)
    const [first, second] = octets
    return first === 10
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 100 && second >= 64 && second <= 127)
  }
  if (version === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8')
  }
  return false
}

/** Registry websites are external input, so only public HTTP(S) origins are fetched. */
export function safeFaviconSource(website: string | null | undefined): URL | null {
  if (typeof website !== 'string' || website.trim() === '') return null
  try {
    const url = new URL(website.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || isPrivateHostname(url.hostname)) return null
    return new URL('/favicon.ico', url)
  } catch {
    return null
  }
}

function imageContentType(value: string | null): string | null {
  if (!value) return null
  const contentType = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (contentType.startsWith('image/')) return contentType
  if (contentType === 'application/octet-stream' || contentType === 'application/vnd.microsoft.icon') {
    return contentType
  }
  return null
}

function emptyEntry(nowMs: number, ttlMs: number, staleMs: number): FaviconEntry {
  return {
    body: null,
    contentType: null,
    expiresAt: nowMs + ttlMs,
    staleUntil: nowMs + ttlMs + staleMs,
  }
}

async function fetchFavicon(
  source: URL,
  options: Required<Pick<FaviconOptions, 'fetcher' | 'nowMs' | 'ttlMs' | 'staleMs'>>,
): Promise<FaviconEntry> {
  const nowMs = options.nowMs()
  const fallback = emptyEntry(nowMs, options.ttlMs, options.staleMs)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS)

  try {
    const response = await options.fetcher(source, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/svg+xml,image/x-icon,image/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    const finalSource = safeFaviconSource(response.url || source.href)
    const contentType = imageContentType(response.headers.get('content-type'))
    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (!response.ok || !finalSource || !contentType || declaredLength > FAVICON_MAX_BYTES) {
      return fallback
    }

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0 || body.length > FAVICON_MAX_BYTES) return fallback
    return {
      body,
      contentType,
      expiresAt: nowMs + options.ttlMs,
      staleUntil: nowMs + options.ttlMs + options.staleMs,
    }
  } catch {
    return fallback
  } finally {
    clearTimeout(timeout)
  }
}

async function refresh(source: URL, key: string, options: FaviconOptions): Promise<FaviconEntry> {
  const existing = inflight.get(key)
  if (existing) return existing

  const previous = cache.get(key)

  const resolved: Required<Pick<FaviconOptions, 'fetcher' | 'nowMs' | 'ttlMs' | 'staleMs'>> = {
    fetcher: options.fetcher ?? fetch,
    nowMs: options.nowMs ?? Date.now,
    ttlMs: options.ttlMs ?? FAVICON_CACHE_TTL_MS,
    staleMs: options.staleMs ?? FAVICON_STALE_MS,
  }
  const request = fetchFavicon(source, resolved)
  inflight.set(key, request)
  try {
    const entry = await request
    // Keep a usable last-good icon when a scheduled refresh fails. Give it a
    // short retry window rather than extending the full 24-hour fresh period.
    const stored = entry.body || !previous?.body
      ? entry
      : {
          ...previous,
          expiresAt: resolved.nowMs() + resolved.staleMs,
          staleUntil: resolved.nowMs() + resolved.staleMs,
        }
    cache.set(key, stored)
    return stored
  } finally {
    inflight.delete(key)
  }
}

/**
 * Resolve a validator favicon with a 24-hour fresh cache and a one-hour
 * last-good window. Expired last-good entries are served while refreshing.
 */
export async function getFavicon(
  website: string | null | undefined,
  options: FaviconOptions = {},
): Promise<FaviconLookup> {
  const source = safeFaviconSource(website)
  if (!source) return { body: null, contentType: null, cache: 'MISS' }

  const nowMs = options.nowMs ?? Date.now
  const key = source.href
  const entry = cache.get(key)
  if (entry && entry.expiresAt > nowMs()) {
    return { body: entry.body, contentType: entry.contentType, cache: 'HIT' }
  }

  if (entry && entry.staleUntil > nowMs()) {
    void refresh(source, key, options)
    return { body: entry.body, contentType: entry.contentType, cache: 'STALE' }
  }

  const refreshed = await refresh(source, key, options)
  return { body: refreshed.body, contentType: refreshed.contentType, cache: 'MISS' }
}

export function clearFaviconCache(): void {
  cache.clear()
  inflight.clear()
}
