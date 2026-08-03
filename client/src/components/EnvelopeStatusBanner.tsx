/**
 * Amber-discipline banner for API envelope status (P3-08).
 * Stale / partial / unavailable — never alarm-red.
 */

import './EnvelopeStatusBanner.css'

export type EnvelopeStatusKind = 'ok' | 'stale' | 'partial' | 'unavailable' | string

export interface EnvelopeStatusBannerProps {
  status: EnvelopeStatusKind
  /** Optional refresh action when data is degraded. */
  onRetry?: () => void
  /** Override default copy for a specific surface. */
  message?: string
  className?: string
}

const DEFAULT_COPY: Record<'stale' | 'partial' | 'unavailable', string> = {
  stale:
    'This data may be outdated. Showing the last known snapshot while live sources catch up.',
  partial: 'Some fields are incomplete. What is shown is still readable; missing pieces are labeled.',
  unavailable:
    'Live network data is temporarily unavailable. Public content may still be shown from cache when available.',
}

/**
 * Renders nothing for fresh (`ok`) envelopes. For degraded statuses, shows a
 * calm warn banner (gold/amber tokens) with optional retry.
 */
export default function EnvelopeStatusBanner({
  status,
  onRetry,
  message,
  className = '',
}: EnvelopeStatusBannerProps) {
  if (status !== 'stale' && status !== 'partial' && status !== 'unavailable') {
    return null
  }

  const body = message ?? DEFAULT_COPY[status]
  const kicker =
    status === 'stale' ? 'Stale data' : status === 'partial' ? 'Partial data' : 'Data unavailable'

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
