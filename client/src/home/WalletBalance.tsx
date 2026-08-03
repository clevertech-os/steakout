/**
 * Pay-aligned wallet balance: total matches Nimiq Pay when HTLCs hold NIM.
 * Free / contracts breakdown + explainer only when the info control is open.
 */

import { useId, useState } from 'react'
import Amount from '../components/Amount'
import FreshnessTag from '../components/FreshnessTag'

export interface WalletBalanceProps {
  /** Free basic balance (null when read failed). */
  accountBalanceLuna: number | null
  htlcBalanceLuna: number
  walletBalanceLuna: number | null
  htlcCount: number
  loading?: boolean
  updatedAt?: string | null
  ageSeconds?: number | null
}

const EXPLAINER =
  'Nimiq Pay may hold NIM in payment contracts (HTLCs) for fast transfers. That still counts as your wallet balance in Pay. Free on-address balance is what new stake amounts use first.'

export default function WalletBalance({
  accountBalanceLuna,
  htlcBalanceLuna,
  walletBalanceLuna,
  loading = false,
  updatedAt,
  ageSeconds,
}: WalletBalanceProps) {
  const [infoOpen, setInfoOpen] = useState(false)
  const detailsId = useId()
  const free = accountBalanceLuna
  const htlc = htlcBalanceLuna > 0 ? htlcBalanceLuna : 0
  const hasContractSplit =
    walletBalanceLuna != null &&
    (htlc > 0 || (free != null && walletBalanceLuna !== free))

  return (
    <div className="home-wallet-balance">
      <div className="home-wallet-balance-head">
        <p className="card-kicker">Wallet balance</p>
        {hasContractSplit ? (
          <button
            type="button"
            className="home-balance-info-btn"
            aria-expanded={infoOpen}
            aria-controls={detailsId}
            onClick={() => setInfoOpen((v) => !v)}
            title={infoOpen ? 'Hide details' : 'Show free vs Pay contracts'}
          >
            <span className="visually-hidden">
              {infoOpen ? 'Hide balance details' : 'Show free vs Pay contracts'}
            </span>
            <span className="home-balance-info-icon" aria-hidden="true">
              i
            </span>
          </button>
        ) : null}
      </div>
      <h2 id="home-balance-title" className="visually-hidden">
        Wallet balance
      </h2>

      {loading ? (
        <p className="home-status" role="status">
          Loading balance…
        </p>
      ) : null}

      <p className="home-amount-row">
        <Amount luna={walletBalanceLuna} size="lg" label="Wallet balance" />
      </p>

      {!loading && (updatedAt != null || ageSeconds != null) ? (
        <p className="home-balance-freshness">
          <FreshnessTag updatedAt={updatedAt} ageSeconds={ageSeconds} />
        </p>
      ) : null}

      {walletBalanceLuna == null && !loading ? (
        <p className="nq-subline home-copy">
          Balance unavailable from the read layer right now.
        </p>
      ) : null}

      {infoOpen && hasContractSplit ? (
        <div id={detailsId} className="home-balance-details">
          <dl className="home-balance-breakdown">
            <div className="home-balance-breakdown-row">
              <dt>Free on address</dt>
              <dd>
                <Amount luna={free} label="Free on address" />
              </dd>
            </div>
            <div className="home-balance-breakdown-row">
              <dt>In Pay contracts</dt>
              <dd>
                <Amount luna={htlc} label="In Pay contracts" />
              </dd>
            </div>
          </dl>
          <p className="home-copy home-copy--muted home-balance-note" role="note">
            {EXPLAINER}
          </p>
        </div>
      ) : hasContractSplit ? (
        <span id={detailsId} hidden />
      ) : null}
    </div>
  )
}
