/**
 * Public validator directory (P1-10).
 * No wallet required. Fetches GET /api/validators with sort + listed filter.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import { humanizeFetchError } from '../components/humanizeError'
import {
  fetchValidators,
  VALIDATOR_SORTS,
  type ValidatorListItem,
  type ValidatorSort,
} from './api'
import ValidatorCard from './ValidatorCard'
import './Directory.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      validators: ValidatorListItem[]
      status: string
      updatedAt: string
    }

const RECOMMENDED_EXPLAINER =
  'Recommended order uses listed registry presence, normalizable payout schedule, payout observability (direct before restake), live Steakout observation status when available, lower dominance, then the official Nimiq Validator Trust Score. Not financial advice, and not a “best validator” ranking.'

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
  const listedId = useId()
  const [sort, setSort] = useState<ValidatorSort>('recommended')
  const [listedOnly, setListedOnly] = useState(false)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  const retry = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })

    void (async () => {
      try {
        const envelope = await fetchValidators({
          sort,
          listed: listedOnly,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setState({
          kind: 'ready',
          validators: envelope.data.validators,
          status: envelope.status,
          updatedAt: envelope.updatedAt,
        })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({
          kind: 'error',
          message: humanizeFetchError(err, 'Could not load validators.'),
        })
      }
    })()

    return () => controller.abort()
  }, [sort, listedOnly, reloadToken])

  return (
    <div className="directory">
      <header className="shell-header page-header">
        <h1 className="page-title">Validators</h1>
        <p className="page-lede">
          Compare registry metadata and Steakout observation status. No wallet
          connection required.
        </p>
      </header>

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

        <label className="directory-toggle" htmlFor={listedId}>
          <input
            id={listedId}
            type="checkbox"
            className="directory-checkbox"
            checked={listedOnly}
            onChange={(e) => setListedOnly(e.target.checked)}
          />
          <span className="directory-toggle-text">
            <span className="directory-toggle-title">Listed only</span>
            <span className="directory-toggle-hint nq-subline">
              Hide unlisted / uncurated validators
            </span>
          </span>
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
            {listedOnly
              ? 'No listed validators match this view. Turn off “Listed only” to include all observable validators.'
              : 'The registry has not returned any validators yet. Check back after the next sync. Empty is a valid result, not an error.'}
          </p>
          {listedOnly ? (
            <button
              type="button"
              className="nq-pill-secondary directory-retry"
              onClick={() => setListedOnly(false)}
            >
              Show all observable
            </button>
          ) : (
            <button type="button" className="nq-pill-blue directory-retry" onClick={retry}>
              Refresh
            </button>
          )}
        </section>
      ) : null}

      {state.kind === 'ready' && state.validators.length > 0 ? (
        <>
          <EnvelopeStatusBanner
            status={state.status}
            onRetry={retry}
            message={
              state.status === 'stale'
                ? 'Directory snapshot may be outdated. Listing still reflects the last registry sync.'
                : undefined
            }
          />
          <p className="directory-count nq-subline" aria-live="polite">
            {state.validators.length.toLocaleString('en-US')} validator
            {state.validators.length === 1 ? '' : 's'}
            {listedOnly ? ' · listed only' : ' · all observable'}
            {state.status === 'stale' ? ' · stale snapshot' : null}
            {state.status === 'unavailable' ? ' · registry status: unavailable' : null}
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
