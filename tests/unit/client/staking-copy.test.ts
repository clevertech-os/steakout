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

describe('stake flow copy (P1-13 / P3-01)', () => {
  it('exports non-custodial and review-before-confirm lines', () => {
    expect(copy.STAKE_NON_CUSTODIAL.toLowerCase()).toMatch(/never holds keys|seed phrases/)
    expect(copy.STAKE_REVIEW_BEFORE_CONFIRM.toLowerCase()).toMatch(/review/)
    expect(copy.STAKE_NO_ILLUSTRATIVE_ON_REVIEW.toLowerCase()).toMatch(/does not show yield/)
  })

  it('retire/remove copy denies instant unstake', () => {
    expect(copy.RETIRE_WAITING_PERIOD_NOTE).toMatch(/does not immediately return NIM/i)
    expect(copy.RETIRE_WAITING_PERIOD_NOTE).toMatch(/not instant unstake/i)
    expect(copy.REMOVE_WAITING_PERIOD_NOTE).toMatch(/cannot remove Active/i)
    expect(copy.RETIRE_AMOUNT_LEDE).toMatch(/does not return NIM/i)
    expect(copy.REMOVE_AMOUNT_LEDE).toMatch(/cannot skip the retire waiting period/i)
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
