/**
 * Payout observation hero: muted Nimiq-blue backdrop graph + expandable timeline.
 * Status remains StatusChip-only (no side-stripe). Graph is decorative density,
 * not a claim about individual unobserved windows.
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

const TIMELINE_LIMIT = 12

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
  /** Keep parent summary in sync when timeline loads. */
  onTimelineMeta?: (meta: {
    status: ObservationStatus
    observedWindows: number | null
    expectedWindows: number | null
    historyDepthDays: number
  }) => void
}

type TimelineState =
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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * Deterministic decorative sparkline heights (0–1) from observation summary.
 * Same inputs → same curve; not a reconstruction of individual windows.
 */
function sparkHeights(
  observed: number | null | undefined,
  expected: number | null | undefined,
  depthDays: number,
  points = 18,
): number[] {
  const rate =
    expected != null &&
    expected > 0 &&
    observed != null &&
    Number.isFinite(observed)
      ? clamp(observed / expected, 0.08, 1)
      : depthDays > 0
        ? 0.35
        : 0.18

  const seed = Math.round((observed ?? 0) * 17 + (expected ?? 0) * 3 + depthDays * 5)
  const out: number[] = []
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1)
    const wave =
      0.55 +
      0.28 * Math.sin(t * Math.PI * 2.1 + (seed % 7) * 0.4) +
      0.12 * Math.sin(t * Math.PI * 5.3 + seed * 0.07)
    const taper = 0.75 + 0.25 * Math.sin(t * Math.PI)
    out.push(clamp(wave * rate * taper, 0.06, 0.95))
  }
  return out
}

function buildAreaPath(heights: number[], width: number, height: number): string {
  if (heights.length === 0) return ''
  const step = width / (heights.length - 1)
  const top = heights
    .map((h, i) => {
      const x = i * step
      const y = height - h * height * 0.88 - height * 0.06
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  return `${top} L${width},${height} L0,${height} Z`
}

function buildLinePath(heights: number[], width: number, height: number): string {
  if (heights.length === 0) return ''
  const step = width / (heights.length - 1)
  return heights
    .map((h, i) => {
      const x = i * step
      const y = height - h * height * 0.88 - height * 0.06
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
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
  observedWindows,
  expectedWindows,
  historyDepthDays,
  lastObservedAt,
  factsLine,
  onOpenFullEvidence,
  onTimelineMeta,
}: ObservationHeroPanelProps) {
  const reactId = useId()
  const panelId = `obs-hero-timeline-${reactId.replace(/:/g, '')}`
  const [expanded, setExpanded] = useState(false)
  const [timeline, setTimeline] = useState<TimelineState>({ kind: 'idle' })
  const onTimelineMetaRef = useRef(onTimelineMeta)
  onTimelineMetaRef.current = onTimelineMeta

  const heights = useMemo(
    () => sparkHeights(observedWindows, expectedWindows, historyDepthDays),
    [observedWindows, expectedWindows, historyDepthDays],
  )

  const areaPath = useMemo(() => buildAreaPath(heights, 240, 72), [heights])
  const linePath = useMemo(() => buildLinePath(heights, 240, 72), [heights])

  const loadTimeline = useCallback(async (signal?: AbortSignal) => {
    setTimeline({ kind: 'loading' })
    try {
      const envelope = await fetchValidatorObservations(address, {
        limit: TIMELINE_LIMIT,
        signal,
      })
      const next: TimelineState = {
        kind: 'ok',
        runs: envelope.data.runs,
        observedWindows: envelope.data.window.observedWindows,
        expectedWindows: envelope.data.window.expectedWindows,
        windowFrom: envelope.data.window.from,
        windowTo: envelope.data.window.to,
        status: envelope.data.observationStatus,
        historyDepthDays: envelope.dataFreshness.historyDepthDays,
      }
      setTimeline(next)
      onTimelineMetaRef.current?.({
        status: next.status,
        observedWindows: next.observedWindows,
        expectedWindows: next.expectedWindows,
        historyDepthDays: next.historyDepthDays,
      })
    } catch (err) {
      if (signal?.aborted) return
      setTimeline({
        kind: 'error',
        message: humanizeFetchError(err, 'Could not load the observation timeline.'),
      })
    }
  }, [address])

  useEffect(() => {
    if (!expanded) return
    if (timeline.kind === 'ok' || timeline.kind === 'loading') return
    const ac = new AbortController()
    void loadTimeline(ac.signal)
    return () => ac.abort()
  }, [expanded, loadTimeline, timeline.kind])

  // Reset cached timeline when navigating to another validator.
  useEffect(() => {
    setExpanded(false)
    setTimeline({ kind: 'idle' })
  }, [address])

  const toggle = () => {
    setExpanded((v) => !v)
  }

  const chipDefinition =
    statusDefinition ?? OBSERVATION_STATUS_DEFINITIONS[status]

  const rangeLabel =
    timeline.kind === 'ok'
      ? formatRange(timeline.windowFrom, timeline.windowTo)
      : lastObservedAt
        ? `Last observed ${formatTimelineWhen(lastObservedAt)}`
        : null

  return (
    <section
      className="nq-card shell-card profile-card profile-card--observation profile-hero-panel profile-obs-hero"
      aria-labelledby="profile-observation"
      data-observation-status={status}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <div className="profile-obs-hero-graph" aria-hidden="true">
        <svg
          className="profile-obs-hero-svg"
          viewBox="0 0 240 72"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient id={`${panelId}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="profile-obs-hero-stop-top" />
              <stop offset="100%" className="profile-obs-hero-stop-bottom" />
            </linearGradient>
          </defs>
          <path
            className="profile-obs-hero-area"
            d={areaPath}
            fill={`url(#${panelId}-fill)`}
          />
          <path className="profile-obs-hero-line" d={linePath} fill="none" />
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
            onClick={toggle}
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
        // Keep closed drawer out of tab order.
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

            {timeline.kind === 'loading' || timeline.kind === 'idle' ? (
              <p className="profile-obs-hero-timeline-status" role="status">
                Loading timeline…
              </p>
            ) : null}

            {timeline.kind === 'error' ? (
              <div className="profile-obs-hero-timeline-error" role="alert">
                <p>{timeline.message}</p>
                <button
                  type="button"
                  className="nq-pill-secondary profile-obs-hero-retry"
                  onClick={() => void loadTimeline()}
                >
                  Try again
                </button>
              </div>
            ) : null}

            {timeline.kind === 'ok' && timeline.runs.length === 0 ? (
              <p className="profile-obs-hero-timeline-status">
                No indexed payout runs in this analysis window yet.
              </p>
            ) : null}

            {timeline.kind === 'ok' && timeline.runs.length > 0 ? (
              <ol className="profile-obs-hero-track">
                {timeline.runs.map((run) => (
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
              Timeline shows indexed runs only. Backdrop graph is a density sketch
              from observed vs expected windows, not a window-by-window record.
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
