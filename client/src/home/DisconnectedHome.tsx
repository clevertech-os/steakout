/**
 * Home — wallet disconnected (SPEC §6.1 first-run).
 * Primary headline locked to SPEC; supporting copy is methodology-safe (P3-09).
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
      <header className="shell-header page-header">
        <p className="eyebrow eyebrow--brand">Steakout</p>
        <h1 className="page-title">Your NIM may be idle</h1>
        <p className="page-lede">
          See what it could do without giving up control of your keys.
        </p>
      </header>

      <section className="nq-card nq-card-lg shell-card home-card" aria-labelledby="home-connect-title">
        <h2 id="home-connect-title">Connect or browse</h2>
        <p className="home-copy">
          Steakout is non-custodial: private keys never leave your wallet. Connect with
          Nimiq Pay (or Hub on desktop) to read your staking position, or explore
          validators and payout observations without connecting.
        </p>
        <p className="home-copy home-copy--muted">
          Observations describe what was seen on chain. They are not a guaranteed return
          and not a ranking of “best” validators.
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
            Install Nimiq Pay, then return here, or continue with Nimiq Hub above.
          </p>
        ) : null}
      </section>
    </>
  )
}
