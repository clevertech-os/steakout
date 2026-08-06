/**
 * Amber-discipline banner for API envelope status (P3-08).
 * Stale / partial / unavailable — never alarm-red. Copy is calm notice, not error.
 */

import { formatAgeLabel, resolveAgeSeconds } from './FreshnessTag'
import './EnvelopeStatusBanner.css'

export type EnvelopeStatusKind = 'ok' | 'stale' | 'partial' | 'unavailable' | string

export interface EnvelopeStatusBannerProps {
  status: EnvelopeStatusKind
  /** Optional refresh action when data is degraded. */
  onRetry?: () => void
  /** Override default copy for a specific surface. */
  message?: string
  /** Envelope age — used for default stale copy when message is omitted. */
  ageSeconds?: number | null
  /** ISO timestamp fallback when ageSeconds is missing. */
  updatedAt?: string | null
  className?: string
}

/** Human stale notice with relative age when known. */
export function humanStaleMessage(
  ageSeconds?: number | null,
  updatedAt?: string | null,
  surface = 'This snapshot',
): string {
  const age = resolveAgeSeconds(ageSeconds, updatedAt)
  if (age == null) {
    return `${surface} may lag live network data. You're still seeing the last good snapshot while Steakout catches up.`
  }
  // Short ages are usually response-cache SWR, not a broken indexer.
  if (age < 5 * 60) {
    return `${surface} was last checked ${formatAgeLabel(age)}. A background refresh may still be running — what you see is the last good snapshot.`
  }
  if (age < 90 * 60) {
    return `Last updated ${formatAgeLabel(age)}. ${surface} can lag the newest chain scan by up to a couple of hours; the listing below is still the last good snapshot.`
  }
  return `Last updated ${formatAgeLabel(age)}. Live indexing may be behind schedule, so ${surface.toLowerCase()} still reflects the last successful sync. You can keep browsing this snapshot or refresh to check again.`
}

const DEFAULT_PARTIAL =
  'Some fields are incomplete. What is shown is still readable; missing pieces are labeled.'
const DEFAULT_UNAVAILABLE =
  'Live network data is temporarily unavailable. Public content may still be shown from cache when available.'

/**
 * Renders nothing for fresh (`ok`) envelopes. For degraded statuses, shows a
 * calm warn banner (gold/amber tokens) with optional retry.
 */
export default function EnvelopeStatusBanner({
  status,
  onRetry,
  message,
  ageSeconds,
  updatedAt,
  className = '',
}: EnvelopeStatusBannerProps) {
  if (status !== 'stale' && status !== 'partial' && status !== 'unavailable') {
    return null
  }

  const body =
    message ??
    (status === 'stale'
      ? humanStaleMessage(ageSeconds, updatedAt)
      : status === 'partial'
        ? DEFAULT_PARTIAL
        : DEFAULT_UNAVAILABLE)

  const kicker =
    status === 'stale'
      ? 'May not be current'
      : status === 'partial'
        ? 'Some data incomplete'
        : 'Temporarily unavailable'

  return (
    <p
      className={`so-envelope-banner so-envelope-banner--${status} ${className}`.trim()}
      role="status"
      data-envelope-status={status}
    >
      <span className="so-envelope-banner-kicker">{kicker}</span>
      <span className="so-envelope-banner-body">{body}</span>
      {onRetry ? (
        <button type="button" className="nq-ghost-btn so-envelope-banner-retry" onClick={onRetry}>
          Refresh
        </button>
      ) : null}
    </p>
  )
}
