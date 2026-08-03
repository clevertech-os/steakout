/**
 * Desktop browser ↔ Nimiq Pay phone session handoff.
 * Desktop creates a pair + QR; phone (signed in) approves; desktop claims cookie.
 */

import { apiGet, apiPost } from './http'

export type DesktopPairStatus = 'waiting' | 'approved' | 'claimed' | 'expired'

export async function createDesktopPair(): Promise<{ pairId: string; expiresAt: string }> {
  return apiPost<{ pairId: string; expiresAt: string }>('/api/auth/desktop-pair', {})
}

export async function getDesktopPairStatus(pairId: string): Promise<{
  pairId: string
  status: DesktopPairStatus
  address: string | null
  expiresAt: string
}> {
  return apiGet(`/api/auth/desktop-pair/${encodeURIComponent(pairId)}`)
}

export async function approveDesktopPair(pairId: string): Promise<{
  pairId: string
  status: string
  address: string
  message: string
}> {
  return apiPost('/api/auth/desktop-pair/approve', { pairId })
}

export async function claimDesktopPair(pairId: string): Promise<{
  address: string
  sessionExpiresAt: string
}> {
  return apiPost('/api/auth/desktop-pair/claim', { pairId })
}

/** Read pair id from ?desktopPair= or hash query. */
export function readDesktopPairIdFromLocation(
  search = typeof window !== 'undefined' ? window.location.search : '',
  hash = typeof window !== 'undefined' ? window.location.hash : '',
): string | null {
  try {
    const fromSearch = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(
      'desktopPair',
    )
    if (fromSearch?.trim()) return fromSearch.trim()
  } catch {
    /* ignore */
  }
  try {
    const raw = hash.replace(/^#/, '')
    const qIndex = raw.indexOf('?')
    if (qIndex < 0) return null
    const id = new URLSearchParams(raw.slice(qIndex + 1)).get('desktopPair')
    return id?.trim() || null
  } catch {
    return null
  }
}

/** Strip desktopPair from the address bar after handling (keeps path). */
export function clearDesktopPairFromLocation(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has('desktopPair')) {
      url.searchParams.delete('desktopPair')
      const next = `${url.pathname}${url.search}${url.hash}`
      history.replaceState(history.state, '', next || '/')
    }
    // Hash query: #/path?desktopPair=…
    const hash = window.location.hash
    if (hash.includes('desktopPair=')) {
      const raw = hash.replace(/^#/, '')
      const qIndex = raw.indexOf('?')
      if (qIndex >= 0) {
        const path = raw.slice(0, qIndex)
        const params = new URLSearchParams(raw.slice(qIndex + 1))
        params.delete('desktopPair')
        const q = params.toString()
        history.replaceState(history.state, '', `${url.pathname}${url.search}#${path}${q ? `?${q}` : ''}`)
      }
    }
  } catch {
    /* ignore */
  }
}
