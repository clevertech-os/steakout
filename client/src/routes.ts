/**
 * Client route table for the app shell (P1-07).
 *
 * The shell uses hash-based routing (`#/validators`): the fragment is
 * never sent to the server, so in-app deep links survive reload with no
 * SPA-fallback config. Production Express also serves path-based
 * `/validators/:address` HTML with OG meta for crawlers (P2-16); the
 * client rewrites those opens into the hash router. Kept as pure
 * functions so Testing can unit-test the matcher later.
 */

export type RouteId = 'home' | 'validators' | 'activity' | 'learn'

/** Learn article slugs under `/learn/:slug` (P2-12). */
export const LEARN_ARTICLES = [
  'staking',
  'methodology',
  'limitations',
  'privacy',
] as const

export type LearnArticleId = (typeof LEARN_ARTICLES)[number]

export interface NavRoute {
  id: RouteId
  path: string
  label: string
}

/** Primary destinations, in bottom-nav order (SPEC §10). */
export const NAV_ROUTES: readonly NavRoute[] = [
  { id: 'home', path: '/', label: 'Home' },
  { id: 'validators', path: '/validators', label: 'Validators' },
  { id: 'activity', path: '/activity', label: 'Activity' },
  { id: 'learn', path: '/learn', label: 'Learn' },
]

export const HOME_PATH = '/'
export const LEARN_PATH = '/learn'

export interface RouteMatch {
  id: RouteId
  /**
   * Optional path segment:
   * - `/validators/:address` → address (profile P1-11 / P2-16)
   * - `/learn/:article` → Learn article slug (P2-12)
   */
  param?: string
}

/**
 * Convert a location fragment (`#/validators/NQ…` or `#/validators/NQ…?stake=1`)
 * into a route path. Query strings in the hash are stripped so matchers stay pure.
 */
export function hashToPath(hash: string): string {
  const raw = hash.replace(/^#/, '')
  const withSlash = raw.startsWith('/') ? raw : raw ? `/${raw}` : '/'
  const pathOnly = withSlash.split(/[?#]/)[0] || '/'
  return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
}

/** Parse query params embedded in the hash (`#/path?stake=1`). */
export function hashQuery(hash: string): URLSearchParams {
  const raw = hash.replace(/^#/, '')
  const qIndex = raw.indexOf('?')
  if (qIndex < 0) return new URLSearchParams()
  const query = raw.slice(qIndex + 1).split('#')[0]
  return new URLSearchParams(query)
}

/** True when the hash asks to open the stake flow (`?stake=1`). */
export function hashWantsStake(hash: string): boolean {
  const q = hashQuery(hash)
  const v = q.get('stake')
  return v === '1' || v === 'true'
}

/**
 * True when the hash asks to open change-validator flow (`?change=1`).
 * Takes precedence over stake when both are present.
 */
export function hashWantsChange(hash: string): boolean {
  const q = hashQuery(hash)
  const v = q.get('change')
  return v === '1' || v === 'true'
}

function isLearnArticle(slug: string): slug is LearnArticleId {
  return (LEARN_ARTICLES as readonly string[]).includes(slug)
}

/** Match a route path to a destination; null = unknown (404 → Home). */
export function matchRoute(rawPath: string): RouteMatch | null {
  const path = rawPath.replace(/\/+$/, '') || '/'

  for (const route of NAV_ROUTES) {
    if (path === route.path) return { id: route.id }
  }

  // Learn articles: /learn/staking | methodology | limitations | privacy
  if (path.startsWith(`${LEARN_PATH}/`)) {
    const slug = path.slice(LEARN_PATH.length + 1)
    if (slug.length > 0 && !slug.includes('/') && isLearnArticle(slug)) {
      return { id: 'learn', param: slug }
    }
  }

  // /validators/:address → validator profile (P1-11 summary; P2-16 share meta).
  if (path.startsWith('/validators/')) {
    const address = path.slice('/validators/'.length)
    if (address.length > 0 && !address.includes('/')) {
      return { id: 'validators', param: address }
    }
  }

  return null
}
