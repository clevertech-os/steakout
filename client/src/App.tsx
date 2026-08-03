import SdkSmoke from './spike/SdkSmoke'

function App() {
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

  return (
    <main className="shell">
      <header className="shell-header">
        <p className="eyebrow">Nimiq staking cockpit</p>
        <h1>Steakout</h1>
      </header>
      <section className="nq-card nq-card-lg shell-card" aria-labelledby="welcome-title">
        <p className="card-kicker">Engineering baseline</p>
        <h2 id="welcome-title">Know who is paying you.</h2>
        <p>
          The app shell is ready. Wallet, validator, and evidence flows will be added in their
          assigned tasks.
        </p>
      </section>
    </main>
  )
}

export default App
