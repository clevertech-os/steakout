/**
 * Derive a 64-hex transaction hash from a provider-returned serialized tx.
 *
 * Package types for `@nimiq/mini-app-sdk` document sendBasicTransaction as
 * returning "The serialized transaction". Staking methods share the same
 * `Promise<string | ErrorResponse>` shape without an explicit @returns, so
 * the provisional hypothesis (P0-03) is that success strings are serialized
 * txs. Device evidence must confirm before treating as proven.
 *
 * Uses `@nimiq/core` Transaction.fromAny — never treat a raw slice as a hash.
 */

import { Transaction } from '@nimiq/core'
import { normalizeTxHash } from './nimiq-rpc.js'

const TX_HASH_HEX = /^[0-9a-fA-F]{64}$/

/**
 * If `value` is already a 64-hex hash (optional 0x), return lowercased hash.
 * If it looks like hex of any other length, try Transaction.fromAny + hash().
 * On failure, return null (caller rejects or keeps raw).
 */
export function tryDeriveTxHash(value: string): {
  hash: string
  source: 'hash' | 'serialized'
} | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const withoutPrefix = trimmed.replace(/^0x/i, '')
  if (TX_HASH_HEX.test(withoutPrefix)) {
    return { hash: normalizeTxHash(withoutPrefix), source: 'hash' }
  }

  // Serialized txs are hex; skip non-hex early.
  if (!/^[0-9a-fA-F]+$/.test(withoutPrefix) || withoutPrefix.length % 2 !== 0) {
    return null
  }

  try {
    const tx = Transaction.fromAny(withoutPrefix)
    const hash = normalizeTxHash(tx.hash())
    if (!TX_HASH_HEX.test(hash)) return null
    return { hash, source: 'serialized' }
  } catch {
    return null
  }
}
