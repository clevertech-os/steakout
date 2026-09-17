import { describe, expect, it } from 'vitest'
import { faviconUrlFromWebsite } from '../../../client/src/validators/ValidatorCard'

describe('validator card favicon URL', () => {
  it('uses the same-origin cached favicon endpoint for valid websites', () => {
    expect(
      faviconUrlFromWebsite(
        'https://pool.example/about',
        'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
      ),
    ).toBe('/api/validators/NQ0000000000000000000000000000000000/favicon')
  })

  it('keeps the initials fallback for invalid or missing websites', () => {
    expect(faviconUrlFromWebsite('javascript:alert(1)', 'NQ00')).toBeNull()
    expect(faviconUrlFromWebsite(null, 'NQ00')).toBeNull()
  })
})

