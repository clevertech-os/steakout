import { Suspense, lazy, useEffect, useState } from 'react'
import SdkSmoke from './spike/SdkSmoke'
import StakingMethods from './spike/StakingMethods'
import StyleReference from './spike/StyleReference'
import BottomNav from './components/BottomNav'
import NetworkBadge from './components/NetworkBadge'
import OfflineBanner from './components/OfflineBanner'
import { peekHubRedirectInUrl } from './hubRedirectParse'
import { HOME_PATH, hashToPath, matchRoute, type RouteId } from './routes'
import './App.css'

const loadHome = () => import('./home/Home')
const loadValidators = () => import('./validators/Validators')
const loadProfile = () => import('./validators/Profile')
const loadActivity = () => import('./activity/Activity')
const loadLearn = () => import('./learn/Learn')

const Home = lazy(loadHome)
const Validators = lazy(loadValidators)
const Profile = lazy(loadProfile)
const Activity = lazy(loadActivity)
const Learn = lazy(loadLearn)

/** Warm route chunks so tab switches paint chrome immediately. */
function preloadRouteChunks() {
  void loadHome()
  void loadValidators()
  void loadProfile()
  void loadActivity()
  void loadLearn()
}

/** Warm public validator JSON after shell is up (Home → Validators is instant). */
function preloadValidatorsData() {
  void import('./validators/api').then((m) => {
    m.prefetchValidatorsDirectory()
  })
}

function RouteFallback() {
  return (
    <div className="route-shell" aria-busy="true">
      <header className="shell-header page-header">
        <span className="so-skeleton-line route-shell-title" aria-hidden="true" />
        <span className="so-skeleton-line route-shell-lede" aria-hidden="true" />
      </header>
      <p className="app-loading" role="status">
        Loading…
      </p>
      <div className="route-shell-body" aria-hidden="true">
        <span className="so-skeleton-line route-shell-card" />
        <span className="so-skeleton-line route-shell-card route-shell-card--short" />
        <span className="so-skeleton-line route-shell-card" />
      </div>
    </div>
  )
}

function screenFor(id: RouteId, param?: string) {
  switch (id) {
    case 'home':
      return <Home />
    case 'validators':
      // P1-11: address param → profile; list is P1-10 (Validators.tsx).
      return param ? <Profile address={param} /> : <Validators />
    case 'activity':
      return <Activity />
    case 'learn':
      return <Learn article={param} />
  }
}

/**
 * Resolve the SPA path from the location hash.
 *
 * Hub redirect login returns payload *in the hash* (`#id=…&status=…&result=…`).
 * That is not a Steakout route. Treat it as Home and **do not** rewrite the
 * fragment — Home’s wallet boot must read the payload and open the second Hub
 * trip (sign-message). Rewriting to `#/` used to wipe the response, so users
 * finished “choose address” with nothing to sign and stayed disconnected.
 */
function pathFromLocationHash(): string {
  if (peekHubRedirectInUrl()) return HOME_PATH
  return hashToPath(window.location.hash)
}

function useHashPath(): string {
  const [path, setPath] = useState(() => pathFromLocationHash())

  useEffect(() => {
    const onHashChange = () => setPath(pathFromLocationHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return path
}

function RoutedShell() {
  const path = useHashPath()
  const match = matchRoute(path)

  // 404 → Home. replace() (not assign) keeps the bad URL out of history.
  // Never touch the hash while a Hub redirect payload is present.
  useEffect(() => {
    if (peekHubRedirectInUrl()) return
    if (!matchRoute(path)) {
      window.location.replace(`#${HOME_PATH}`)
    }
  }, [path])

  // Prefetch other destinations + public directory data after first paint.
  useEffect(() => {
    const warm = () => {
      preloadRouteChunks()
      preloadValidatorsData()
    }
    const ric = window.requestIdleCallback?.bind(window)
    if (ric) {
      const id = ric(warm, { timeout: 2500 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(warm, 400)
    return () => window.clearTimeout(t)
  }, [])

  if (!match) {
    return null
  }

  return (
    <div className="app">
      <main className="app-main">
        <NetworkBadge />
        <OfflineBanner />
        <Suspense fallback={<RouteFallback />}>
          {screenFor(match.id, match.param)}
        </Suspense>
      </main>
      <BottomNav active={match.id} />
    </div>
  )
}

/**
 * P2-16: path-based share URLs (`/validators/:address`) are served by Express
 * with OG meta for crawlers. The SPA uses hash routing, so rewrite path opens
 * into `#/validators/:address` (replace keeps history clean).
 */
function rewritePathProfileToHash(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (!path.startsWith('/validators/')) return false
  const address = path.slice('/validators/'.length)
  if (!address || address.includes('/')) return false
  // Preserve query (e.g. utm) on the hash destination.
  const query = window.location.search
  window.location.replace(`/${query}#/validators/${address}`)
  return true
}

function App() {
  if (rewritePathProfileToHash()) {
    return null
  }

  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/spike') {
    if (!import.meta.env.DEV && import.meta.env.VITE_ENABLE_SDK_SPIKE !== 'true') {
      return (
        <main className="shell">
          <header className="shell-header">
            <p className="eyebrow">Steakout</p>
            <h1>Unavailable</h1>
          </header>
          <section className="nq-card nq-card-lg shell-card" aria-labelledby="spike-disabled-title">
            <p className="card-kicker">SDK smoke screen</p>
            <h2 id="spike-disabled-title">This route is disabled.</h2>
            <p>The integration smoke screen is not enabled in this build.</p>
          </section>
        </main>
      )
    }

    return <SdkSmoke />
  }

  if (path === '/spike/staking-methods') {
    if (!import.meta.env.DEV && import.meta.env.VITE_ENABLE_STAKING_SPIKE !== 'true') {
      return (
        <main className="shell">
          <header className="shell-header">
            <p className="eyebrow">Steakout</p>
            <h1>Unavailable</h1>
          </header>
          <section className="nq-card nq-card-lg shell-card" aria-labelledby="staking-spike-disabled-title">
            <p className="card-kicker">P0-03 staking-method spike</p>
            <h2 id="staking-spike-disabled-title">This route is disabled.</h2>
            <p>The staking-method harness is not enabled in this build.</p>
          </section>
        </main>
      )
    }

    return <StakingMethods />
  }

  if (path === '/spike-style') {
    if (!import.meta.env.DEV && import.meta.env.VITE_ENABLE_STYLE_SPIKE !== 'true') {
      return (
        <main className="shell">
          <header className="shell-header">
            <p className="eyebrow">Steakout</p>
            <h1>Unavailable</h1>
          </header>
          <section className="nq-card nq-card-lg shell-card" aria-labelledby="style-spike-disabled-title">
            <p className="card-kicker">P1-08 style reference</p>
            <h2 id="style-spike-disabled-title">This route is disabled.</h2>
            <p>The style reference is not enabled in this build.</p>
          </section>
        </main>
      )
    }

    return <StyleReference />
  }

  return <RoutedShell />
}

export default App
