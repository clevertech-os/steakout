/**
 * Client-side pending intent recovery across reloads (P1-12).
 * Server is still the source of truth; this only stores enough to resume
 * confirm polling after a provider return was obtained.
 */

const STORAGE_KEY = 'steakout_pending_staking_intent'

export interface PendingStakingIntent {
  intentId: string
  txHash: string
  expiresAt: string
  /** Validator involved (for resume UI context). */
  validatorAddress: string | null
  operation: string
  createdAt: string
  /** Raw provider return when it was not a 64-hex hash (debug). */
  rawProviderReturn?: string
}

export function savePendingIntent(record: PendingStakingIntent): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Private mode / quota — recovery will not work; flow still continues.
  }
}

export function loadPendingIntent(): PendingStakingIntent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingStakingIntent
    if (
      !parsed ||
      typeof parsed.intentId !== 'string' ||
      typeof parsed.txHash !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null
    }
    // Drop expired client copies; server would reject anyway.
    const exp = Date.parse(parsed.expiresAt)
    if (Number.isFinite(exp) && exp < Date.now()) {
      clearPendingIntent()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearPendingIntent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
