import { describe, expect, it } from 'vitest'
import {
  HOME_PATH,
  LEARN_ARTICLES,
  LEARN_PATH,
  NAV_ROUTES,
  hashToPath,
  matchRoute,
} from '../../../client/src/routes.ts'

describe('hashToPath', () => {
  it('strips the hash prefix and normalizes empty fragments to home', () => {
    expect(hashToPath('#/validators')).toBe('/validators')
    expect(hashToPath('#/')).toBe('/')
    expect(hashToPath('')).toBe('/')
    expect(hashToPath('#')).toBe('/')
  })
})

describe('matchRoute', () => {
  it('matches the four primary destinations', () => {
    for (const route of NAV_ROUTES) {
      expect(matchRoute(route.path)).toEqual({ id: route.id })
    }
  })

  it('treats trailing slashes as the same destination', () => {
    expect(matchRoute('/activity/')).toEqual({ id: 'activity' })
    expect(matchRoute('/')).toEqual({ id: 'home' })
  })

  it('matches /validators/:address for the profile screen (P1-11)', () => {
    expect(matchRoute('/validators/NQXX')).toEqual({
      id: 'validators',
      param: 'NQXX',
    })
  })

  it('matches Learn article subpaths (P2-12)', () => {
    for (const slug of LEARN_ARTICLES) {
      expect(matchRoute(`${LEARN_PATH}/${slug}`)).toEqual({
        id: 'learn',
        param: slug,
      })
    }
    expect(matchRoute('/learn/methodology/')).toEqual({
      id: 'learn',
      param: 'methodology',
    })
  })

  it('rejects unknown Learn slugs and nested Learn paths', () => {
    expect(matchRoute('/learn/unknown')).toBeNull()
    expect(matchRoute('/learn/staking/extra')).toBeNull()
  })

  it('returns null for unknown paths (404 → Home)', () => {
    expect(matchRoute('/nope')).toBeNull()
    expect(matchRoute('/validators/a/b')).toBeNull()
  })

  it('exposes HOME_PATH for the redirect target', () => {
    expect(HOME_PATH).toBe('/')
    expect(matchRoute(HOME_PATH)?.id).toBe('home')
  })
})
