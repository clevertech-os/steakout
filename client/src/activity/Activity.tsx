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
import {
  fetchAlerts,
  fetchWatchlist,
  markAlertRead,
  markAllAlertsRead,
  unwatchValidator,
  watchValidator,
  type UserAlert,
  type WatchlistItem,
} from '../api/alerts'
import { fetchValidators, type ValidatorListItem } from '../validators/api'
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
      <section className="shell-card activity-card" aria-labelledby="activity-empty-title">
        {envelopeStatus ? (
          <EnvelopeStatusBanner status={envelopeStatus} onRetry={onRetry} />
        ) : null}
        <h2 id="activity-empty-title">{emptyTitle}</h2>
        <p className="activity-copy">{emptyBody}</p>
        {emptyActions ? (
          <div className="activity-empty-next activity-actions">{emptyActions}</div>
        ) : null}
      </section>
    )
  }

  return (
    <section className="shell-card activity-card" aria-label="Activity timeline">
      {envelopeStatus ? (
        <EnvelopeStatusBanner status={envelopeStatus} onRetry={onRetry} />
      ) : null}
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
                  aria-label={`View transaction ${item.txHash.slice(0, 10)}… in explorer`}
                >
                  View transaction
                </a>
              ) : null}
              {item.validatorAddress ? (
                <a
                  href={`#/validators/${encodeURIComponent(item.validatorAddress)}`}
                  aria-label={`Open validator record ${item.validatorName?.trim() || shortenAddress(item.validatorAddress)}`}
                >
                  Validator record
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="activity-footnote">
        These events come from the chain. A missing one does not mean something
        went wrong. We may not have enough history yet.
      </p>
    </section>
  )
}

