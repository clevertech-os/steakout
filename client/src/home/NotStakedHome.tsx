/**
 * Home — connected, not staked (SPEC §6.1).
 */

import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import type { StakingPositionEnvelope } from '../api/position'
import OpenInNimiqPayQr from '../components/OpenInNimiqPayQr'
import DisconnectButton from './DisconnectButton'
import TestnetFaucetButton from './TestnetFaucetButton'
import WalletBalance from './WalletBalance'

export interface NotStakedHomeProps {
  address: string
  envelope: StakingPositionEnvelope | null
  loading: boolean
  errorMessage: string | null
  onRetry: () => void
  onDisconnect: () => void
}

/** Honest placeholder range — never presented as guaranteed APY (METHODOLOGY §7). */
const ILLUSTRATIVE_RANGE = 'roughly a few percent per year, network-wide'

export default function NotStakedHome({
  address,
  envelope,
  loading,
  errorMessage,
  onRetry,
  onDisconnect,
}: NotStakedHomeProps) {
  const data = envelope?.data
  const shortAddress = shortenAddress(address)

  return (
    <>
      <header className="shell-header page-header">
        <div className="home-title-row home-title-row--spread">
          <h1 className="page-title">Not staked yet</h1>
          <DisconnectButton onDisconnect={onDisconnect} />
        </div>
        <p className="page-lede home-address" title={address}>
          {shortAddress}
        </p>
      </header>

      {envelope ? (
        <EnvelopeStatusBanner status={envelope.status} onRetry={onRetry} />
      ) : null}

      <section className="nq-card nq-card-lg shell-card home-card" aria-labelledby="home-balance-title">
        {errorMessage ? (
          <div className="home-error-block">
            <p className="home-error" role="alert">
              {errorMessage}
            </p>
            <button type="button" className="nq-ghost-btn" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}

        {!errorMessage ? (
          <WalletBalance
            accountBalanceLuna={data?.accountBalanceLuna ?? null}
            htlcBalanceLuna={data?.htlcBalanceLuna ?? 0}
            walletBalanceLuna={data?.walletBalanceLuna ?? null}
            htlcCount={data?.htlcCount ?? 0}
            loading={loading && !envelope}
            updatedAt={envelope?.updatedAt}
            ageSeconds={envelope?.dataFreshness.ageSeconds}
          />
        ) : null}

        <div className="home-estimate">
          <p className="nq-label">What staking has looked like</p>
          <p className="home-copy">
            If you stake, network rewards have historically been {ILLUSTRATIVE_RANGE}. This is{' '}
            <strong>not a prediction</strong> for any validator or for your wallet.
          </p>
          <a className="home-method-link" href="#/learn/methodology">
            How we label estimates →
          </a>
        </div>

        <div className="home-actions">
          <a className="nq-pill-blue nq-pill-lg home-cta" href="#/validators">
            Choose a validator
          </a>
          <TestnetFaucetButton address={address} onFunded={onRetry} />
          <a className="nq-pill-secondary home-cta" href="#/learn/staking">
            How staking works
          </a>
        </div>

        {/* Stake-only QR on connected home — session already active here. */}
        <OpenInNimiqPayQr linkDesktopSession={false} className="home-pay-qr" />
      </section>
    </>
  )
}

function shortenAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 16) return compact
  return `${compact.slice(0, 8)}…${compact.slice(-6)}`
}
