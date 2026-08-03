import { describe, expect, it } from 'vitest'
import {
  buildProfilePageMeta,
  buildProfileSharePath,
  buildProfileShareUrl,
} from '../../../client/src/validators/profileShare.ts'

describe('buildProfileSharePath / buildProfileShareUrl', () => {
  it('uses compact normalized address without hash', () => {
    expect(buildProfileSharePath('nq07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(
      '/validators/NQ0700000000000000000000000000000000',
    )
    expect(
      buildProfileShareUrl(
        'NQ0700000000000000000000000000000000',
        'https://steakout.example/',
      ),
    ).toBe('https://steakout.example/validators/NQ0700000000000000000000000000000000')
  })
})

describe('buildProfilePageMeta (client)', () => {
  it('includes name + observation status only from displayed data', () => {
    const meta = buildProfilePageMeta({
      name: 'Honest Node',
      address: 'NQ0700000000000000000000000000000000',
      officialScore: 90,
      observationStatus: 'mostly-on-schedule',
      historyDepthDays: 14,
      found: true,
    })
    expect(meta.title).toBe('Honest Node · Steakout')
    expect(meta.description).toContain('Mostly on schedule')
    expect(meta.description).toContain('90')
    expect(meta.description).toContain('14 days')
  })

  it('graceful copy when not found', () => {
    const meta = buildProfilePageMeta({
      name: null,
      address: 'bad',
      officialScore: null,
      observationStatus: 'unavailable',
      historyDepthDays: 0,
      found: false,
    })
    expect(meta.title).toBe('Validator profile · Steakout')
    expect(meta.description.length).toBeGreaterThan(10)
  })
})
