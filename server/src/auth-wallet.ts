/**
 * Public-key → Nimiq address binding for wallet auth.
 * Ported from VeriLock `server/src/auth-wallet.ts` (P1-02).
 * A client-supplied address alone is never identity — the signing key must match.
 */

import { PublicKey } from '@nimiq/core'
import { normalizeAddress } from './addresses.js'

export function addressFromPublicKeyHex(publicKeyHex: string): string {
  const key = PublicKey.fromHex(publicKeyHex)
  return normalizeAddress(key.toAddress().toUserFriendlyAddress())
}

/** Ensures the signing key belongs to the wallet address challenged at login. */
export function assertPublicKeyMatchesAddress(publicKeyHex: string, expectedAddress: string): void {
  const derived = addressFromPublicKeyHex(publicKeyHex)
  if (derived !== normalizeAddress(expectedAddress)) {
    throw new Error('Public key does not match the wallet address for this session')
  }
}

export type PublicKeyBindingResult = 'match' | 'mismatch' | 'invalid'

export function publicKeyBindingResult(
  publicKeyHex: string,
  expectedAddress: string,
): PublicKeyBindingResult {
  try {
    const derived = addressFromPublicKeyHex(publicKeyHex)
    return derived === normalizeAddress(expectedAddress) ? 'match' : 'mismatch'
  } catch {
    return 'invalid'
  }
}
