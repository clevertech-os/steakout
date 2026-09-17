import { describe, expect, it } from 'vitest'
import type { ValidatorListItem } from '../../../client/src/validators/api'
import {
  directoryLetterKey,
  groupValidatorsByLetter,
  matchesDirectoryQuery,
  validatorDisplayName,
  validatorListId,
} from '../../../client/src/validators/directoryBrowse'

function item(partial: Partial<ValidatorListItem> & { address: string }): ValidatorListItem {
  return {
    name: null,
    isListed: true,
    logoUrl: null,
    officialScore: null,
    stakeLuna: null,
    dominanceRatio: null,
    stakersCount: null,
    declared: {
      fee: null,
      payoutType: 'unknown',
      payoutSchedule: null,
      scheduleNormalized: null,
    },
    observation: {
      status: 'insufficient-data',
      lastObservedAt: null,
      historyDepthDays: 0,
    },
    ...partial,
  }
}

describe('directory browse helpers', () => {
  it('matches name or compact address', () => {
    const v = item({
      address: 'NQ00 1111 2222 3333 4444 5555 6666 7777 8888',
      name: 'Helvetia Pool',
    })
    expect(matchesDirectoryQuery(v, 'helv')).toBe(true)
    expect(matchesDirectoryQuery(v, 'nq001111')).toBe(true)
    expect(matchesDirectoryQuery(v, 'zzz')).toBe(false)
  })

  it('groups by first letter and keeps list order indexes', () => {
    const validators = [
      item({ address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0001', name: 'Helvetia' }),
      item({ address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0002', name: 'Acme' }),
      item({ address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0003', name: '2Fast' }),
    ]
    const groups = groupValidatorsByLetter(validators)
    expect(groups.map((g) => g.letter)).toEqual(['A', 'H', '#'])
    expect(groups[0]?.items[0]?.listIndex).toBe(1)
    expect(directoryLetterKey(validatorDisplayName(validators[2]!))).toBe('#')
  })

  it('builds a stable list id from the normalized address', () => {
    expect(validatorListId('nq00 abcd')).toBe('validator-NQ00ABCD')
  })
})
