/**
 * Validator profile evidence layer (P2-08 / SPEC §6.3 / STYLING §5).
 * Payout-run list, history depth, methodology limitations.
 * Quieter when embedded under Profile progressive disclosure.
 */
import { useCallback, useEffect, useState } from 'react'
import DataStatusTag from '../components/DataStatusTag'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import FreshnessTag from '../components/FreshnessTag'
import { humanizeFetchError } from '../components/humanizeError'
import StatusChip, { type ObservationStatus } from '../components/StatusChip'
import { buildNimiqExplorerUrl } from '../explorer'
import {
  fetchValidatorObservations,
  type ObservationRunItem,
  type ObservationsEnvelope,
} from './api'
import './Evidence.css'

/** Machine keys from API → one-sentence neutral copy (METHODOLOGY §7). */
const LIMITATION_COPY: Record<string, string> = {
  'observed-recipient-coverage-is-not-proof-of-full-payout':
    'Observed recipient coverage is not proof of a full payout to every staker.',
  'consolidation-may-aggregate-multiple-stakers':
    'A single recipient address may receive a consolidated payment for multiple stakers.',
  'payout-threshold-may-exclude-stakers':
    'Declared payout thresholds may exclude some stakers from a given run.',
  'registry-staker-list-may-be-incomplete':
    'The registry staker list may be incomplete or out of date.',
  'analysis-covers-indexed-history-only':
    'Analysis covers indexed history only. Activity before indexing started is not observed.',
  'missing-payment-does-not-prove-wrongdoing':
    'A payment not observed in a window does not prove wrongdoing.',
  'schedule-cannot-be-normalized':
    'The declared schedule cannot be normalized, so no adherence grade is shown. Only raw observed runs are listed.',
  'insufficient-history':
    'Indexed history is still short; treat any status as provisional.',
}

function limitationText(key: string): string {
  return (
    LIMITATION_COPY[key] ??
    key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  )
}

function formatWindowRange(start: string, end: string): string {
  const a = formatIsoShort(start)
  const b = formatIsoShort(end)
  if (a && b) return `${a} → ${b}`
  return a ?? b ?? 'Window time unavailable'
}

function formatIsoShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function formatDepthDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return 'Insufficient data'
  const rounded = Math.floor(days * 10) / 10
  if (rounded < 1) return '< 1 day'
  if (Number.isInteger(rounded) || Math.abs(rounded - Math.round(rounded)) < 0.05) {
    const n = Math.round(rounded)
    return n === 1 ? '1 day' : `${n} days`
  }
  return `${rounded.toFixed(1)} days`
}

function shortHash(hash: string): string {
  const clean = hash.replace(/^0x/i, '')
  if (clean.length <= 12) return clean
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}

const RUN_DEFINITION =
  'Outbound transactions from the reward address grouped into a payout run (60-minute window).'
const COVERAGE_DEFINITION =
  'Distinct recipients in this run that also appear in the known staker set when available. Not proof of full payout.'

export interface EvidenceRowProps {
  run: ObservationRunItem
}

/**
 * One payout run: window, recipients, coverage when known, explorer tx links.
 * Stacked layout — no tables (works at 320px). Quieter: no per-run def/freshness.
 */
