/**
 * P1-12 — provider return normalization for confirm polling.
 */

import { describe, expect, it } from 'vitest'
import { normalizeProviderTxResult } from '../../../client/src/nimiq.ts'

describe('normalizeProviderTxResult', () => {
  it('treats 64-hex as hash (lowercased)', () => {
    const hash = 'A'.repeat(64)
    const out = normalizeProviderTxResult(hash)
    expect(out.kind).toBe('hash')
    if (out.kind === 'hash') {
      expect(out.hash).toBe('a'.repeat(64))
      expect(out.raw).toBe(hash)
    }
  })

  it('keeps non-hex strings as raw for confirm-as-is', () => {
    const raw = 'serialized-or-other-id'
    const out = normalizeProviderTxResult(raw)
    expect(out).toEqual({ kind: 'raw', value: raw, raw })
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
  })

  it('rejects unexpected objects', () => {
    const out = normalizeProviderTxResult({ foo: 1 })
    expect(out.kind).toBe('error')
  })
})
