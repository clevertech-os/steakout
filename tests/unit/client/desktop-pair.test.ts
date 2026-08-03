import { describe, expect, it } from 'vitest'
import { readDesktopPairIdFromLocation } from '../../../client/src/api/desktopPair.ts'

describe('readDesktopPairIdFromLocation', () => {
  it('reads from query string', () => {
    expect(readDesktopPairIdFromLocation('?desktopPair=abc-123', '')).toBe('abc-123')
  })

  it('reads from hash query', () => {
    expect(readDesktopPairIdFromLocation('', '#/?desktopPair=xyz')).toBe('xyz')
    expect(readDesktopPairIdFromLocation('', '#/validators?desktopPair=xyz')).toBe('xyz')
  })

  it('returns null when absent', () => {
    expect(readDesktopPairIdFromLocation('', '#/')).toBeNull()
  })
})