export function EvidenceRow({ run }: EvidenceRowProps) {
  const hasCoverage =
    run.knownStakersCovered != null &&
    run.knownStakersTotal != null &&
    Number.isFinite(run.knownStakersCovered) &&
    Number.isFinite(run.knownStakersTotal)

  const txHashes = Array.isArray(run.txHashes) ? run.txHashes : []
  const showHashes = txHashes.slice(0, 4)
  const extraCount = Math.max(0, txHashes.length - showHashes.length)

  return (
    <article className="evidence-row" aria-label={`Payout run ${formatIsoShort(run.windowStart) ?? ''}`}>
      <p className="evidence-row-window mono" title={RUN_DEFINITION}>
        {formatWindowRange(run.windowStart, run.windowEnd)}
      </p>

      <dl className="evidence-row-stats">
        <div className="evidence-row-stat">
          <dt className="nq-label">Recipients</dt>
          <dd className="evidence-row-stat-value mono">
            {Number.isFinite(run.recipientCount)
              ? run.recipientCount.toLocaleString()
              : '—'}
          </dd>
        </div>
        <div className="evidence-row-stat">
          <dt className="nq-label">Transactions</dt>
          <dd className="evidence-row-stat-value mono">
            {Number.isFinite(run.txCount) ? run.txCount.toLocaleString() : '—'}
          </dd>
        </div>
        <div className="evidence-row-stat">
          <dt className="nq-label" title={COVERAGE_DEFINITION}>
            Observed recipient coverage
          </dt>
          <dd className="evidence-row-stat-value mono">
            {hasCoverage
              ? `${run.knownStakersCovered!.toLocaleString()} / ${run.knownStakersTotal!.toLocaleString()}`
              : 'Insufficient data'}
          </dd>
        </div>
        {run.blockRange?.[0] != null && run.blockRange?.[1] != null ? (
          <div className="evidence-row-stat">
            <dt className="nq-label">Blocks</dt>
            <dd className="evidence-row-stat-value mono">
              {run.blockRange[0].toLocaleString()}–{run.blockRange[1].toLocaleString()}
            </dd>
          </div>
        ) : null}
      </dl>

      {showHashes.length > 0 ? (
        <div className="evidence-row-txs">
          <p className="nq-label">Explorer links</p>
          <ul className="evidence-tx-list">
            {showHashes.map((hash) => (
              <li key={hash}>
                <a
                  className="nq-arrow evidence-tx-link mono"
                  href={buildNimiqExplorerUrl(hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {shortHash(hash)}
                </a>
              </li>
            ))}
          </ul>
          {extraCount > 0 ? (
            <p className="evidence-tx-more nq-subline">
              +{extraCount.toLocaleString()} more transaction
              {extraCount === 1 ? '' : 's'} in this run
            </p>
          ) : null}
        </div>
      ) : (
        <p className="evidence-row-no-tx nq-subline">No transaction hashes for this run.</p>
      )}
    </article>
  )
}

/** Summary facts for a parent Profile `<details>` closed line. */
export interface EvidenceSummaryMeta {
  status: ObservationStatus
  windowsLabel: string | null
  historyDepthDays: number
}

export interface EvidenceProps {
  /** Validator address (spaced or compact). */
  address: string
  /**
   * When true, omit outer card chrome/title (Profile wraps in `<details>`).
   * Still fetches on mount so the parent summary can show windows.
   */
  embedded?: boolean
  /**
   * Profile-level observation status from GET /api/validators/:address.
   * Used as fallback while evidence loads; evidence envelope may refine it.
   */
  profileStatus?: ObservationStatus
  profileHistoryDepthDays?: number
  profileLastObservedAt?: string | null
  /** Report status/windows for closed disclosure summary (optional). */
  onSummaryMeta?: (meta: EvidenceSummaryMeta) => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; envelope: ObservationsEnvelope; runs: ObservationRunItem[] }

/**
 * Full evidence section for the validator profile: status, analysis window,
 * scrollable payout-run list, methodology limitations, collection timestamp.
 */
export default function Evidence({
  address,
  embedded = false,
  profileStatus = 'insufficient-data',
  profileHistoryDepthDays = 0,
  profileLastObservedAt = null,
  onSummaryMeta,
}: EvidenceProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const retry = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    setNextCursor(null)

    void (async () => {
      try {
        const envelope = await fetchValidatorObservations(address, {
          signal: controller.signal,
          limit: 25,
        })
        if (controller.signal.aborted) return
        setNextCursor(envelope.data.nextCursor)
        setState({
          kind: 'ok',
          envelope,
          runs: envelope.data.runs,
        })
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({
          kind: 'error',
          message: humanizeFetchError(err, 'Could not load payout observations.'),
        })
      }
    })()

    return () => controller.abort()
  }, [address, reloadToken])

  // While loading / on error, still report profile-level summary to parent.
  useEffect(() => {
    if (!onSummaryMeta) return
    if (state.kind === 'ok') return
    onSummaryMeta({
      status: profileStatus,
      windowsLabel: null,
      historyDepthDays: profileHistoryDepthDays,
    })
  }, [onSummaryMeta, profileHistoryDepthDays, profileStatus, state.kind])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || state.kind !== 'ok') return
    setLoadingMore(true)
    try {
      const envelope = await fetchValidatorObservations(address, {
        cursor: nextCursor,
        limit: 25,
      })
      setNextCursor(envelope.data.nextCursor)
      setState({
        kind: 'ok',
        envelope: {
          ...state.envelope,
          // Keep first-page freshness; append only runs.
          updatedAt: state.envelope.updatedAt,
          dataFreshness: state.envelope.dataFreshness,
          data: {
            ...state.envelope.data,
            nextCursor: envelope.data.nextCursor,
          },
        },
        runs: [...state.runs, ...envelope.data.runs],
      })
    } catch {
      // Leave existing runs; user can retry via main error path on refresh.
    } finally {
      setLoadingMore(false)
    }
  }, [address, loadingMore, nextCursor, state])

  if (state.kind === 'loading') {
    const body = (
      <>
        {!embedded ? (
          <>
            <p className="card-kicker">Steakout observation</p>
            <h2 id="evidence-title" className="profile-section-title">
              Payout evidence
            </h2>
            <div className="evidence-status-block">
              <StatusChip status={profileStatus} />
              {profileHistoryDepthDays > 0 ? (
                <FreshnessTag historyDepthDays={profileHistoryDepthDays} />
              ) : null}
            </div>
          </>
        ) : null}
        <p className="evidence-status" role="status">
          Loading observed payout runs…
        </p>
        <div className="evidence-skeleton" aria-hidden="true">
          <span className="so-skeleton-line evidence-skeleton-line evidence-skeleton-line--wide" />
          <span className="so-skeleton-line evidence-skeleton-line" />
          <span className="so-skeleton-line evidence-skeleton-line evidence-skeleton-line--mid" />
        </div>
      </>
    )

    if (embedded) {
      return (
        <div className="evidence evidence--embedded" aria-busy="true">
          {body}
        </div>
      )
    }

    return (
      <section
        className="nq-card shell-card profile-card profile-card--observation evidence"
        aria-labelledby="evidence-title"
        aria-busy="true"
        data-observation-status={profileStatus}
      >
        {body}
      </section>
    )
  }

  if (state.kind === 'error') {
    const body = (
      <>
        {!embedded ? (
          <>
            <p className="card-kicker">Steakout observation</p>
            <h2 id="evidence-title" className="profile-section-title">
              Payout evidence
            </h2>
          </>
        ) : null}
        <p className="nq-subline profile-section-note">{state.message}</p>
        <div className="evidence-empty so-notice--info">
          <DataStatusTag status="unavailable" />
          <button type="button" className="nq-pill-blue evidence-retry" onClick={retry}>
            Try again
          </button>
        </div>
        <p className="profile-limitations-link">
          <a className="nq-arrow" href="#/learn/methodology">
            Methodology
          </a>
          {' · '}
          <a className="nq-arrow" href="#/learn/limitations">
            Limitations
          </a>
        </p>
      </>
    )

    if (embedded) {
      return <div className="evidence evidence--embedded">{body}</div>
    }

    return (
      <section
        className="nq-card shell-card profile-card profile-card--observation evidence"
        aria-labelledby="evidence-title"
      >
        {body}
      </section>
    )
  }

  const { envelope, runs } = state
  const { data, dataFreshness, updatedAt } = envelope
  const normalizable = data.schedule.normalizable === true
  const historyDepthDays = dataFreshness.historyDepthDays ?? profileHistoryDepthDays
  const ageSeconds = dataFreshness.ageSeconds
  const empty = runs.length === 0

  // When schedule cannot be normalized: show raw runs only — no adherence grade.
  const showGrade = normalizable
  const status: ObservationStatus = showGrade
    ? data.observationStatus
    : empty
      ? 'unavailable'
      : 'insufficient-data'

  const windowsLabel =
    normalizable && data.window.expectedWindows > 0
      ? `${data.window.observedWindows.toLocaleString()} / ${data.window.expectedWindows.toLocaleString()} windows`
      : data.window.observedWindows > 0
        ? `${data.window.observedWindows.toLocaleString()} observed window${data.window.observedWindows === 1 ? '' : 's'}`
        : null

  const analysisRange =
    data.window.from && data.window.to
      ? formatWindowRange(data.window.from, data.window.to)
      : null

  return (
    <EvidenceOkBody
      embedded={embedded}
      envelope={envelope}
      runs={runs}
      showGrade={showGrade}
      status={status}
      windowsLabel={windowsLabel}
      historyDepthDays={historyDepthDays}
      ageSeconds={ageSeconds}
      empty={empty}
      analysisRange={analysisRange}
      updatedAt={updatedAt}
      data={data}
      profileLastObservedAt={profileLastObservedAt}
      nextCursor={nextCursor}
      loadingMore={loadingMore}
      onLoadMore={() => void loadMore()}
      onRetry={retry}
      onSummaryMeta={onSummaryMeta}
    />
  )
}

