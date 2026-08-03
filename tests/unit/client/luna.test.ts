/**
 * P1-14 — Luna ↔ NIM conversion + formatting (client/src/luna.ts).
 * No live network; pure number helpers.
 */

import { describe, expect, it } from 'vitest'
import {
  formatNimFromLuna,
  LUNA_PER_NIM,
  lunaToNim,
  nimToLuna,
} from '../../../client/src/luna.ts'

describe('LUNA_PER_NIM', () => {
  it('is the protocol constant 100_000', () => {
    expect(LUNA_PER_NIM).toBe(100_000)
  })
})

describe('lunaToNim / nimToLuna', () => {
  it('converts whole NIM amounts', () => {
    expect(lunaToNim(100_000)).toBe(1)
    expect(lunaToNim(0)).toBe(0)
    expect(nimToLuna(1)).toBe(100_000)
    expect(nimToLuna(0)).toBe(0)
  })

  it('round-trips integer NIM', () => {
    for (const nim of [0, 1, 42, 1_000, 999_999]) {
      expect(lunaToNim(nimToLuna(nim))).toBe(nim)
    }
  })

  it('rounds fractional NIM to nearest Luna on write', () => {
    // 0.5 Luna rounds away from zero via Math.round
    expect(nimToLuna(0.000_005)).toBe(1) // 0.5 Luna → 1
    expect(nimToLuna(1.234_567_89)).toBe(Math.round(1.234_567_89 * LUNA_PER_NIM))
    expect(nimToLuna(0.000_001)).toBe(0) // 0.1 Luna → 0
  })

  it('handles huge values without inventing precision beyond JS number limits', () => {
    const hugeLuna = 9_000_000_000_000_000 // 90e9 NIM-scale still finite as integer steps
    expect(Number.isFinite(lunaToNim(hugeLuna))).toBe(true)
    expect(lunaToNim(hugeLuna)).toBe(hugeLuna / LUNA_PER_NIM)
    expect(nimToLuna(1_000_000)).toBe(100_000_000_000)
  })

  it('handles negative amounts (refunds / deltas)', () => {
    expect(lunaToNim(-100_000)).toBe(-1)
    expect(nimToLuna(-2.5)).toBe(-250_000)
  })
})

describe('formatNimFromLuna', () => {
  it('formats zero as "0"', () => {
    expect(formatNimFromLuna(0)).toBe('0')
  })

  it('formats whole NIM without trailing decimals by default', () => {
    expect(formatNimFromLuna(100_000)).toBe('1')
    expect(formatNimFromLuna(5_000_000)).toBe('50')
  })

  it('formats fractional NIM with up to 2 fraction digits', () => {
    expect(formatNimFromLuna(150_000)).toBe('1.5')
    expect(formatNimFromLuna(123_456)).toBe('1.23')
    // sub-1 NIM shows decimals
    expect(formatNimFromLuna(50_000)).toBe('0.5')
    expect(formatNimFromLuna(1)).toBe('0') // rounds to 0 at 2 fraction digits via NumberFormat
  })

  it('uses thousands separators for large values', () => {
    // 1_234_567.89 NIM = 123_456_789_000 Luna
    const formatted = formatNimFromLuna(123_456_789_000)
    expect(formatted).toMatch(/1,234,567/)
  })

  it('returns em dash for null, undefined, NaN, Infinity', () => {
    expect(formatNimFromLuna(null)).toBe('—')
    expect(formatNimFromLuna(undefined)).toBe('—')
    expect(formatNimFromLuna(Number.NaN)).toBe('—')
    expect(formatNimFromLuna(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatNimFromLuna(Number.NEGATIVE_INFINITY)).toBe('—')
  })

  it('respects fixed option with maxFractionDigits', () => {
    expect(formatNimFromLuna(100_000, { fixed: true })).toBe('1.00')
    expect(formatNimFromLuna(150_000, { fixed: true, maxFractionDigits: 4 })).toBe('1.5000')
    expect(formatNimFromLuna(0, { fixed: true })).toBe('0.00')
  })

  it('respects maxFractionDigits without fixed (caps shown decimals)', () => {
    // 1.23456 NIM — default max 2 → "1.23"
    expect(formatNimFromLuna(123_456)).toBe('1.23')
    // with max 0, non-integer still gets min(0,2)=0 fraction digits only when
    // the branch sets fractionDigits — for non-integer nim, fractionDigits = min(maxFrac, 2)
    expect(formatNimFromLuna(123_456, { maxFractionDigits: 0 })).toBe('1')
  })

  it('formats negative Luna', () => {
    expect(formatNimFromLuna(-100_000)).toBe('-1')
    expect(formatNimFromLuna(-150_000)).toBe('-1.5')
  })
})
