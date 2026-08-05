/**
 * Payout observation hero: muted Nimiq-blue payment-spike chart (by date) +
 * expandable timeline. Status stays on StatusChip (no side-stripe).
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import StatusChip, {
  OBSERVATION_STATUS_DEFINITIONS,
  type ObservationStatus,
} from '../components/StatusChip'
import { humanizeFetchError } from '../components/humanizeError'
import {
  fetchValidatorObservations,
  type ObservationRunItem,
} from './api'
import './ObservationHeroPanel.css'

/** Runs loaded for the chart; timeline list shows the newest subset. */
const FETCH_LIMIT = 48
const TIMELINE_LIST_LIMIT = 12

const CHART_W = 320
const CHART_H = 80

export interface ObservationHeroPanelProps {
  address: string
  status: ObservationStatus
  /** Override chip definition when parent has context (e.g. non-normalizable). */
  statusDefinition?: string
  observedWindows?: number | null
  expectedWindows?: number | null
  historyDepthDays: number
  lastObservedAt: string | null
  factsLine: string | null
  /** Opens the full payout-evidence disclosure further down the profile. */
  onOpenFullEvidence?: () => void
  /** Keep parent summary in sync when runs load. */
  onTimelineMeta?: (meta: {
    status: ObservationStatus
    observedWindows: number | null
    expectedWindows: number | null
    historyDepthDays: number
  }) => void
}

type RunsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ok'
      runs: ObservationRunItem[]
      observedWindows: number
      expectedWindows: number
      windowFrom: string | null
      windowTo: string | null
      status: ObservationStatus
      historyDepthDays: number
    }

interface ChartSpike {
  x: number
  yTip: number
  yBase: number
  weight: number
}

interface ChartModel {
  spikes: ChartSpike[]
  baselineY: number
  /** Soft fill under spikes (may be empty). */
  areaPath: string
  /** Polyline connecting spike tips for readability when dense. */
  ridgePath: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * Build a date-axis spike chart from observed payout runs.
 * X = windowStart time (oldest → newest left → right).
 * Spike height ∝ txCount in that run (honest magnitude, not decorative wave).
 */
function buildPaymentSpikeChart(
  runs: readonly ObservationRunItem[],
  width: number,
  height: number,
): ChartModel {
  const padX = 10
  const padTop = 8
  const baselineY = height - 6
  const usableW = width - padX * 2
  const maxBar = baselineY - padTop

  const events = runs
    .map((run) => {
      const t = Date.parse(run.windowStart)
      const weight = Number.isFinite(run.txCount) ? Math.max(1, run.txCount) : 1
      return { t, weight }
    })
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t)

  if (events.length === 0) {
    return {
      spikes: [],
      baselineY,
      areaPath: '',
      ridgePath: '',
    }
  }

  let tMin = events[0]!.t
  let tMax = events[events.length - 1]!.t
  // Single run: center it with a day of padding so the axis still reads as time.
  if (tMax <= tMin) {
    const day = 24 * 60 * 60 * 1000
    tMin -= day
    tMax += day
  }
  const span = tMax - tMin
  const maxWeight = Math.max(...events.map((e) => e.weight), 1)

  const spikes: ChartSpike[] = events.map((e) => {
    const x = padX + ((e.t - tMin) / span) * usableW
    // sqrt so huge multi-tx runs do not dominate the card.
    const h = Math.sqrt(e.weight / maxWeight) * maxBar * 0.92
    const yTip = baselineY - clamp(h, maxBar * 0.12, maxBar)
    return { x, yTip, yBase: baselineY, weight: e.weight }
  })