function EvidenceOkBody({
  embedded,
  envelope,
  runs,
  showGrade,
  status,
  windowsLabel,
  historyDepthDays,
  ageSeconds,
  empty,
  analysisRange,
  updatedAt,
  data,
  profileLastObservedAt,
  nextCursor,
  loadingMore,
  onLoadMore,
  onRetry,
  onSummaryMeta,
}: {
  embedded: boolean
  envelope: ObservationsEnvelope
  runs: ObservationRunItem[]
  showGrade: boolean
  status: ObservationStatus
  windowsLabel: string | null
  historyDepthDays: number
  ageSeconds: number
  empty: boolean
  analysisRange: string | null
  updatedAt: string
  data: ObservationsEnvelope['data']
  profileLastObservedAt: string | null
  nextCursor: string | null
  loadingMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onSummaryMeta?: (meta: EvidenceSummaryMeta) => void
}) {
  useEffect(() => {
    onSummaryMeta?.({
      status,
      windowsLabel,
      historyDepthDays,
    })
  }, [onSummaryMeta, status, windowsLabel, historyDepthDays])

  const windowsDisplay = windowsLabel ?? 'Insufficient data'

  const body = (
    <>
      <EnvelopeStatusBanner
        status={envelope.status}
        onRetry={onRetry}
        message={
          envelope.status === 'stale'
            ? 'Observation data may be outdated. Showing the last indexed payout runs.'
            : undefined
        }
      />
      {!embedded ? (
        <>
          <p className="card-kicker">Steakout observation</p>
          <h2 id="evidence-title" className="profile-section-title">
            Payout evidence
          </h2>
        </>
      ) : null}

      <div className="evidence-status-block">
        {showGrade ? (
          <StatusChip
            status={status}
            definition="Observation status compares the declared payout schedule against indexed payout runs. Insufficient history is a valid result, not a negative score."
          />
        ) : (
          <span
            className="status-chip status-chip--disabled"
            title="Declared schedule is free-text or ambiguous; Steakout does not grade it."
          >
            Schedule cannot be normalized
          </span>
        )}
        {/* One section-level freshness (not per metric / per run). */}
        <FreshnessTag
          ageSeconds={ageSeconds}
          updatedAt={updatedAt}
          historyDepthDays={historyDepthDays}
        />
      </div>

      <p className="nq-subline profile-section-note">
        {showGrade
          ? 'Status is based on indexed chain activity against the declared schedule. Every run links to explorer transactions. Insufficient history is a valid result, not a failure.'
          : 'This validator’s declared schedule is free-text or ambiguous, so Steakout shows raw observed payout runs only. No adherence grade is applied.'}
      </p>

      <dl className="evidence-summary">
        <div className="evidence-summary-item">
          <div className="evidence-summary-head">
            <dt className="nq-label" title="How many days of indexed history support this view.">
              History depth
            </dt>
            <DataStatusTag
              status={historyDepthDays > 0 ? 'verified' : 'insufficient'}
            />
          </div>
          <dd className="evidence-summary-value">{formatDepthDays(historyDepthDays)}</dd>
        </div>

        <div className="evidence-summary-item">
          <div className="evidence-summary-head">
            <dt
              className="nq-label"
              title="Observed payout windows versus expected windows from the normalized schedule, when available."
            >
              {showGrade ? 'Windows observed' : 'Runs observed'}
            </dt>
            <DataStatusTag
              status={
                data.window.observedWindows > 0
                  ? showGrade
                    ? 'inferred'
                    : 'verified'
                  : 'insufficient'
              }
            />
          </div>
          <dd className="evidence-summary-value mono">{windowsDisplay}</dd>
        </div>

        <div className="evidence-summary-item">
          <div className="evidence-summary-head">
            <dt className="nq-label" title="Declared payout cadence from the registry.">
              Declared schedule
            </dt>
            <DataStatusTag status="registry" />
          </div>
          <dd className="evidence-summary-value">
            {data.schedule.declared?.trim() ||
              (data.schedule.normalized
                ? `Every ${data.schedule.normalized.everyHours} hours`
                : 'Not declared')}
          </dd>
        </div>

        {analysisRange ? (
          <div className="evidence-summary-item">
            <div className="evidence-summary-head">
              <dt className="nq-label" title="Time span of the analysis window used for adherence.">
                Analysis window
              </dt>
              <DataStatusTag status="verified" />
            </div>
            <dd className="evidence-summary-value mono evidence-summary-value--sm">
              {analysisRange}
            </dd>
          </div>
        ) : null}

        <div className="evidence-summary-item">
          <div className="evidence-summary-head">
            <dt
              className="nq-label"
              title="Most recent payout-related activity Steakout has indexed for this validator."
            >
              Last observed activity
            </dt>
            <DataStatusTag
              status={
                profileLastObservedAt || data.window.to ? 'verified' : 'insufficient'
              }
            />
          </div>
          <dd className="evidence-summary-value mono evidence-summary-value--sm">
            {formatIsoShort(profileLastObservedAt ?? data.window.to) ??
              'Not observed yet'}
          </dd>
        </div>
      </dl>

      <div className="evidence-runs-header">
        <h3 className="evidence-runs-title">Observed payout runs</h3>
        <DataStatusTag status={empty ? 'insufficient' : 'verified'} />
      </div>

      {empty ? (
        <div
          className="evidence-empty"
          role="status"
          data-testid="evidence-empty"
        >
          <p className="evidence-empty-label">Insufficient data</p>
          <p className="nq-subline">
            No payout runs have been indexed for this validator yet. That is a valid
            result, not a negative score or failure.
          </p>
          <StatusChip
            status={status === 'unavailable' ? 'unavailable' : 'insufficient-data'}
            definition="Empty history means Steakout has not yet observed outbound payout activity from the reward address."
          />
        </div>
      ) : (
        <div
          className="evidence-run-list nq-curtain-y nq-scrollbar-sm"
          role="list"
          aria-label="Observed payout runs"
        >
          {runs.map((run, index) => (
            <div role="listitem" key={`${run.windowStart}-${run.txHashes[0] ?? index}`}>
              <EvidenceRow run={run} />
            </div>
          ))}
        </div>
      )}

      {nextCursor ? (
        <button
          type="button"
          className="nq-pill-secondary evidence-load-more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Load more runs'}
        </button>
      ) : null}

      <div className="evidence-limitations" aria-labelledby="evidence-limitations-title">
        <h3 id="evidence-limitations-title" className="evidence-limitations-title">
          Methodology &amp; limitations
        </h3>
        <p className="nq-subline evidence-limitations-lede">
          Evidence is descriptive only. Missing activity never proves wrongdoing.
        </p>
        <ul className="evidence-limitations-list">
          {(data.limitations.length > 0
            ? data.limitations
            : ['analysis-covers-indexed-history-only']
          ).map((key) => (
            <li key={key}>{limitationText(key)}</li>
          ))}
        </ul>
        <p className="profile-limitations-link">
          <a className="nq-arrow" href="#/learn/methodology">
            Full methodology
          </a>
          {' · '}
          <a className="nq-arrow" href="#/learn/limitations">
            Limitations
          </a>
        </p>
      </div>
    </>
  )

  if (embedded) {
    return <div className="evidence evidence--embedded">{body}</div>
  }

  return (
    <section
      className="nq-card shell-card profile-card profile-card--observation evidence"
      aria-labelledby="evidence-title"
    >
      {body}
    </section>
  )
}
