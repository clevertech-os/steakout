/**
 * P1-14 — server address normalize/validate/equal.
 * Mirrors client/src/addresses.ts (no formatDisplayAddress on server).
 */

import { describe, expect, it } from 'vitest'
import {
  addressesEqual,
  isValidNimiqAddress,
  normalizeAddress,
  shortAddress,
} from '../../../server/src/addresses.js'

describe('server addresses helpers', () => {
  const valid = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
  // Shape-valid (NQ + 34 alphanumerics) — checksum not checked by these helpers.
  const validCompact = 'NQ0700000000000000000000000000000000'

  it('normalizeAddress strips whitespace (spaces/tabs/newlines) and uppercases', () => {
    expect(normalizeAddress('nq07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(
      validCompact,
    )
    expect(normalizeAddress(valid)).toBe(validCompact)
    expect(normalizeAddress('nq07\t0000\n0000 0000 0000 0000 0000 0000 0000')).toBe(
      validCompact,
    )
  })

  it('isValidNimiqAddress accepts spaced, compact, and mixed-case forms', () => {
    expect(isValidNimiqAddress(valid)).toBe(true)
    expect(isValidNimiqAddress(validCompact)).toBe(true)
    expect(isValidNimiqAddress(valid.toLowerCase())).toBe(true)
    expect(isValidNimiqAddress('NQ84 DT0K U4SC 2H3J 5L6M 7N8P 9Q0R 1S2T 3U4V')).toBe(true)
  })

  it('isValidNimiqAddress rejects empty, wrong prefix, wrong length, and symbols', () => {
    expect(isValidNimiqAddress(null)).toBe(false)
    expect(isValidNimiqAddress(undefined)).toBe(false)
    expect(isValidNimiqAddress('')).toBe(false)
    expect(isValidNimiqAddress('   ')).toBe(false)
    expect(isValidNimiqAddress('NQ07')).toBe(false)
    expect(isValidNimiqAddress('AB0700000000000000000000000000000000')).toBe(false)
    expect(isValidNimiqAddress('NQ070000000000000000000000000000000')).toBe(false) // 33 after NQ
    expect(isValidNimiqAddress('NQ07000000000000000000000000000000001')).toBe(false) // 35
    expect(isValidNimiqAddress('NQ07 0000 0000 0000 0000 0000 0000 0000 000!')).toBe(false)
  })

  it('shortAddress shows first 4 and last 4 with ellipsis', () => {
    expect(shortAddress(valid)).toBe('NQ07…0000')
    expect(shortAddress(validCompact)).toBe('NQ07…0000')
  })

  it('addressesEqual compares normalized forms only', () => {
    expect(addressesEqual(valid, validCompact)).toBe(true)
    expect(addressesEqual(valid.toLowerCase(), validCompact)).toBe(true)
    expect(addressesEqual(valid, 'NQ08 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(false)
    expect(addressesEqual(null, valid)).toBe(false)
    expect(addressesEqual(valid, undefined)).toBe(false)
    expect(addressesEqual('not-an-address', valid)).toBe(false)
    expect(addressesEqual(null, null)).toBe(false)
  })
})
