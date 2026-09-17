import { isIP } from 'node:net'

export const FAVICON_CACHE_TTL_MS = 24 * 60 * 60_000
export const FAVICON_STALE_MS = 60 * 60_000
const FAVICON_FETCH_TIMEOUT_MS = 5_000
const FAVICON_MAX_BYTES = 256 * 1024
const FAVICON_DECLARED_MAX_BYTES = 512 * 1024
const FAVICON_HTML_MAX_BYTES = 512 * 1024

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
function safeHttpSource(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || isPrivateHostname(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

export function safeFaviconSource(website: string | null | undefined): URL | null {
  if (typeof website !== 'string' || website.trim() === '') return null
  const source = safeHttpSource(website.trim())
  return source ? new URL('/favicon.ico', source) : null
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

type ResolvedFaviconOptions = Required<Pick<FaviconOptions, 'fetcher' | 'nowMs' | 'ttlMs' | 'staleMs'>>

async function fetchImage(
  source: URL,
  options: ResolvedFaviconOptions,
  maxBytes = FAVICON_MAX_BYTES,
): Promise<FaviconEntry | null> {
  const nowMs = options.nowMs()
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
    const finalSource = safeHttpSource(response.url || source.href)
    const contentType = imageContentType(response.headers.get('content-type'))
    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (!response.ok || !finalSource || !contentType || declaredLength > maxBytes) {
      return null
    }

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0 || body.length > maxBytes) return null
    return {
      body,
      contentType,
      expiresAt: nowMs + options.ttlMs,
      staleUntil: nowMs + options.ttlMs + options.staleMs,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function readHtmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'))
  return match?.[2]?.trim() || null
}

function declaredIconSources(html: string, website: URL): URL[] {
  const sources: URL[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = readHtmlAttribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? []
    if (!rel.includes('icon') && !rel.includes('shortcut') && !rel.includes('apple-touch-icon')) {
      continue
    }
    const href = readHtmlAttribute(tag, 'href')?.replace(/&amp;/gi, '&')
    if (!href) continue
    try {
      const source = safeHttpSource(new URL(href, website).href)
      if (source && !sources.some((item) => item.href === source.href)) sources.push(source)
    } catch {
      // Ignore malformed declarations and continue to the next link.
    }
  }
  return sources
}

async function discoverDeclaredIcon(
  website: URL,
  options: ResolvedFaviconOptions,
): Promise<FaviconEntry | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS)
  try {
    const response = await options.fetcher(website, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (!response.ok || (!contentType.includes('text/html') && !contentType.includes('application/xhtml'))
      || declaredLength > FAVICON_HTML_MAX_BYTES) {
      return null
    }
    const htmlBody = Buffer.from(await response.arrayBuffer())
    if (htmlBody.length === 0 || htmlBody.length > FAVICON_HTML_MAX_BYTES) return null
    const finalWebsite = safeHttpSource(response.url || website.href)
    if (!finalWebsite) return null
    for (const source of declaredIconSources(htmlBody.toString('utf8'), finalWebsite)) {
      const icon = await fetchImage(source, options, FAVICON_DECLARED_MAX_BYTES)
      if (icon) return icon
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchFavicon(
  source: URL,
  website: URL,
  options: ResolvedFaviconOptions,
): Promise<FaviconEntry> {
  const nowMs = options.nowMs()
  const direct = await fetchImage(source, options)
  const declared = direct ? null : await discoverDeclaredIcon(website, options)
  const icon = direct ?? declared
  if (icon) return icon
  return emptyEntry(nowMs, options.ttlMs, options.staleMs)
}

async function refresh(source: URL, website: URL, key: string, options: FaviconOptions): Promise<FaviconEntry> {
  const existing = inflight.get(key)
  if (existing) return existing

  const previous = cache.get(key)

  const resolved: ResolvedFaviconOptions = {
    fetcher: options.fetcher ?? fetch,
    nowMs: options.nowMs ?? Date.now,
    ttlMs: options.ttlMs ?? FAVICON_CACHE_TTL_MS,
    staleMs: options.staleMs ?? FAVICON_STALE_MS,
  }
  const request = fetchFavicon(source, website, resolved)
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
  const websiteSource = typeof website === 'string' ? safeHttpSource(website.trim()) : null
  if (!source || !websiteSource) return { body: null, contentType: null, cache: 'MISS' }

  const nowMs = options.nowMs ?? Date.now
  const key = source.href
  const entry = cache.get(key)
  if (entry && entry.expiresAt > nowMs()) {
    return { body: entry.body, contentType: entry.contentType, cache: 'HIT' }
  }

  if (entry && entry.staleUntil > nowMs()) {
    void refresh(source, websiteSource, key, options)
    return { body: entry.body, contentType: entry.contentType, cache: 'STALE' }
  }

  const refreshed = await refresh(source, websiteSource, key, options)
  return { body: refreshed.body, contentType: refreshed.contentType, cache: 'MISS' }
}

export function clearFaviconCache(): void {
  cache.clear()
  inflight.clear()
}
