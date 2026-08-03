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

/** Convert a location fragment (`#/validators/NQ…`) into a route path. */
export function hashToPath(hash: string): string {
  const path = hash.replace(/^#/, '')
  return path.startsWith('/') ? path : '/'
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
