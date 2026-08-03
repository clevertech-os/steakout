/**
 * P1-12 — stake amount presets + fee headroom.
 */

import { describe, expect, it } from 'vitest'
import {
  isPoolAmountAllowed,
  isStakeAmountAllowed,
  maxRemoveLuna,
  maxRetireLuna,
  maxSafeStakeLuna,
  parseNimInputToLuna,
  presetPoolLuna,
  presetStakeLuna,
  STAKE_FEE_HEADROOM_LUNA,
} from '../../../client/src/staking/amounts.ts'
import { LUNA_PER_NIM } from '../../../client/src/luna.ts'

describe('STAKE_FEE_HEADROOM_LUNA', () => {
  it('is 1 NIM (documented safety floor)', () => {
    expect(STAKE_FEE_HEADROOM_LUNA).toBe(LUNA_PER_NIM)
  })
})

describe('maxSafeStakeLuna', () => {
  it('returns 0 for null/NaN/insufficient balance', () => {
    expect(maxSafeStakeLuna(null)).toBe(0)
    expect(maxSafeStakeLuna(undefined)).toBe(0)
    expect(maxSafeStakeLuna(NaN)).toBe(0)
    expect(maxSafeStakeLuna(STAKE_FEE_HEADROOM_LUNA)).toBe(0)
    expect(maxSafeStakeLuna(STAKE_FEE_HEADROOM_LUNA - 1)).toBe(0)
  })

  it('never equals full balance when balance exceeds headroom', () => {
    const balance = 10 * LUNA_PER_NIM
    const max = maxSafeStakeLuna(balance)
    expect(max).toBe(balance - STAKE_FEE_HEADROOM_LUNA)
    expect(max).toBeLessThan(balance)
  })
})

describe('presetStakeLuna', () => {
  const balance = 10 * LUNA_PER_NIM
  const maxSafe = maxSafeStakeLuna(balance)

  it('25% and 50% are fractions of max-safe, not raw balance', () => {
    expect(presetStakeLuna(balance, '25')).toBe(Math.floor(maxSafe * 0.25))
    expect(presetStakeLuna(balance, '50')).toBe(Math.floor(maxSafe * 0.5))
  })

  it('max-safe equals maxSafeStakeLuna', () => {
    expect(presetStakeLuna(balance, 'max-safe')).toBe(maxSafe)
  })

  it('presets never stake the entire balance', () => {
    for (const id of ['25', '50', 'max-safe'] as const) {
      expect(presetStakeLuna(balance, id)).toBeLessThan(balance)
    }
  })
})

describe('parseNimInputToLuna', () => {
  it('parses whole and fractional NIM', () => {
    expect(parseNimInputToLuna('1')).toBe(LUNA_PER_NIM)
    expect(parseNimInputToLuna('1.5')).toBe(Math.round(1.5 * LUNA_PER_NIM))
    expect(parseNimInputToLuna('1,000')).toBe(1000 * LUNA_PER_NIM)
  })

  it('rejects empty, negative, and non-numeric', () => {
    expect(parseNimInputToLuna('')).toBeNull()
    expect(parseNimInputToLuna('  ')).toBeNull()
    expect(parseNimInputToLuna('-1')).toBeNull()
    expect(parseNimInputToLuna('abc')).toBeNull()
    expect(parseNimInputToLuna('0')).toBeNull()
  })
})

describe('isStakeAmountAllowed', () => {
  const balance = 5 * LUNA_PER_NIM
  const maxSafe = maxSafeStakeLuna(balance)

  it('allows amounts within max-safe', () => {
    expect(isStakeAmountAllowed(maxSafe, balance)).toBe(true)
    expect(isStakeAmountAllowed(1, balance)).toBe(true)
  })

  it('rejects over max-safe or full balance', () => {
    expect(isStakeAmountAllowed(maxSafe + 1, balance)).toBe(false)
    expect(isStakeAmountAllowed(balance, balance)).toBe(false)
  })
})

describe('maxRetireLuna / maxRemoveLuna (P3-01)', () => {
  it('retirable is active + inactive only', () => {
    expect(
      maxRetireLuna({ activeLuna: 100, inactiveLuna: 50, retiredLuna: 999 } as {
        activeLuna: number
        inactiveLuna: number
      }),
    ).toBe(150)
    expect(maxRetireLuna({ activeLuna: 0, inactiveLuna: 0 })).toBe(0)
    expect(maxRetireLuna(null)).toBe(0)
  })

  it('removable is retired only', () => {
    expect(maxRemoveLuna(2_000_000)).toBe(2_000_000)
    expect(maxRemoveLuna(0)).toBe(0)
    expect(maxRemoveLuna(null)).toBe(0)
  })

  it('pool presets use full pool without fee headroom', () => {
    const pool = 400
    expect(presetPoolLuna(pool, 'max-safe')).toBe(400)
    expect(presetPoolLuna(pool, '25')).toBe(100)
    expect(presetPoolLuna(pool, '50')).toBe(200)
    expect(isPoolAmountAllowed(400, pool)).toBe(true)
    expect(isPoolAmountAllowed(401, pool)).toBe(false)
  })
})
