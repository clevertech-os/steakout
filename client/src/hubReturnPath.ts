/**
 * Persist Hub / Pay return paths across redirects and mini-app opens.
 * Ported from VeriLock `client/src/hubReturnPath.ts` (P1-01); app-specific paths simplified for Steakout routes.
 */

const HUB_RETURN_PATH_KEY = 'steakout-hub-return-path'
/**
 * Survives leaving Safari/Chrome into the Nimiq Pay app WebView (sessionStorage
 * does not). Used when `nimiqpay://miniapp?url=` only loads the site origin.
 */
const PAY_RETURN_PATH_KEY = 'steakout-pay-return-path'

export function saveHubReturnPath(): void {
  if (typeof window === 'undefined') return
  // Include hash when present (Steakout SPA uses hash routing).
  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`
  try {
    sessionStorage.setItem(HUB_RETURN_PATH_KEY, path)
  } catch {
    // ignore
  }
}

export function readHubReturnPath(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(HUB_RETURN_PATH_KEY)
  } catch {
    return null
  }
}

export function consumeHubReturnPath(): string | null {
  const path = readHubReturnPath()
  if (!path) return null
  try {
    sessionStorage.removeItem(HUB_RETURN_PATH_KEY)
  } catch {
    // ignore
  }
  return path
}

/** Path+query+hash for post–Nimiq Pay restore. */
export function savePayReturnPath(path?: string): void {
  if (typeof window === 'undefined') return
  const next =
    path ?? `${window.location.pathname}${window.location.search}${window.location.hash}`
  // Never stash bare home — nothing useful to restore.
  if (!next || next === '/' || next === '') return
  try {
    localStorage.setItem(PAY_RETURN_PATH_KEY, next)
  } catch {
    // ignore
  }
}

export function readPayReturnPath(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(PAY_RETURN_PATH_KEY)
  } catch {
    return null
  }
}

export function clearPayReturnPath(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PAY_RETURN_PATH_KEY)
  } catch {
    // ignore
  }
}

export function consumePayReturnPath(): string | null {
  const path = readPayReturnPath()
  if (!path) return null
  clearPayReturnPath()
  return path
}

/**
 * Steakout app routes that are safe to restore after a Pay handoff.
 * Hash-router paths live in `location.hash` (e.g. `/#/validators`).
 */
function isRestorableAppPath(path: string): boolean {
  const pathOnly = path.split(/[?#]/)[0] ?? path
  if (pathOnly === '/' || pathOnly === '') return true
  if (pathOnly === '/spike' || pathOnly.startsWith('/spike/')) return true
  // Hash SPA destinations appear as `/` + `#/validators` etc. — treat any `#/` as ok.
  if (path.includes('#/')) return true
  return false
}

/**
 * If Nimiq Pay (or a cold open) landed on `/` but we had a deep link pending,
 * restore it before React routes the shell.
 */
export function restorePayReturnPathIfNeeded(): string | null {
  if (typeof window === 'undefined') return null
  const pending = readPayReturnPath()
  if (!pending) return null

  let path = pending
  try {
    if (/^https?:\/\//i.test(pending)) {
      const u = new URL(pending)
      path = `${u.pathname}${u.search}${u.hash}`
    }
  } catch {
    /* keep raw */
  }

  if (!path.startsWith('/')) {
    clearPayReturnPath()
    return null
  }

  if (!isRestorableAppPath(path)) {
    clearPayReturnPath()
    return null
  }

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  // Already on a meaningful destination — drop stale pending.
  if (current !== '/' && current !== '' && current !== '/#/' && current !== '/#') {
    clearPayReturnPath()
    return null
  }

  // Home after Pay open: re-apply stashed path.
  clearPayReturnPath()
  window.history.replaceState(window.history.state, '', path)
  return path
}
