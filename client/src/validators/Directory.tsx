/**
 * Public validator directory (P1-10).
 * No wallet required. Lists **listed** registry validators only (unlisted are
 * not shown anywhere in the product UI).
 */
import { useCallback, useEffect, useId, useState } from 'react'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import FreshnessTag from '../components/FreshnessTag'
import { humanizeFetchError } from '../components/humanizeError'
import {
  fetchValidators,
  fetchNetworkSummary,
  peekValidatorsList,
  VALIDATOR_SORTS,
  type ValidatorListItem,
  type ValidatorSort,
  type CanaryCoverageSummary,
} from './api'
import ValidatorCard from './ValidatorCard'
import './Directory.css'

/** Directory always requests the listed registry set. */
const LISTED_ONLY = true

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      validators: ValidatorListItem[]
      status: string
      updatedAt: string
      ageSeconds?: number | null
      /** True while a sort/filter refetch is in flight (keep previous list). */
      refreshing?: boolean
    }

const RECOMMENDED_EXPLAINER =
  'This order prioritizes validators that are easier to understand: a clear payout schedule, payouts you can observe on-chain (direct before restake), Steakout’s observation status when we have it, then lower network share, and finally the official Nimiq Validator Trust Score. It is not financial advice and not a ranking of who is “best.”'

function SkeletonCard() {
  return (
    <div className="directory-skeleton nq-card shell-card" aria-hidden="true">
      <div className="directory-skeleton-row">
        <span className="so-skeleton-line directory-skeleton-avatar" />
        <span className="directory-skeleton-lines">
          <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--name" />
          <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--addr" />
        </span>
        <span className="so-skeleton-line directory-skeleton-chip" />
      </div>
      <div className="directory-skeleton-metrics">
        <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--metric" />
        <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--metric" />
      </div>
      <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--footer" />
    </div>
  )
}

