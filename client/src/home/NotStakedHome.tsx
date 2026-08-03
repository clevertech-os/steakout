/**
 * Home — connected, not staked (SPEC §6.1).
 */

import Amount from '../components/Amount'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import FreshnessTag from '../components/FreshnessTag'
import type { StakingPositionEnvelope } from '../api/position'

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
  const balance = envelope?.data.accountBalanceLuna ?? null
  const shortAddress = shortenAddress(address)

  return (
    <>
      <header className="shell-header home-header">
        <h1 className="home-title">Not staked yet</h1>
        <p className="home-lede home-address" title={address}>
          {shortAddress}
        </p>
      </header>

      {envelope ? (
        <EnvelopeStatusBanner status={envelope.status} onRetry={onRetry} />
      ) : null}

      <section className="nq-card nq-card-lg shell-card home-card" aria-labelledby="home-balance-title">
        <p className="card-kicker">Available balance</p>
        <h2 id="home-balance-title" className="visually-hidden">
          Account balance
        </h2>

        {loading && !envelope ? (
          <p className="home-status" role="status">
            Loading balance…
          </p>
        ) : null}

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
          <>
            <p className="home-amount-row">
              <Amount luna={balance} size="lg" label="Available balance" />
            </p>
            {balance == null && envelope ? (
              <p className="nq-subline home-copy">
                Balance unavailable from the read layer right now.
              </p>
            ) : null}
            {envelope ? (
              <FreshnessTag
                updatedAt={envelope.updatedAt}
                ageSeconds={envelope.dataFreshness.ageSeconds}
              />
            ) : null}
          </>
        ) : null}

        <div className="home-estimate">
          <p className="nq-label">Illustrative network estimate</p>
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
          <a className="nq-pill-secondary home-cta" href="#/learn/staking">
            How staking works
          </a>
          <button type="button" className="nq-ghost-btn home-cta" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </section>
    </>
  )
}

function shortenAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 16) return compact
  return `${compact.slice(0, 8)}…${compact.slice(-6)}`
}
