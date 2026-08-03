/**
 * Activity destination — personal timeline + network observation feed (P2-10).
 *
 * Personal: authenticated session only. Network: public, always available.
 * Neutral language throughout (observed / not observed / insufficient data).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  fetchNetworkActivity,
  fetchPersonalActivity,
  type ActivityEnvelope,
  type ActivityItem,
} from '../api/activity'
import { ApiError } from '../api/http'
import { walletAuthApi } from '../api/walletAuth'
import Amount from '../components/Amount'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import { humanizeFetchError } from '../components/humanizeError'
import { buildNimiqExplorerUrl } from '../explorer'
import { useWallet } from '../wallet/useWallet'
import './Activity.css'

type TabId = 'personal' | 'network'
type LoadStatus = 'idle' | 'loading' | 'success' | 'error'

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return iso
  }
}

function shortenAddress(address: string): string {
  const clean = address.replace(/\s+/g, '')
  if (clean.length <= 16) return clean
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`
}

function statusPhrase(status: string): string {
  switch (status) {
    case 'observed':
      return 'Observed'
    case 'verified':
      return 'Verified observation'
    case 'pending':
      return 'Pending'
    case 'confirmed':
      return 'Confirmed'
    case 'failed':
      return 'Failed'
    case 'expired':
      return 'Expired'
    default:
      return status
  }
}

function itemTitle(item: ActivityItem): string {
  if (item.type === 'observed-position-growth') {
    return item.growthLabel ?? item.label ?? 'Observed position growth'
  }
  return item.label || item.type
}

function TimelineList({
  items,
  emptyTitle,
  emptyBody,
  emptyActions,
  envelopeStatus,
  onRetry,
}: {
  items: ActivityItem[]
  emptyTitle: string
  emptyBody: string
  emptyActions?: ReactNode
  envelopeStatus?: string
  onRetry?: () => void
}) {
  if (items.length === 0) {
    return (
      <section className="activity-card" aria-labelledby="activity-empty-title">
        {envelopeStatus ? (
          <EnvelopeStatusBanner status={envelopeStatus} onRetry={onRetry} />
        ) : null}
        <p className="card-kicker">Timeline</p>
        <h2 id="activity-empty-title">{emptyTitle}</h2>
        <p className="activity-copy">{emptyBody}</p>
        {emptyActions ? (
          <div className="activity-empty-next activity-actions">{emptyActions}</div>
        ) : null}
      </section>
    )
  }

  return (
    <section className="activity-card" aria-label="Activity timeline">
      {envelopeStatus ? (
        <EnvelopeStatusBanner status={envelopeStatus} onRetry={onRetry} />
      ) : null}
      <p className="card-kicker">Timeline</p>
      <ul className="activity-list">
        {items.map((item, index) => (
          <li
            key={`${item.type}-${item.at}-${item.txHash ?? index}-${item.validatorAddress ?? ''}`}
            className="activity-item"
          >
            <div className="activity-item-top">
              <p className="activity-item-label">{itemTitle(item)}</p>
              <p className="activity-item-time">
                <time dateTime={item.at}>{formatWhen(item.at)}</time>
              </p>
            </div>

            {item.amountLuna != null ? (
              <p className="activity-item-amount">
                <Amount
                  luna={item.amountLuna}
                  label={
                    item.type === 'observed-position-growth'
                      ? 'Observed growth'
                      : 'Amount'
                  }
                />
              </p>
            ) : null}

            {item.validatorName || item.validatorAddress ? (
              <p className="activity-item-meta">
                {item.validatorName?.trim() || 'Validator'}
                {item.validatorAddress
                  ? ` · ${shortenAddress(item.validatorAddress)}`
                  : null}
              </p>
            ) : null}

            {item.type === 'payout-run' &&
            (item.txCount != null || item.recipientCount != null) ? (
              <p className="activity-item-meta">
                {item.txCount != null ? `${item.txCount} tx` : null}
                {item.txCount != null && item.recipientCount != null
                  ? ' · '
                  : null}
                {item.recipientCount != null
                  ? `${item.recipientCount} recipient${item.recipientCount === 1 ? '' : 's'}`
                  : null}
              </p>
            ) : null}

            <span className="activity-item-status">{statusPhrase(item.status)}</span>

            <div className="activity-item-links">
              {item.txHash ? (
                <a
                  href={buildNimiqExplorerUrl(item.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View transaction
                </a>
              ) : null}
              {item.validatorAddress ? (
                <a
                  href={`#/validators/${encodeURIComponent(item.validatorAddress)}`}
                >
                  Validator record
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="activity-footnote">
        Observations are based on indexed chain data. A missing entry does not
        prove wrongdoing — it may mean insufficient history or data not yet
        indexed.
      </p>
    </section>
  )
}

export default function Activity() {
  const wallet = useWallet({ auth: walletAuthApi })
  const connected =
    wallet.bootReady && wallet.status === 'connected' && Boolean(wallet.address)

  const [tab, setTab] = useState<TabId>('personal')
  const [personalStatus, setPersonalStatus] = useState<LoadStatus>('idle')
  const [personal, setPersonal] = useState<ActivityEnvelope | null>(null)
  const [personalError, setPersonalError] = useState<Error | null>(null)
  const [networkStatus, setNetworkStatus] = useState<LoadStatus>('idle')
  const [network, setNetwork] = useState<ActivityEnvelope | null>(null)
  const [networkError, setNetworkError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setTick((n) => n + 1)
  }, [])

  const handleConnect = useCallback(() => {
    void wallet.connect()
  }, [wallet])

  // Default tab: personal when connected, network when disconnected.
  useEffect(() => {
    if (!wallet.bootReady) return
    if (!connected && tab === 'personal') {
      setTab('network')
    }
  }, [wallet.bootReady, connected, tab])

  // Personal fetch (auth cookie session).
  useEffect(() => {
    if (!connected || tab !== 'personal') {
      if (!connected) {
        setPersonalStatus('idle')
        setPersonal(null)
        setPersonalError(null)
      }
      return
    }

    let cancelled = false
    setPersonalStatus('loading')
    setPersonalError(null)

    void fetchPersonalActivity()
      .then((data) => {
        if (cancelled) return
        setPersonal(data)
        setPersonalStatus('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPersonal(null)
        setPersonalError(err instanceof Error ? err : new Error(String(err)))
        setPersonalStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [connected, tab, tick])

  // Network feed (public).
  useEffect(() => {
    if (tab !== 'network') return

    let cancelled = false
    setNetworkStatus('loading')
    setNetworkError(null)

    void fetchNetworkActivity()
      .then((data) => {
        if (cancelled) return
        setNetwork(data)
        setNetworkStatus('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setNetwork(null)
        setNetworkError(err instanceof Error ? err : new Error(String(err)))
        setNetworkStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [tab, tick])

  if (!wallet.bootReady) {
    return (
      <div className="activity">
        <header className="shell-header activity-header">
          <p className="eyebrow">Steakout</p>
          <h1 className="activity-title">Activity</h1>
        </header>
        <p className="activity-status" role="status">
          Loading session…
        </p>
        <div className="activity-skeleton" aria-hidden="true">
          <span className="activity-skeleton-line activity-skeleton-line--wide" />
          <span className="activity-skeleton-line" />
          <span className="activity-skeleton-line activity-skeleton-line--mid" />
        </div>
      </div>
    )
  }

  return (
    <div className="activity">
      <header className="shell-header activity-header">
        <p className="eyebrow">Steakout</p>
        <h1 className="activity-title">Activity</h1>
        <p className="activity-lede">
          Personal staking events and network payout observations — from indexed
          chain data, labeled observed / not observed / insufficient data.
        </p>
      </header>

      <div className="activity-tabs" role="tablist" aria-label="Activity views">
        <button
          type="button"
          role="tab"
          className="activity-tab"
          aria-selected={tab === 'personal'}
          id="activity-tab-personal"
          onClick={() => setTab('personal')}
        >
          Personal
        </button>
        <button
          type="button"
          role="tab"
          className="activity-tab"
          aria-selected={tab === 'network'}
          id="activity-tab-network"
          onClick={() => setTab('network')}
        >
          Network
        </button>
      </div>

      <div
        role="tabpanel"
        aria-labelledby={
          tab === 'personal' ? 'activity-tab-personal' : 'activity-tab-network'
        }
      >
        {tab === 'personal' ? (
          !connected ? (
            <section
              className="activity-card"
              aria-labelledby="activity-connect-title"
            >
              <p className="card-kicker">Your timeline</p>
              <h2 id="activity-connect-title">Connect to see personal activity</h2>
              <p className="activity-copy">
                Connect a wallet to load observed direct payouts, position
                changes, and staking actions for your address. No private keys
                leave your device.
              </p>
              <div className="activity-actions">
                <button
                  type="button"
                  className="nq-pill-blue nq-pill-lg activity-cta"
                  onClick={handleConnect}
                  disabled={wallet.connecting}
                >
                  {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
                </button>
                <button
                  type="button"
                  className="nq-pill-secondary activity-cta"
                  onClick={() => setTab('network')}
                >
                  Browse network feed
                </button>
                <a className="nq-ghost-btn activity-cta" href="#/validators">
                  Explore validators
                </a>
              </div>
              {wallet.error ? (
                <p className="activity-error" role="alert">
                  {wallet.error}
                </p>
              ) : null}
            </section>
          ) : personalStatus === 'loading' || personalStatus === 'idle' ? (
            <div role="status" aria-busy="true" aria-label="Loading personal timeline">
              <p className="activity-status">Loading your timeline…</p>
              <div className="activity-skeleton" aria-hidden="true">
                <span className="activity-skeleton-line activity-skeleton-line--wide" />
                <span className="activity-skeleton-line" />
                <span className="activity-skeleton-line activity-skeleton-line--mid" />
              </div>
            </div>
          ) : personalStatus === 'error' ? (
            <section className="activity-card" aria-labelledby="activity-err-title">
              <p className="card-kicker">Personal</p>
              <h2 id="activity-err-title">Could not load timeline</h2>
              <p className="activity-copy">
                {personalError instanceof ApiError &&
                personalError.code === 'WALLET_NOT_CONNECTED'
                  ? 'Session expired or not established. Connect again to verify your wallet.'
                  : humanizeFetchError(
                      personalError,
                      'Something went wrong loading personal activity.',
                    )}
              </p>
              <div className="activity-actions">
                <button
                  type="button"
                  className="nq-pill-blue activity-cta"
                  onClick={refresh}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="nq-pill-secondary activity-cta"
                  onClick={handleConnect}
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  className="nq-ghost-btn activity-cta"
                  onClick={() => setTab('network')}
                >
                  Browse network feed
                </button>
              </div>
            </section>
          ) : (
            <TimelineList
              items={personal?.data.items ?? []}
              envelopeStatus={personal?.status}
              onRetry={refresh}
              emptyTitle="No personal activity observed yet"
              emptyBody="Steakout has not indexed direct payouts, observed position growth, or staking actions for this address yet. That is insufficient data — not a claim that rewards were missed or withheld. History may still be accumulating."
              emptyActions={
                <>
                  <a className="nq-pill-blue activity-cta" href="#/validators">
                    Find a validator
                  </a>
                  <a className="nq-pill-secondary activity-cta" href="#/">
                    Check your position
                  </a>
                  <button
                    type="button"
                    className="nq-ghost-btn activity-cta"
                    onClick={() => setTab('network')}
                  >
                    View network observations
                  </button>
                </>
              }
            />
          )
        ) : networkStatus === 'loading' || networkStatus === 'idle' ? (
          <div role="status" aria-busy="true" aria-label="Loading network observations">
            <p className="activity-status">Loading network observations…</p>
            <div className="activity-skeleton" aria-hidden="true">
              <span className="activity-skeleton-line activity-skeleton-line--wide" />
              <span className="activity-skeleton-line" />
              <span className="activity-skeleton-line activity-skeleton-line--mid" />
            </div>
          </div>
        ) : networkStatus === 'error' ? (
          <section className="activity-card" aria-labelledby="activity-net-err">
            <p className="card-kicker">Network</p>
            <h2 id="activity-net-err">Could not load network feed</h2>
            <p className="activity-copy">
              {humanizeFetchError(
                networkError,
                'Network activity is temporarily unavailable.',
              )}
            </p>
            <div className="activity-actions">
              <button
                type="button"
                className="nq-pill-blue activity-cta"
                onClick={refresh}
              >
                Retry
              </button>
              <a className="nq-pill-secondary activity-cta" href="#/validators">
                Browse validators
              </a>
            </div>
          </section>
        ) : (
          <TimelineList
            items={network?.data.items ?? []}
            envelopeStatus={network?.status}
            onRetry={refresh}
            emptyTitle="No network observations yet"
            emptyBody="Observed payout runs will appear here once the indexer has classified activity for listed validators. Insufficient data is a valid result — not an error and not a judgment of any validator."
            emptyActions={
              <>
                <a className="nq-pill-blue activity-cta" href="#/validators">
                  Browse validators
                </a>
                <a className="nq-ghost-btn activity-cta" href="#/learn/methodology">
                  How observations work
                </a>
              </>
            }
          />
        )}
      </div>
    </div>
  )
}
