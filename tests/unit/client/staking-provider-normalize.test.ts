/**
 * P1-12 / P0-03 — provider return normalization for confirm polling.
 * Includes provisional serialized-tx → hash derivation via @nimiq/core.
 */

import { Address, KeyPair, PrivateKey, Transaction, TransactionBuilder } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  normalizeProviderTxResult,
  providerTxClassification,
} from '../../../client/src/nimiq.ts'

/** Build a signed basic tx; returns hex + expected hash (not a device fixture). */
function buildSignedBasicTxHex(): { hex: string; hash: string } {
  const keyPair = KeyPair.derive(PrivateKey.generate())
  const sender = keyPair.toAddress()
  const recipient = Address.fromString('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')
  // networkId 5 = testnet; only used for unit construction, not broadcast.
  const tx = TransactionBuilder.newBasic(sender, recipient, 100_000n, 0n, 1, 5)
  tx.sign(keyPair)
  const hex = tx.toHex()
  const hash = Transaction.fromAny(hex).hash().replace(/^0x/i, '').toLowerCase()
  return { hex, hash }
}

describe('normalizeProviderTxResult', () => {
  it('treats 64-hex as hash (lowercased, source hash)', () => {
    const hash = 'A'.repeat(64)
    const out = normalizeProviderTxResult(hash)
    expect(out.kind).toBe('hash')
    if (out.kind === 'hash') {
      expect(out.hash).toBe('a'.repeat(64))
      expect(out.raw).toBe(hash)
      expect(out.source).toBe('hash')
    }
    expect(providerTxClassification(out)).toBe('hash')
  })

  it('derives hash from known serialized basic tx (source serialized)', () => {
    const { hex, hash } = buildSignedBasicTxHex()
    expect(hex.length).toBeGreaterThan(64)
    const out = normalizeProviderTxResult(hex)
    expect(out.kind).toBe('hash')
    if (out.kind === 'hash') {
      expect(out.hash).toBe(hash)
      expect(out.raw).toBe(hex)
      expect(out.source).toBe('serialized')
    }
    expect(providerTxClassification(out)).toBe('serialized→hash')
  })

  it('keeps unparseable non-hex strings as raw', () => {
    const raw = 'serialized-or-other-id'
    const out = normalizeProviderTxResult(raw)
    expect(out).toEqual({ kind: 'raw', value: raw, raw })
    expect(providerTxClassification(out)).toBe('raw')
  })

  it('keeps short invalid hex as raw when fromAny fails', () => {
    const raw = 'aabbcc'
    const out = normalizeProviderTxResult(raw)
    expect(out.kind).toBe('raw')
    if (out.kind === 'raw') {
      expect(out.value).toBe(raw)
    }
    expect(providerTxClassification(out)).toBe('raw')
  })

  it('maps ErrorResponse neutrally', () => {
    const out = normalizeProviderTxResult({
      error: { type: 'cancelled', message: 'User cancelled' },
    })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.message).toBe('User cancelled')
      expect(out.type).toBe('cancelled')
    }
    expect(providerTxClassification(out)).toBe('error')
  })

  it('rejects unexpected objects', () => {
    const out = normalizeProviderTxResult({ foo: 1 })
    expect(out.kind).toBe('error')
  })
})
