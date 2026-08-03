/**
 * Home — wallet disconnected (SPEC §6.1).
 */

export interface DisconnectedHomeProps {
  connecting: boolean
  walletStatus: string | null
  error: string | null
  mobilePayConnect: boolean
  showOpenInPay: boolean
  onConnect: () => void
  onConnectPay?: () => void
}

export default function DisconnectedHome({
  connecting,
  walletStatus,
  error,
  mobilePayConnect,
  showOpenInPay,
  onConnect,
  onConnectPay,
}: DisconnectedHomeProps) {
  return (
    <>
      <header className="shell-header home-header">
        <p className="eyebrow">Steakout</p>
        <h1 className="home-title">Your NIM may be idle</h1>
        <p className="home-lede">See what it could do — without giving up control of your keys.</p>
      </header>

      <section className="nq-card nq-card-lg shell-card home-card" aria-labelledby="home-connect-title">
        <p className="card-kicker">Get started</p>
        <h2 id="home-connect-title">Connect and explore</h2>
        <p className="home-copy">
          Steakout is non-custodial. Connect with Nimiq Pay (or Hub on desktop) to read your
          position, or browse validators without connecting.
        </p>

        <div className="home-actions">
          <button
            type="button"
            className="nq-pill-blue nq-pill-lg home-cta"
            onClick={onConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : 'Connect Nimiq Pay wallet'}
          </button>

          {mobilePayConnect && onConnectPay ? (
            <button
              type="button"
              className="nq-pill-secondary home-cta"
              onClick={onConnectPay}
              disabled={connecting}
            >
              Open in Nimiq Pay
            </button>
          ) : null}

          <a className="nq-pill-secondary home-cta" href="#/validators">
            Explore validators
          </a>

          <a className="nq-ghost-btn home-cta" href="#/learn/staking">
            How non-custodial staking works
          </a>
        </div>

        {walletStatus ? (
          <p className="home-status" role="status">
            {walletStatus}
          </p>
        ) : null}

        {error ? (
          <p className="home-error" role="alert">
            {error}
          </p>
        ) : null}

        {showOpenInPay ? (
          <p className="home-hint nq-subline">
            Install Nimiq Pay, then return here — or continue with Nimiq Hub above.
          </p>
        ) : null}
      </section>
    </>
  )
}
