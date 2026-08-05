/**
 * Min-payout declaration loader (Steakout research, not official registry).
 */
import { describe, expect, it, afterEach } from 'vitest'
import {
  getDeclaredMinPayout,
  loadMinPayoutDeclarations,
  resetMinPayoutDeclarationsCache,
} from '../../../server/src/minPayoutDeclarations.js'

afterEach(() => {
  resetMinPayoutDeclarationsCache()
})

describe('minPayoutDeclarations', () => {
  it('loads Keyring as fixed 10 NIM from committed config', () => {
    const map = loadMinPayoutDeclarations({ reload: true })
    expect(map.size).toBeGreaterThanOrEqual(24)
    const keyring = getDeclaredMinPayout(
      'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4',
      { reload: true },
    )
    expect(keyring).toEqual({
      nim: 10,
      kind: 'fixed',
      confidence: 'high',
    })
  })

  it('returns unknown stub for addresses not in the file', () => {
    // Valid Nimiq address format that is not on the canary research list
    // (checksum may fail normalize → still unknown stub).
    const miss = getDeclaredMinPayout(
      'NQ01 0000 0000 0000 0000 0000 0000 0000 0000',
      { reload: true },
    )
    expect(miss.kind).toBe('unknown')
    expect(miss.nim).toBeNull()
  })

  it('maps Nimiq.Fun to none and AceStaking to stake-based', () => {
    const fun = getDeclaredMinPayout(
      'NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU',
      { reload: true },
    )
    expect(fun.kind).toBe('none')
    expect(fun.nim).toBeNull()

    const ace = getDeclaredMinPayout(
      'NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL',
      { reload: true },
    )
    expect(ace.kind).toBe('stake-based')
    expect(ace.nim).toBeNull()
  })
})
