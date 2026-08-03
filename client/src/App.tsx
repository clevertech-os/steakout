import { Suspense, lazy, useEffect, useState } from 'react'
import SdkSmoke from './spike/SdkSmoke'
import StakingMethods from './spike/StakingMethods'
import StyleReference from './spike/StyleReference'
import BottomNav from './components/BottomNav'
import NetworkBadge from './components/NetworkBadge'
import OfflineBanner from './components/OfflineBanner'
import { HOME_PATH, hashToPath, matchRoute, type RouteId } from './routes'
import './App.css'

const Home = lazy(() => import('./home/Home'))
const Validators = lazy(() => import('./validators/Validators'))
const Profile = lazy(() => import('./validators/Profile'))
const Activity = lazy(() => import('./activity/Activity'))
const Learn = lazy(() => import('./learn/Learn'))

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

function useHashPath(): string {
  const [path, setPath] = useState(() => hashToPath(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setPath(hashToPath(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return path
}

function RoutedShell() {
  const path = useHashPath()
  const match = matchRoute(path)

  // 404 → Home. replace() (not assign) keeps the bad URL out of history.
  useEffect(() => {
    if (!matchRoute(path)) {
      window.location.replace(`#${HOME_PATH}`)
    }
  }, [path])

  if (!match) {
    return null
  }

  return (
    <div className="app">
      <main className="app-main">
        <NetworkBadge />
        <OfflineBanner />
        <Suspense
          fallback={
            <p className="app-loading" role="status">
              Loading…
            </p>
          }
        >
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
