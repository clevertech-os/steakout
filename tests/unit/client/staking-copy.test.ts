/**
 * P1-13 — banned phrase greps on stake review copy.
 */

import { describe, expect, it } from 'vitest'
import * as copy from '../../../client/src/staking/copy.ts'

const BANNED = [
  /guaranteed/i,
  /best validator/i,
  /APY/i,
  /fraud/i,
  /scam/i,
  /\u2014/, // em dash
]

describe('stake flow copy (P1-13)', () => {
  it('exports non-custodial and review-before-confirm lines', () => {
    expect(copy.STAKE_NON_CUSTODIAL.toLowerCase()).toMatch(/never holds keys|seed phrases/)
    expect(copy.STAKE_REVIEW_BEFORE_CONFIRM.toLowerCase()).toMatch(/review/)
    expect(copy.STAKE_NO_ILLUSTRATIVE_ON_REVIEW.toLowerCase()).toMatch(/does not show yield/)
  })

  it('contains no banned phrases in string exports', () => {
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value !== 'string') continue
      for (const ban of BANNED) {
        expect(value, `${key} matches ${ban}`).not.toMatch(ban)
      }
    }
  })
})
