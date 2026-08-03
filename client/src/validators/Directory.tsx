/**
 * Public validator directory (P1-10).
 * No wallet required. Fetches GET /api/validators with sort + listed filter.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import {
  fetchValidators,
  VALIDATOR_SORTS,
  ValidatorsApiError,
  type ValidatorListItem,
  type ValidatorSort,
} from './api'
import ValidatorCard from './ValidatorCard'
import './Directory.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; validators: ValidatorListItem[]; status: string; updatedAt: string }

const RECOMMENDED_EXPLAINER =
  'Recommended order uses listed registry presence, normalizable payout schedule, payout observability (direct before restake), live Steakout observation status when available, lower dominance, then the official Nimiq Validator Trust Score — not financial advice, and not a “best validator” ranking.'

function SkeletonCard() {
  return (
    <div className="directory-skeleton nq-card" aria-hidden="true">
      <div className="directory-skeleton-row">
        <span className="directory-skeleton-avatar" />
        <span className="directory-skeleton-lines">
          <span className="directory-skeleton-line directory-skeleton-line--wide" />
          <span className="directory-skeleton-line directory-skeleton-line--narrow" />
        </span>
      </div>
      <span className="directory-skeleton-line" />
      <span className="directory-skeleton-line directory-skeleton-line--mid" />
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
        const message =
          err instanceof ValidatorsApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not load validators.'
        setState({ kind: 'error', message })
      }
    })()

    return () => controller.abort()
  }, [sort, listedOnly, reloadToken])

  return (
    <div className="directory">
      <header className="shell-header directory-header">
        <p className="eyebrow">Steakout</p>
        <h1>Validators</h1>
        <p className="directory-lede">
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
        <p className="directory-explainer" role="note">
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
        <section className="nq-card directory-state" aria-labelledby="directory-error-title">
          <p className="card-kicker">Unavailable</p>
          <h2 id="directory-error-title">Could not load validators</h2>
          <p className="directory-state-body">{state.message}</p>
          <button type="button" className="nq-pill-blue directory-retry" onClick={retry}>
            Try again
          </button>
        </section>
      ) : null}

      {state.kind === 'ready' && state.validators.length === 0 ? (
        <section className="nq-card directory-state" aria-labelledby="directory-empty-title">
          <p className="card-kicker">Empty</p>
          <h2 id="directory-empty-title">No validators to show</h2>
          <p className="directory-state-body">
            {listedOnly
              ? 'No listed validators match this view. Turn off “Listed only” to include all observable validators.'
              : 'The registry has not returned any validators yet. Check back after the next sync.'}
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
          <p className="directory-count nq-subline" aria-live="polite">
            {state.validators.length.toLocaleString('en-US')} validator
            {state.validators.length === 1 ? '' : 's'}
            {listedOnly ? ' · listed only' : ' · all observable'}
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