function AlertInbox({ onRefresh }: { onRefresh: () => void }) {
  const [alerts, setAlerts] = useState<UserAlert[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [validators, setValidators] = useState<ValidatorListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    void Promise.all([fetchAlerts(), fetchWatchlist(), fetchValidators({ listed: false })])
      .then(([alertsEnvelope, watchEnvelope, validatorEnvelope]) => {
        setAlerts(alertsEnvelope.data.alerts)
        setWatchlist(watchEnvelope.data.validators)
        setValidators(validatorEnvelope.data.validators)
      })
      .catch((err: unknown) => {
        setError(humanizeFetchError(err, 'Could not load alerts and watched validators.'))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleWatch = useCallback(() => {
    if (!selected || busy) return
    setBusy(true)
    void watchValidator(selected)
      .then((envelope) => {
        setWatchlist(envelope.data.validators)
        setSelected('')
      })
      .catch((err: unknown) => setError(humanizeFetchError(err, 'Could not watch this validator.')))
      .finally(() => setBusy(false))
  }, [busy, selected])

  const handleUnwatch = useCallback((address: string) => {
    if (busy) return
    setBusy(true)
    void unwatchValidator(address)
      .then((envelope) => setWatchlist(envelope.data.validators))
      .catch((err: unknown) => setError(humanizeFetchError(err, 'Could not update your watchlist.')))
      .finally(() => setBusy(false))
  }, [busy])

  const handleRead = useCallback((id: number) => {
    void markAlertRead(id)
      .then((envelope) => setAlerts(envelope.data.alerts))
      .catch((err: unknown) => setError(humanizeFetchError(err, 'Could not mark this alert read.')))
  }, [])

  const handleReadAll = useCallback(() => {
    void markAllAlertsRead()
      .then((envelope) => setAlerts(envelope.data.alerts))
      .catch((err: unknown) => setError(humanizeFetchError(err, 'Could not mark alerts read.')))
  }, [])

  const watchedAddresses = new Set(watchlist.map((item) => item.validatorAddress.replace(/\s+/g, '').toUpperCase()))
  const unread = alerts.filter((alert) => !alert.isRead).length

  return (
    <section className="shell-card activity-card activity-monitor" aria-labelledby="activity-monitor-title">
      <div className="activity-monitor-head">
        <div>
          <p className="card-kicker">Watchlist</p>
          <h2 id="activity-monitor-title">Alerts and watched validators</h2>
        </div>
        {unread > 0 ? <span className="activity-unread">{unread} unread</span> : null}
      </div>
      <p className="activity-copy">
        Steakout looks for payouts and position changes when you open this page.
        A missing alert does not mean a missed payment.
      </p>
      {error ? <p className="activity-error" role="alert">{error}</p> : null}
      {loading ? <p className="activity-status">Loading monitoring…</p> : null}
      {!loading ? (
        <>
          <div className="activity-watch-add">
            <label className="activity-watch-field" htmlFor="activity-watch-validator">
              <span className="nq-label">Watch a validator</span>
              <select
                id="activity-watch-validator"
                className="directory-select nq-input-box"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                disabled={busy || validators.length === 0}
              >
                <option value="">Choose a validator…</option>
                {validators.map((validator) => {
                  const key = validator.address.replace(/\s+/g, '').toUpperCase()
                  return (
                    <option key={validator.address} value={validator.address} disabled={watchedAddresses.has(key)}>
                      {validator.name?.trim() || 'Unnamed validator'}{watchedAddresses.has(key) ? ' (watched)' : ''}
                    </option>
                  )
                })}
              </select>
            </label>
            <button type="button" className="nq-pill-secondary activity-watch-button" onClick={handleWatch} disabled={!selected || busy}>
              Watch
            </button>
          </div>
          {watchlist.length > 0 ? (
            <ul className="activity-watch-list" aria-label="Watched validators">
              {watchlist.map((item) => (
                <li key={item.id}>
                  <a href={`#/validators/${encodeURIComponent(item.validatorAddress)}`}>
                    {item.validatorName?.trim() || 'Validator'}
                  </a>
                  <button type="button" className="activity-inline-button" onClick={() => handleUnwatch(item.validatorAddress)} disabled={busy}>
                    Stop watching
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="activity-monitor-empty">
              Watch a validator to see payout windows and status changes here.
            </p>
          )}
          <div className="activity-alert-head">
            <h3>Recent alerts</h3>
            {unread > 0 ? <button type="button" className="activity-inline-button" onClick={handleReadAll}>Mark all read</button> : null}
          </div>
          {alerts.length > 0 ? (
            <ul className="activity-alert-list" aria-label="Alert inbox">
              {alerts.map((alert) => (
                <li key={alert.id} className={alert.isRead ? 'activity-alert activity-alert--read' : 'activity-alert'}>
                  <div className="activity-alert-top">
                    <strong>{alert.title}</strong>
                    <time dateTime={alert.observedAt}>{formatWhen(alert.observedAt)}</time>
                  </div>
                  <p>{alert.message}</p>
                  {alert.amountLuna != null ? <Amount luna={alert.amountLuna} label="Observed amount" /> : null}
                  {!alert.isRead ? <button type="button" className="activity-inline-button" onClick={() => handleRead(alert.id)}>Mark read</button> : <span className="activity-alert-read-label">Read</span>}
                </li>
              ))}
            </ul>
          ) : <p className="activity-monitor-empty">No alerts have been observed yet. Indexed events will appear here as history accumulates.</p>}
          <button type="button" className="nq-ghost-btn activity-monitor-refresh" onClick={() => { load(); onRefresh() }} disabled={loading}>Refresh monitoring</button>
        </>
      ) : null}
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

  // Personal fetch (auth cookie session). Keep prior items while refreshing.
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
    setPersonalStatus((prev) => (prev === 'success' ? 'success' : 'loading'))
    setPersonalError(null)

    void fetchPersonalActivity()
      .then((data) => {
        if (cancelled) return
        setPersonal(data)
        setPersonalStatus('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPersonalError(err instanceof Error ? err : new Error(String(err)))
        // Keep prior timeline when a refresh fails; error only on first load.
        setPersonalStatus((status) => (status === 'success' ? 'success' : 'error'))
      })

    return () => {
      cancelled = true
    }
  }, [connected, tab, tick])

  // Network feed (public). Keep prior items while refreshing.
  useEffect(() => {
    if (tab !== 'network') return

    let cancelled = false
    setNetworkStatus((prev) => (prev === 'success' ? 'success' : 'loading'))
    setNetworkError(null)

    void fetchNetworkActivity()
      .then((data) => {
        if (cancelled) return
        setNetwork(data)
        setNetworkStatus('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setNetworkError(err instanceof Error ? err : new Error(String(err)))
        setNetworkStatus((status) => (status === 'success' ? 'success' : 'error'))
      })

    return () => {
      cancelled = true
    }
  }, [tab, tick])

  if (!wallet.bootReady) {
    return (
      <div className="activity">
        <header className="shell-header page-header">
          <h1 className="page-title">Activity</h1>
        </header>
        <p className="activity-status" role="status">
          Loading session…
        </p>
        <div className="shell-card activity-skeleton" aria-hidden="true">
          <span className="so-skeleton-line activity-skeleton-line activity-skeleton-line--wide" />
          <span className="so-skeleton-line activity-skeleton-line" />
          <span className="so-skeleton-line activity-skeleton-line activity-skeleton-line--mid" />
        </div>
      </div>
    )
  }

  return (
    <div className="activity">
      <header className="shell-header page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-lede">
          Your staking events, plus recent payouts Steakout has seen across the network.
        </p>
      </header>

      {connected ? <AlertInbox onRefresh={refresh} /> : null}

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
              className="shell-card activity-card"
              aria-labelledby="activity-connect-title"
            >
              <h2 id="activity-connect-title">Connect to see personal activity</h2>
              <p className="activity-copy">
                Connect a wallet to see payouts and staking activity for your
                address. Keys stay in your wallet.
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
                  Browse network payouts
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
            personal ? (
              <TimelineList
                items={personal.data.items}
                envelopeStatus={personal.status}
                onRetry={refresh}
                emptyTitle="Nothing here yet"
                emptyBody="When Steakout sees payouts, stake changes, or staking actions for this wallet, they will show up here. A quiet feed is not a missed payment."
              />
            ) : (
              <div role="status" aria-busy="true" aria-label="Loading personal timeline">
                <p className="activity-status">Loading your timeline…</p>
                <div className="shell-card activity-skeleton" aria-hidden="true">
                  <span className="so-skeleton-line activity-skeleton-line activity-skeleton-line--wide" />
                  <span className="so-skeleton-line activity-skeleton-line" />
                  <span className="so-skeleton-line activity-skeleton-line activity-skeleton-line--mid" />
                </div>
              </div>
            )
          ) : personalStatus === 'error' ? (
            <section className="shell-card activity-card" aria-labelledby="activity-err-title">
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
                  Browse network payouts
                </button>
              </div>
            </section>
          ) : (
            <TimelineList
              items={personal?.data.items ?? []}
              envelopeStatus={personal?.status}
              onRetry={refresh}
              emptyTitle="Nothing here yet"
              emptyBody="When Steakout sees payouts, stake changes, or staking actions for this wallet, they will show up here. A quiet feed is not a missed payment."
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
                    See network payouts
                  </button>
                </>
              }
            />
          )
        ) : networkStatus === 'loading' || networkStatus === 'idle' ? (
          network ? (
            <TimelineList
              items={network.data.items}
              envelopeStatus={network.status}
              onRetry={refresh}
              emptyTitle="No network payouts yet"
              emptyBody="Payouts Steakout has seen across listed validators will appear here. An empty list is not a judgment of any validator."
            />
          ) : (
            <div role="status" aria-busy="true" aria-label="Loading network payouts">
              <p className="activity-status">Loading network payouts…</p>
              <div className="shell-card activity-skeleton" aria-hidden="true">
                <span className="so-skeleton-line activity-skeleton-line activity-skeleton-line--wide" />
                <span className="so-skeleton-line activity-skeleton-line" />
                <span className="so-skeleton-line activity-skeleton-line activity-skeleton-line--mid" />
              </div>
            </div>
          )
        ) : networkStatus === 'error' ? (
          <section className="shell-card activity-card" aria-labelledby="activity-net-err">
            <h2 id="activity-net-err">Could not load network payouts</h2>
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
            emptyTitle="No network payouts yet"
            emptyBody="Payouts Steakout has seen across listed validators will appear here. An empty list is not a judgment of any validator."
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
