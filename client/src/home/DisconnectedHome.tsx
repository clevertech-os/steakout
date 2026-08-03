/**
 * Home — wallet disconnected (SPEC §6.1 first-run).
 * Sparse first-run: one short lede + QR as primary connect path.
 */

import OpenInNimiqPayQr from '../components/OpenInNimiqPayQr'

export interface DisconnectedHomeProps {
  connecting: boolean
  walletStatus: string | null
  error: string | null
  mobilePayConnect: boolean
  /** True when running inside Nimiq Pay WebView. */
  inNimiqPay: boolean
  onConnect: () => void
  onConnectPay?: () => void
  /** After phone approves desktop pairing. */
  onDesktopLinked?: (address: string) => void
}

export default function DisconnectedHome({
  connecting,
  walletStatus,
  error,
  mobilePayConnect,
  inNimiqPay,
  onConnect,
  onConnectPay,
  onDesktopLinked,
}: DisconnectedHomeProps) {
  return (
    <>
      <header className="shell-header page-header">
        <p className="eyebrow eyebrow--brand">Steakout</p>
        <h1 className="page-title">Your NIM may be idle</h1>
        <p className="page-lede">Stake and track payouts. Keys stay in your wallet.</p>
      </header>

      <section className="nq-card nq-card-lg shell-card home-card" aria-labelledby="home-connect-title">
        <h2 id="home-connect-title" className="visually-hidden">
          Connect
        </h2>

        {/* Inside Pay: native connect. Desktop: QR below is primary. */}
        {inNimiqPay ? (
          <div className="home-actions home-actions--top">
            <button
              type="button"
              className="nq-pill-blue nq-pill-lg home-cta"
              onClick={onConnect}
              disabled={connecting}
            >
              {connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          </div>
        ) : null}

        {mobilePayConnect && onConnectPay ? (
          <div className="home-actions home-actions--top">
            <button
              type="button"
              className="nq-pill-blue nq-pill-lg home-cta"
              onClick={onConnectPay}
              disabled={connecting}
            >
              Open in Nimiq Pay
            </button>
          </div>
        ) : null}

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

        {/* Desktop primary: Pay QR + session pair. */}
        <OpenInNimiqPayQr linkDesktopSession onDesktopLinked={onDesktopLinked} />

        <div className="home-actions home-actions--secondary">
          <a className="nq-pill-secondary home-cta" href="#/validators">
            Explore validators
          </a>
          <a className="nq-ghost-btn home-cta" href="#/learn/staking">
            How staking works
          </a>
        </div>
      </section>
    </>
  )
}
