/**
 * Public validator directory (P1-10).
 * No wallet required. Lists **listed** registry validators only (unlisted are
 * not shown anywhere in the product UI).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { normalizeAddress } from '../addresses'
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
import DirectoryJump from './DirectoryJump'
import {
  matchesDirectoryQuery,
  readDirectoryLayout,
  validatorDisplayName,
  validatorListId,
  writeDirectoryLayout,
  type DirectoryLayout,
} from './directoryBrowse'
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
  'Recommended puts clearer payout information and the official trust score first.'

function SkeletonCard({ layout }: { layout: DirectoryLayout }) {
  const row = layout === 'list'
  return (
    <div
      className={
        row
          ? 'directory-skeleton directory-skeleton--row'
          : 'directory-skeleton nq-card shell-card'
      }
      aria-hidden="true"
    >
      <div className="directory-skeleton-row">
        <span className="so-skeleton-line directory-skeleton-avatar" />
        <span className="directory-skeleton-lines">
          <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--name" />
          <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--addr" />
        </span>
        <span className="so-skeleton-line directory-skeleton-chip" />
      </div>
      {row ? null : (
        <>
          <div className="directory-skeleton-metrics">
            <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--metric" />
            <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--metric" />
          </div>
          <span className="so-skeleton-line directory-skeleton-line directory-skeleton-line--footer" />
        </>
      )}
    </div>
  )
}

export default function Directory() {
  const sortId = useId()
  const findId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const [sort, setSort] = useState<ValidatorSort>('recommended')
  const [layout, setLayout] = useState<DirectoryLayout>(readDirectoryLayout)
  const [query, setQuery] = useState('')
  const [jumpOpen, setJumpOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
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

  const changeLayout = useCallback((next: DirectoryLayout) => {
    setLayout(next)
    writeDirectoryLayout(next)
  }, [])

  const visibleValidators = useMemo(() => {
    if (state.kind !== 'ready') return []
    return state.validators.filter((v) => matchesDirectoryQuery(v, query))
  }, [state, query])

  const currentValidator = visibleValidators[currentIndex] ?? visibleValidators[0] ?? null

  const pendingJumpRef = useRef<string | null>(null)

  const jumpTo = useCallback(
    (address: string) => {
      const next = visibleValidators.findIndex(
        (v) => normalizeAddress(v.address) === normalizeAddress(address),
      )
      if (next >= 0) setCurrentIndex(next)
      pendingJumpRef.current = address
      setJumpOpen(false)
    },
    [visibleValidators],
  )

  useEffect(() => {
    if (jumpOpen) return
    const address = pendingJumpRef.current
    if (!address) return
    pendingJumpRef.current = null
    const timer = window.setTimeout(() => {
      const el = document.getElementById(validatorListId(address))
      if (!el) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [jumpOpen])

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

  useEffect(() => {
    setCurrentIndex(0)
  }, [sort, query])

  useEffect(() => {
    const root = listRef.current
    if (!root || visibleValidators.length === 0) return

    const nodes = [...root.querySelectorAll<HTMLElement>('[data-directory-index]')]
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        visible.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        )
        const indexAttr = visible[0]?.target.getAttribute('data-directory-index')
        if (indexAttr == null) return
        const next = Number(indexAttr)
        if (Number.isFinite(next)) setCurrentIndex(next)
      },
      {
        root: null,
        rootMargin: '-30% 0px -55% 0px',
        threshold: [0, 0.25, 0.6],
      },
    )
    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [visibleValidators, layout])

  const listClass =
    layout === 'list'
      ? 'directory-list directory-list--rows nq-card shell-card'
      : 'directory-list'

  return (
    <div className="directory">
      <header className="shell-header page-header">
        <h1 className="page-title">Validators</h1>
        <p className="page-lede">
          Browse listed validators and what Steakout has observed about their payouts.
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
              <h2 id="directory-canary-title">How we check validators</h2>
              <p>
                Steakout stakes a little of its own NIM with these validators so we
                can see how payouts actually arrive.
              </p>
            </div>
            <span className="directory-canary-count mono">
              {canaryCoverage.configuredCount.toLocaleString('en-US')} validators
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
          {canaryCoverageFreshness?.status === 'stale' ? (
            <p className="directory-canary-stale" role="status">
              This summary may be out of date. Counts can change after the next update.
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
        <label className="directory-field" htmlFor={findId}>
          <span className="nq-label">Find</span>
          <input
            id={findId}
            type="search"
            className="directory-select nq-input-box"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or address"
            autoComplete="off"
          />
        </label>
        <div className="directory-field">
          <span className="nq-label" id="directory-layout-label">
            Layout
          </span>
          <div
            className="directory-layout-toggle"
            role="group"
            aria-labelledby="directory-layout-label"
          >
            <button
              type="button"
              className="directory-layout-btn"
              aria-pressed={layout === 'list'}
              onClick={() => changeLayout('list')}
            >
              List
            </button>
            <button
              type="button"
              className="directory-layout-btn"
              aria-pressed={layout === 'cards'}
              onClick={() => changeLayout('cards')}
            >
              Cards
            </button>
          </div>
        </div>
      </section>

      {sort === 'recommended' ? (
        <p className="directory-explainer so-notice--info" role="note">
          {RECOMMENDED_EXPLAINER}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <div
          className={listClass}
          role="status"
          aria-busy="true"
          aria-label="Loading validators"
        >
          <SkeletonCard layout={layout} />
          <SkeletonCard layout={layout} />
          <SkeletonCard layout={layout} />
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
            No listed validators right now. Try again in a bit.
          </p>
          <button type="button" className="nq-pill-blue directory-retry" onClick={retry}>
            Refresh
          </button>
        </section>
      ) : null}

      {state.kind === 'ready' && state.validators.length > 0 && visibleValidators.length === 0 ? (
        <section className="nq-card shell-card directory-state" aria-labelledby="directory-filter-empty-title">
          <h2 id="directory-filter-empty-title">No matching validators</h2>
          <p className="directory-state-body">
            Nothing matches that name or address. Clear the search to see the full list.
          </p>
          <button type="button" className="nq-pill-blue directory-retry" onClick={() => setQuery('')}>
            Clear search
          </button>
        </section>
      ) : null}

      {state.kind === 'ready' && visibleValidators.length > 0 ? (
        <>
          <EnvelopeStatusBanner status={state.status} onRetry={retry} />
          <p className="directory-count nq-subline" aria-live="polite">
            {query.trim()
              ? `${visibleValidators.length.toLocaleString('en-US')} matching`
              : `${state.validators.length.toLocaleString('en-US')} ${
                  state.validators.length === 1 ? 'validator' : 'validators'
                }`}
            {state.updatedAt || state.ageSeconds != null ? (
              <>
                {' · '}
                <FreshnessTag
                  updatedAt={state.updatedAt}
                  ageSeconds={state.ageSeconds}
                />
              </>
            ) : null}
            {state.status === 'unavailable' ? ' · listing temporarily unavailable' : null}
          </p>

          {visibleValidators.length > 1 ? (
            <button
              type="button"
              className="directory-locator"
              aria-haspopup="dialog"
              aria-expanded={jumpOpen}
              onClick={() => setJumpOpen(true)}
            >
              <span className="directory-locator-kicker">Jump to a validator</span>
              <span className="directory-locator-copy">
                <span className="mono">
                  {currentIndex + 1} of {visibleValidators.length}
                </span>
                {currentValidator ? (
                  <>
                    {' · '}
                    <span className="directory-locator-name">
                      {validatorDisplayName(currentValidator)}
                    </span>
                  </>
                ) : null}
              </span>
            </button>
          ) : null}

          <ul ref={listRef} className={listClass}>
            {visibleValidators.map((v, index) => (
              <li key={normalizeAddress(v.address)}>
                <div data-directory-index={index}>
                  <ValidatorCard
                    validator={v}
                    layout={layout === 'list' ? 'row' : 'card'}
                  />
                </div>
              </li>
            ))}
          </ul>

          {jumpOpen ? (
            <DirectoryJump
              validators={visibleValidators}
              currentIndex={currentIndex}
              onClose={() => setJumpOpen(false)}
              onJump={jumpTo}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
