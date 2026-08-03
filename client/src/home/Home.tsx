/**
 * Home dashboard — three wallet/position states (P1-09, SPEC §6.1).
 *
 * 1. Disconnected / not authenticated
 * 2. Connected, not staked (NotStaked)
 * 3. Connected with position (Active / Pending / …)
 */

import { useCallback } from 'react'
import { walletAuthApi } from '../api/walletAuth'
import { ApiError } from '../api/http'
import { isStakedState } from '../api/position'
import { humanizeFetchError } from '../components/humanizeError'
import { useWallet } from '../wallet/useWallet'
import DesktopPairApprove from '../components/DesktopPairApprove'
import { isNimiqPayHost } from '../nimiq'
import DisconnectedHome from './DisconnectedHome'
import NotStakedHome from './NotStakedHome'
import StakedHome from './StakedHome'
import TestnetFaucetButton from './TestnetFaucetButton'
import { useStakingPosition } from './useStakingPosition'
import './Home.css'

export default function Home() {
  const wallet = useWallet({ auth: walletAuthApi })
  const positionEnabled =
    wallet.bootReady && wallet.status === 'connected' && Boolean(wallet.address)

  const position = useStakingPosition({ enabled: positionEnabled })

  const handleConnect = useCallback(() => {
    void wallet.connect()
  }, [wallet])

  const handleConnectPay = useCallback(() => {
    void wallet.connect({ useRedirect: false })
  }, [wallet])

  const handleDisconnect = useCallback(() => {
    wallet.disconnect()
  }, [wallet])

  const handleDesktopLinked = useCallback(
    (address: string) => {
      wallet.applySession(undefined, address)
    },
    [wallet],
  )

  const pairBanner = (
    <DesktopPairApprove
      enabled={isNimiqPayHost()}
      walletConnected={wallet.status === 'connected' && Boolean(wallet.address)}
      connecting={wallet.connecting}
      onConnect={handleConnect}
    />
  )

  if (!wallet.bootReady) {
    return (
      <div className="home">
        <header className="shell-header page-header">
          <h1 className="page-title">Loading…</h1>
        </header>
        <section className="nq-card nq-card-lg shell-card home-card" aria-busy="true">
          <p className="home-status" role="status">
            Starting wallet session…
          </p>
          <div className="home-skeleton" aria-hidden="true">
            <span className="so-skeleton-line home-skeleton-line home-skeleton-line--amount" />
            <span className="so-skeleton-line home-skeleton-line home-skeleton-line--narrow" />
            <div className="home-skeleton-stats">
              <span className="so-skeleton-line home-skeleton-line home-skeleton-line--stat" />
              <span className="so-skeleton-line home-skeleton-line home-skeleton-line--stat" />
              <span className="so-skeleton-line home-skeleton-line home-skeleton-line--stat" />
            </div>
            <span className="so-skeleton-line home-skeleton-line home-skeleton-line--section" />
          </div>
        </section>
      </div>
    )
  }

  if (wallet.status !== 'connected' || !wallet.address) {
    return (
      <div className="home">
        {pairBanner}
        <DisconnectedHome
          connecting={wallet.connecting || wallet.status === 'connecting'}
          walletStatus={wallet.walletStatus}
          error={wallet.error}
          mobilePayConnect={wallet.mobilePayConnect}
          showOpenInPay={wallet.showOpenInPay}
          onConnect={handleConnect}
          onConnectPay={wallet.mobilePayConnect ? handleConnectPay : undefined}
          onDesktopLinked={handleDesktopLinked}
        />
      </div>
    )
  }

  const positionErrorMessage = formatPositionError(position.error)

  // Connected + position loading (first paint)
  if (position.status === 'loading' && !position.envelope) {
    return (
      <div className="home">
        <header className="shell-header page-header">
          <h1 className="page-title">Loading position…</h1>
        </header>
        <section className="nq-card nq-card-lg shell-card home-card" aria-busy="true">
          <p className="home-status" role="status">
            Reading on-chain staking state…
          </p>
          <div className="home-skeleton" aria-hidden="true">
            <span className="so-skeleton-line home-skeleton-line home-skeleton-line--amount" />
            <span className="so-skeleton-line home-skeleton-line home-skeleton-line--narrow" />
            <div className="home-skeleton-stats">
              <span className="so-skeleton-line home-skeleton-line home-skeleton-line--stat" />
              <span className="so-skeleton-line home-skeleton-line home-skeleton-line--stat" />
              <span className="so-skeleton-line home-skeleton-line home-skeleton-line--stat" />
            </div>
            <span className="so-skeleton-line home-skeleton-line home-skeleton-line--section" />
          </div>
          <div className="home-actions">
            <a className="nq-pill-secondary home-cta" href="#/validators">
              Explore validators
            </a>
          </div>
        </section>
      </div>
    )
  }

  // Auth/session missing or RPC failure while connected
  if (position.status === 'error' && !position.envelope) {
    const needsReauth =
      position.error instanceof ApiError &&
      (position.error.code === 'WALLET_NOT_CONNECTED' || position.error.httpStatus === 401)

    return (
      <div className="home">
        <header className="shell-header page-header">
          <h1 className="page-title">{needsReauth ? 'Sign in to continue' : 'Position unavailable'}</h1>
        </header>
        <section className="nq-card nq-card-lg shell-card home-card">
          <p className="home-error" role="alert">
            {positionErrorMessage ??
              (needsReauth
                ? 'Session expired or not established. Connect again to verify your wallet.'
                : 'Could not load staking position.')}
          </p>
          <div className="home-actions">
            {needsReauth ? (
              <button
                type="button"
                className="nq-pill-blue nq-pill-lg home-cta"
                onClick={() => {
                  wallet.disconnect()
                  void wallet.connect()
                }}
              >
                Connect again
              </button>
            ) : (
              <button type="button" className="nq-pill-blue nq-pill-lg home-cta" onClick={position.refresh}>
                Try again
              </button>
            )}
            <a className="nq-pill-secondary home-cta" href="#/validators">
              Explore validators
            </a>
            {wallet.address ? (
              <TestnetFaucetButton address={wallet.address} onFunded={position.refresh} />
            ) : null}
            <button type="button" className="nq-ghost-btn home-cta" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        </section>
      </div>
    )
  }

  const envelope = position.envelope
  if (envelope && isStakedState(envelope.data.state)) {
    return (
      <div className="home">
        {pairBanner}
        <StakedHome
          address={wallet.address}
          envelope={envelope}
          nimiq={wallet.nimiq}
          onRetry={position.refresh}
          onDisconnect={handleDisconnect}
          onPositionChanged={position.refresh}
        />
      </div>
    )
  }

  // NotStaked (or success without envelope edge — treat as empty not-staked)
  return (
    <div className="home">
      {pairBanner}
      <NotStakedHome
        address={wallet.address}
        envelope={envelope}
        loading={position.status === 'loading'}
        errorMessage={positionErrorMessage}
        onRetry={position.refresh}
        onDisconnect={handleDisconnect}
      />
    </div>
  )
}

function formatPositionError(error: Error | null): string | null {
  if (!error) return null
  if (error instanceof ApiError && error.code === 'RPC_UNAVAILABLE') {
    return 'Network data is temporarily unavailable. Your wallet is still connected.'
  }
  return humanizeFetchError(error, 'Could not load staking position.')
}