export default function Directory() {
  const sortId = useId()
  const [sort, setSort] = useState<ValidatorSort>('recommended')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [canaryCoverage, setCanaryCoverage] = useState<CanaryCoverageSummary | null>(null)
  const [canaryCoverageFreshness, setCanaryCoverageFreshness] = useState<{
    updatedAt: string
    ageSeconds: number
    status: string
  } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const retry = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    // Instant paint from client cache (warmed by App idle / nav hover).
    const peek = peekValidatorsList(sort, LISTED_ONLY)
    if (peek) {
      setState({
        kind: 'ready',
        validators: peek.envelope.data.validators,
        status: peek.envelope.status,
        updatedAt: peek.envelope.updatedAt,
        ageSeconds: peek.envelope.dataFreshness?.ageSeconds ?? null,
        refreshing: !peek.fresh || reloadToken > 0,
      })
      // Fresh cache and no forced reload: skip network this mount.
      if (peek.fresh && reloadToken === 0) {
        return () => controller.abort()
      }
    } else {
      setState((prev) =>
        prev.kind === 'ready'
          ? { ...prev, refreshing: true }
          : { kind: 'loading' },
      )
    }

    void (async () => {
      try {
        const envelope = await fetchValidators({
          sort,
          listed: LISTED_ONLY,
          signal: controller.signal,
          // Network when cold, stale, or user retry.
          force: true,
        })
        if (controller.signal.aborted) return
        setState({
          kind: 'ready',
          validators: envelope.data.validators,
          status: envelope.status,
          updatedAt: envelope.updatedAt,
          ageSeconds: envelope.dataFreshness?.ageSeconds ?? null,
          refreshing: false,
        })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState((prev) => {
          // Prefer keeping stale list over blanking the page on a soft refresh fail.
          if (prev.kind === 'ready') {
            return { ...prev, refreshing: false }
          }
          return {
            kind: 'error',
            message: humanizeFetchError(err, 'Could not load validators.'),
          }
        })
      }
    })()

    return () => controller.abort()
  }, [sort, reloadToken])

  useEffect(() => {
    const controller = new AbortController()
    void fetchNetworkSummary({ signal: controller.signal, force: reloadToken > 0 })
      .then((envelope) => {
        if (controller.signal.aborted) return
        setCanaryCoverage(envelope.data.canary)
        setCanaryCoverageFreshness({
          updatedAt: envelope.updatedAt,
          ageSeconds: envelope.dataFreshness?.ageSeconds ?? 0,
          status: envelope.status,
        })
      })
      .catch(() => {
        // Coverage is supplemental. Keep the directory usable if its summary is unavailable.
        if (!controller.signal.aborted) setCanaryCoverage(null)
      })
    return () => controller.abort()
  }, [reloadToken])

  return (
    <div className="directory">
      <header className="shell-header page-header">
        <h1 className="page-title">Validators</h1>
        <p className="page-lede">
          Compare listed registry metadata and Steakout observation status. No
          wallet connection required.
        </p>
      </header>

      {canaryCoverage ? (
        <section
          className="directory-canary-coverage nq-card shell-card"
          aria-labelledby="directory-canary-title"
          data-testid="canary-network-coverage"
        >
          <div className="directory-canary-heading">
            <div>
              <h2 id="directory-canary-title">Steakout canary network</h2>
              <p>
                Small controlled stakes that let Steakout check payout paths directly.
                Counts use indexed chain evidence, not validator declarations.
              </p>
            </div>
            <span className="directory-canary-count mono">
              {canaryCoverage.configuredCount.toLocaleString('en-US')} configured
            </span>
          </div>
          <dl className="directory-canary-stats">
            <div>
              <dt>Observed</dt>
              <dd className="mono">{canaryCoverage.statuses.observed}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd className="mono">{canaryCoverage.statuses.pending}</dd>
            </div>
            <div>
              <dt>Unavailable</dt>
              <dd className="mono">{canaryCoverage.statuses.unavailable}</dd>
            </div>
          </dl>
          <p className="directory-canary-footnote">
            Payout paths: {canaryCoverage.payoutTypes.direct} direct ·{' '}
            {canaryCoverage.payoutTypes.restake} restake
            {canaryCoverage.payoutTypes.unknown > 0
              ? ` · ${canaryCoverage.payoutTypes.unknown} unknown`
              : ''}
            {canaryCoverageFreshness ? (
              <>
                {' · '}
                <FreshnessTag
                  updatedAt={canaryCoverageFreshness.updatedAt}
                  ageSeconds={canaryCoverageFreshness.ageSeconds}
                />
              </>
            ) : null}
          </p>
          {canaryCoverageFreshness?.status === 'stale' ? (
            <p className="directory-canary-stale" role="status">
              Indexer data is stale. Pending and unavailable counts may change after the next successful sync.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="directory-controls" aria-label="Directory filters">
        <label className="directory-field" htmlFor={sortId}>
          <span className="nq-label">Sort</span>
          <select
            id={sortId}
            className="directory-select nq-input-box"
            value={sort}
            onChange={(e) => setSort(e.target.value as ValidatorSort)}
          >
            {VALIDATOR_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {sort === 'recommended' ? (
        <p className="directory-explainer so-notice--info" role="note">
          {RECOMMENDED_EXPLAINER}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <div className="directory-list" role="status" aria-busy="true" aria-label="Loading validators">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {state.kind === 'ready' && state.refreshing ? (
        <p className="directory-refreshing" role="status">
          Updating list…
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <section className="nq-card shell-card directory-state" aria-labelledby="directory-error-title">
          <h2 id="directory-error-title">Could not load validators</h2>
          <p className="directory-state-body">{state.message}</p>
          <div className="directory-state-actions">
            <button type="button" className="nq-pill-blue directory-retry" onClick={retry}>
              Try again
            </button>
            <a className="nq-pill-secondary directory-retry" href="#/learn/methodology">
              How observations work
            </a>
          </div>
        </section>
      ) : null}

      {state.kind === 'ready' && state.validators.length === 0 ? (
        <section className="nq-card shell-card directory-state" aria-labelledby="directory-empty-title">
          <h2 id="directory-empty-title">No validators to show</h2>
          <p className="directory-state-body">
            The listed registry set is empty right now. Check back after the next
            sync. Empty is a valid result, not an error.
          </p>
          <button type="button" className="nq-pill-blue directory-retry" onClick={retry}>
            Refresh
          </button>
        </section>
      ) : null}

      {state.kind === 'ready' && state.validators.length > 0 ? (
        <>
          <EnvelopeStatusBanner status={state.status} onRetry={retry} />
          <p className="directory-count nq-subline" aria-live="polite">
            {state.validators.length.toLocaleString('en-US')} listed validator
            {state.validators.length === 1 ? '' : 's'}
            {state.updatedAt || state.ageSeconds != null ? (
              <>
                {' · '}
                <FreshnessTag
                  updatedAt={state.updatedAt}
                  ageSeconds={state.ageSeconds}
                />
              </>
            ) : null}
            {state.status === 'unavailable' ? ' · registry temporarily unavailable' : null}
          </p>
          <ul className="directory-list">
            {state.validators.map((v) => (
              <li key={normalizeListKey(v.address)}>
                <ValidatorCard validator={v} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

function normalizeListKey(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}
