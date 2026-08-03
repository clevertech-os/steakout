/**
 * Parse Hub redirect return payloads (hash / ?rpcId= + sessionStorage).
 * Ported from VeriLock `client/src/hubRedirectParse.ts` and redirect URL peek helpers (P1-01).
 */

/** Query param Hub uses when the redirect response is too large for the hash. */
export const RPC_ID_SEARCH_PARAM = 'rpcId'

const HUB_RPC_UINT8_ARRAY_TYPE = 0
const RPC_REQUESTS_KEY = 'rpcRequests'
const HUB_RESPONSE_KEY_PREFIX = 'response-'

export type RpcRedirectResponse = {
  id: number
  status: 'ok' | 'error'
  result: unknown
}

export type StoredRpcRequest = {
  command: string
  state: Record<string, unknown> | null
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function parseHubRpcJson<T>(raw: string): T {
  return JSON.parse(raw, (_key, value) => {
    if (
      value &&
      typeof value === 'object' &&
      '__' in value &&
      'v' in value &&
      (value as { __: number }).__ === HUB_RPC_UINT8_ARRAY_TYPE &&
      typeof (value as { v: unknown }).v === 'string'
    ) {
      return decodeBase64ToBytes((value as { v: string }).v)
    }
    return value
  }) as T
}

export function peekRedirectHash(): RpcRedirectResponse | null {
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  if (!fragment.has('id') || !fragment.has('status') || !fragment.has('result')) return null

  const id = Number.parseInt(fragment.get('id')!, 10)
  if (!Number.isFinite(id)) return null

  const status = fragment.get('status') === 'ok' ? 'ok' : 'error'
  try {
    const result = parseHubRpcJson(fragment.get('result')!)
    return { id, status, result }
  } catch {
    return null
  }
}

/** True when the URL still contains an unprocessed Hub redirect response in the hash. */
export function peekHubRedirectInUrl(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  return fragment.has('id') && fragment.has('status') && fragment.has('result')
}

export function consumeRedirectHash(): void {
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  if (!fragment.has('id') && !fragment.has('status') && !fragment.has('result')) return
  fragment.delete('id')
  fragment.delete('status')
  fragment.delete('result')
  url.hash = fragment.toString() ? `#${fragment.toString()}` : ''
  history.replaceState(history.state, '', url.href)
}

export function loadStoredRpcRequest(id: number): StoredRpcRequest | null {
  try {
    const raw = sessionStorage.getItem(RPC_REQUESTS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, [string, Record<string, unknown> | null]>
    const entry = parsed[id] ?? parsed[String(id)]
    if (!entry) return null
    return { command: entry[0], state: entry[1] }
  } catch {
    return null
  }
}

export function loadStoredRedirectResponse(rpcId: string): RpcRedirectResponse | null {
  try {
    const raw = sessionStorage.getItem(`response-${rpcId}`)
    if (!raw) return null
    const message = parseHubRpcJson<{
      data?: { id?: number; status?: string; result?: unknown }
    }>(raw)
    const id = message.data?.id
    if (typeof id !== 'number') return null
    const status = message.data?.status === 'ok' ? 'ok' : 'error'
    return { id, status, result: message.data?.result }
  } catch {
    return null
  }
}

export function clearRpcIdSearchParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(RPC_ID_SEARCH_PARAM)) return
  url.searchParams.delete(RPC_ID_SEARCH_PARAM)
  history.replaceState(history.state, '', url.href)
}

export function readRedirectResponse(): RpcRedirectResponse | null {
  let redirect = peekRedirectHash()
  if (!redirect) {
    const rpcId = new URLSearchParams(window.location.search).get(RPC_ID_SEARCH_PARAM)
    if (rpcId) redirect = loadStoredRedirectResponse(rpcId)
  }
  return redirect
}

/** Full page URL Hub should return to (path + query, no hash). */
export function getHubReturnUrl(): string {
  if (typeof window === 'undefined') return '/'
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}`
}

/**
 * True when the page is mid Hub redirect round-trip and rpcRequests must be preserved.
 * Rely on hash fragment or ?rpcId + stored rpcRequests state (not browser referrer).
 */
export function hasPendingHubRedirect(): boolean {
  if (typeof window === 'undefined') return false
  if (peekRedirectHash()) return true
  if (new URLSearchParams(window.location.search).has(RPC_ID_SEARCH_PARAM)) return true
  return false
}

/** Drop stale Hub RPC entries that cause "Invalid request" on the next connect. */
export function clearStaleHubRpcState(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(RPC_REQUESTS_KEY)
    const stale: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(HUB_RESPONSE_KEY_PREFIX)) stale.push(key)
    }
    for (const key of stale) sessionStorage.removeItem(key)
  } catch {
    // sessionStorage may be blocked in strict privacy modes
  }
}

/** Only clear Hub RPC storage when not returning from an in-flight redirect. */
export function clearStaleHubRpcStateIfIdle(): void {
  if (hasPendingHubRedirect()) return
  clearStaleHubRpcState()
}

/**
 * True when the URL still signals a Hub return (hash / `?rpcId=`) but
 * sessionStorage has no matching `rpcRequests` entry (or no stored response).
 * Those leftovers make `hasPendingHubRedirect()` forever true and block Login.
 */
export function isOrphanedHubRedirectReturn(): boolean {
  if (typeof window === 'undefined') return false
  if (!hasPendingHubRedirect()) return false
  const redirect = readRedirectResponse()
  if (!redirect) return true
  return !loadStoredRpcRequest(redirect.id)
}

/**
 * Strip orphaned Hub return URL params + RPC storage so Login can start fresh.
 * Returns true when something was cleared.
 */
export function clearOrphanedHubRedirectReturn(): boolean {
  if (!isOrphanedHubRedirectReturn()) return false
  consumeRedirectHash()
  clearRpcIdSearchParam()
  clearStaleHubRpcState()
  return true
}
