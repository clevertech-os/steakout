/**
 * Map fetch/API failures to calm, methodology-safe user copy (P3-09).
 * Prefer neutral phrasing; never imply validator wrongdoing.
 */

import { ApiError } from '../api/http'

/** True when the browser reports offline (best-effort). */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Human sentence for a thrown error from a public or authenticated fetch.
 * Falls back to a surface-specific default when the error has no useful message.
 */
export function humanizeFetchError(err: unknown, fallback: string): string {
  if (isBrowserOffline()) {
    return 'You appear to be offline. Reconnect to load the latest data.'
  }

  if (err instanceof ApiError) {
    switch (err.code) {
      case 'RPC_UNAVAILABLE':
        return 'Network data is temporarily unavailable. Try again in a moment.'
      case 'WALLET_NOT_CONNECTED':
        return 'Session expired or not established. Connect again to verify your wallet.'
      case 'RATE_LIMITED': {
        const wait = err.retryAfterSeconds
        return wait
          ? `Too many requests. Try again in about ${wait}s.`
          : 'Too many requests. Try again shortly.'
      }
      case 'VALIDATOR_NOT_FOUND':
        return 'No registry record for this address.'
      default:
        if (err.message?.trim()) return err.message.trim()
        return fallback
    }
  }

  if (err instanceof TypeError) {
    // Typical failed fetch / network disconnect
    return 'Could not reach Steakout. Check your connection and try again.'
  }

  if (err instanceof Error && err.message.trim()) {
    const msg = err.message.trim()
    // Avoid raw "Failed to fetch" noise
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return 'Could not reach Steakout. Check your connection and try again.'
    }
    return msg
  }

  return fallback
}