  // Soft area: baseline → tips left-to-right → back along baseline.
  const ridge =
    spikes.length === 0
      ? ''
      : spikes
          .map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x.toFixed(2)},${s.yTip.toFixed(2)}`)
          .join(' ')
  const areaPath =
    spikes.length === 0
      ? ''
      : `${ridge} L${spikes[spikes.length - 1]!.x.toFixed(2)},${baselineY} L${spikes[0]!.x.toFixed(2)},${baselineY} Z`

  return {
    spikes,
    baselineY,
    areaPath,
    ridgePath: ridge,
  }
}

function formatTimelineWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRange(from: string | null, to: string | null): string | null {
  if (!from && !to) return null
  const a = from ? formatTimelineWhen(from) : null
  const b = to ? formatTimelineWhen(to) : null
  if (a && b) return `${a} → ${b}`
  return a ?? b
}

export default function ObservationHeroPanel({
  address,
  status,
  statusDefinition,
  historyDepthDays,
  lastObservedAt,
  factsLine,
  onOpenFullEvidence,
  onTimelineMeta,
}: ObservationHeroPanelProps) {
  const reactId = useId()
  const panelId = `obs-hero-timeline-${reactId.replace(/:/g, '')}`
  const gradId = `${panelId}-fill`
  const [expanded, setExpanded] = useState(false)
  const [runsState, setRunsState] = useState<RunsState>({ kind: 'idle' })
  const onTimelineMetaRef = useRef(onTimelineMeta)
  onTimelineMetaRef.current = onTimelineMeta

  const loadRuns = useCallback(
    async (signal?: AbortSignal) => {
      setRunsState({ kind: 'loading' })
      try {
        const envelope = await fetchValidatorObservations(address, {
          limit: FETCH_LIMIT,
          signal,
        })
        const next: RunsState = {
          kind: 'ok',
          runs: envelope.data.runs,
          observedWindows: envelope.data.window.observedWindows,
          expectedWindows: envelope.data.window.expectedWindows,
          windowFrom: envelope.data.window.from,
          windowTo: envelope.data.window.to,
          status: envelope.data.observationStatus,
          historyDepthDays: envelope.dataFreshness.historyDepthDays,
        }
        setRunsState(next)
        onTimelineMetaRef.current?.({
          status: next.status,
          observedWindows: next.observedWindows,
          expectedWindows: next.expectedWindows,
          historyDepthDays: next.historyDepthDays,
        })
      } catch (err) {
        if (signal?.aborted) return
        setRunsState({
          kind: 'error',
          message: humanizeFetchError(
            err,
            'Could not load the observation timeline.',
          ),
        })
      }
    },
    [address],
  )

  // Load payout runs on mount so the date-axis graph is real payment spikes.
  useEffect(() => {
    const ac = new AbortController()
    void loadRuns(ac.signal)
    return () => ac.abort()
  }, [loadRuns])

  useEffect(() => {
    setExpanded(false)
    setRunsState({ kind: 'idle' })
  }, [address])

  const chart = useMemo(() => {
    const runs = runsState.kind === 'ok' ? runsState.runs : []
    return buildPaymentSpikeChart(runs, CHART_W, CHART_H)
  }, [runsState])

  const listRuns = useMemo(() => {
    if (runsState.kind !== 'ok') return []
    // API returns newest-first typically; keep that for the timeline list.
    return runsState.runs.slice(0, TIMELINE_LIST_LIMIT)
  }, [runsState])

  const chipDefinition =
    statusDefinition ?? OBSERVATION_STATUS_DEFINITIONS[status]

  const rangeLabel =
    runsState.kind === 'ok'
      ? formatRange(runsState.windowFrom, runsState.windowTo)
      : lastObservedAt
        ? `Last observed ${formatTimelineWhen(lastObservedAt)}`
        : null

  const chartEmpty =
    runsState.kind === 'ok' && runsState.runs.length === 0
  const chartReady = runsState.kind === 'ok' && chart.spikes.length > 0

  return (
    <section
      className="nq-card shell-card profile-card profile-card--observation profile-hero-panel profile-obs-hero"
      aria-labelledby="profile-observation"
      data-observation-status={status}
      data-expanded={expanded ? 'true' : 'false'}
      data-chart={chartReady ? 'ready' : chartEmpty ? 'empty' : 'pending'}
    >
      <div className="profile-obs-hero-graph" aria-hidden="true">
        <svg
          className="profile-obs-hero-svg"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="profile-obs-hero-stop-top" />
              <stop offset="100%" className="profile-obs-hero-stop-bottom" />
            </linearGradient>
          </defs>

          {/* Baseline (time axis) */}
          <line
            className="profile-obs-hero-baseline"
            x1={8}
            y1={chart.baselineY}
            x2={CHART_W - 8}
            y2={chart.baselineY}
          />

          {chartReady ? (
            <>
              {chart.areaPath ? (
                <path
                  className="profile-obs-hero-area"
                  d={chart.areaPath}
                  fill={`url(#${gradId})`}
                />
              ) : null}
              {chart.ridgePath ? (
                <path
                  className="profile-obs-hero-ridge"
                  d={chart.ridgePath}
                  fill="none"
                />
              ) : null}
              {chart.spikes.map((s, i) => (
                <g key={`spike-${i}`} className="profile-obs-hero-spike">
                  <line
                    className="profile-obs-hero-stem"
                    x1={s.x}
                    y1={s.yBase}
                    x2={s.x}
                    y2={s.yTip}
                  />
                  <circle
                    className="profile-obs-hero-tip"
                    cx={s.x}
                    cy={s.yTip}
                    r={1.8}
                  />
                </g>
              ))}
            </>
          ) : null}
        </svg>
      </div>

      <div className="profile-obs-hero-main">
        <h2 id="profile-observation" className="profile-hero-label">
          Payout observation
        </h2>
        <div className="profile-observation-chip">
          <StatusChip
            status={status}
            alwaysShowDefinition
            definition={chipDefinition}
          />
        </div>
        {factsLine ? (
          <p className="profile-hero-caption mono">{factsLine}</p>
        ) : null}

        <div className="profile-obs-hero-actions">
          <button
            type="button"
            className="profile-obs-hero-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{expanded ? 'Hide timeline' : 'Timeline'}</span>
            <span
              className="profile-obs-hero-chevron"
              data-open={expanded ? 'true' : 'false'}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <div
        id={panelId}
        className="profile-obs-hero-drawer"
        data-open={expanded ? 'true' : 'false'}
        inert={!expanded}
      >
        <div className="profile-obs-hero-drawer-inner">
          <div className="profile-obs-hero-timeline">
            <p className="profile-obs-hero-timeline-kicker">
              Observed payout runs
              {rangeLabel ? (
                <span className="profile-obs-hero-timeline-range mono">
                  {' '}
                  · {rangeLabel}
                </span>
              ) : null}
            </p>

            {runsState.kind === 'loading' || runsState.kind === 'idle' ? (
              <p className="profile-obs-hero-timeline-status" role="status">
                Loading timeline…
              </p>
            ) : null}

            {runsState.kind === 'error' ? (
              <div className="profile-obs-hero-timeline-error" role="alert">
                <p>{runsState.message}</p>
                <button
                  type="button"
                  className="nq-pill-secondary profile-obs-hero-retry"
                  onClick={() => void loadRuns()}
                >
                  Try again
                </button>
              </div>
            ) : null}

            {runsState.kind === 'ok' && listRuns.length === 0 ? (
              <p className="profile-obs-hero-timeline-status">
                No indexed payout runs in this analysis window yet.
              </p>
            ) : null}

            {runsState.kind === 'ok' && listRuns.length > 0 ? (
              <ol className="profile-obs-hero-track">
                {listRuns.map((run) => (
                  <li
                    key={`${run.windowStart}-${run.txHashes[0] ?? run.windowEnd}-${run.txCount}`}
                    className="profile-obs-hero-node"
                  >
                    <span className="profile-obs-hero-dot" aria-hidden="true" />
                    <div className="profile-obs-hero-node-body">
                      <time
                        className="profile-obs-hero-node-when mono"
                        dateTime={run.windowStart}
                      >
                        {formatTimelineWhen(run.windowStart)}
                      </time>
                      <p className="profile-obs-hero-node-meta">
                        {run.txCount.toLocaleString()} tx
                        {run.txCount === 1 ? '' : 's'}
                        {' · '}
                        {run.recipientCount.toLocaleString()} recipient
                        {run.recipientCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}

            <p className="profile-obs-hero-footnote">
              Graph plots indexed payout runs by time. Spike height reflects
              transaction count in each run
              {historyDepthDays > 0
                ? ` over about ${Math.floor(historyDepthDays)} days of history`
                : ''}
              .
            </p>

            {onOpenFullEvidence ? (
              <button
                type="button"
                className="profile-obs-hero-full-link"
                onClick={onOpenFullEvidence}
              >
                Open full payout evidence
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
