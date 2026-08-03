/**
 * Client session persistence (sessionStorage).
 * Ported from VeriLock `client/src/session.ts` (P1-01).
 * Non-custodial: stores only session token + address — never keys or seeds.
 */

const SESSION_KEY = 'steakout-session'

export interface StoredSession {
  /** Present after P1-02 auth verify; may be absent for address-only wallet connect. */
  token?: string
  address: string
}

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // sessionStorage may be unavailable in some WebViews
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed.address || typeof parsed.address !== 'string') return null
    if (parsed.token != null && typeof parsed.token !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}
