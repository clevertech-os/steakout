/**
 * Address normalize helpers (server-side).
 * Ported from VeriLock `server/src/addresses.ts` (P1-01).
 * Keep in sync with `client/src/addresses.ts`.
 */

export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Lightweight Nimiq basic-address shape check (NQ + 34 alphanumerics).
 * Does not verify checksum — enough to reject typos at the API boundary.
 */
export function isValidNimiqAddress(address: string | null | undefined): boolean {
  if (address == null || !String(address).trim()) return false
  const clean = normalizeAddress(address)
  return /^NQ[0-9A-Z]{34}$/.test(clean)
}

export function shortAddress(address: string): string {
  const clean = normalizeAddress(address)
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`
}

/** Normalize both sides, then compare. Prefer this over `===` on raw strings. */
export function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false
  if (!isValidNimiqAddress(a) || !isValidNimiqAddress(b)) return false
  return normalizeAddress(a) === normalizeAddress(b)
}
