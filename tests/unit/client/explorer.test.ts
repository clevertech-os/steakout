import { describe, expect, it } from 'vitest'
import {
  buildNimiqAddressExplorerUrl,
  buildNimiqExplorerUrl,
} from '../../../client/src/explorer.ts'

describe('explorer URL builders', () => {
  it('buildNimiqExplorerUrl strips 0x and uppercases hash', () => {
    expect(buildNimiqExplorerUrl('0xabcd')).toBe('https://nimiq.watch/#ABCD')
    expect(buildNimiqExplorerUrl('deadbeef')).toBe('https://nimiq.watch/#DEADBEEF')
  })

  it('buildNimiqAddressExplorerUrl normalizes spacing', () => {
    expect(buildNimiqAddressExplorerUrl('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(
      'https://nimiq.watch/#NQ0700000000000000000000000000000000',
    )
  })
})
