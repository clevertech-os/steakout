/**
 * Amber-discipline banner for API envelope status (P3-08).
 * Partial / unavailable only — never alarm-red.
 * Stale is intentionally not shown here; surfaces use last-updated / FreshnessTag.
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

const DEFAULT_COPY: Record<'partial' | 'unavailable', string> = {
  partial: 'Some details are missing. What you see is still from the registry and chain.',
  unavailable:
    'Live network data is temporarily unavailable. Cached information may still appear.',
}

/**
 * Renders nothing for fresh (`ok`) and `stale` envelopes.
 * For partial / unavailable, shows a calm warn banner with optional retry.
 */
export default function EnvelopeStatusBanner({
  status,
  onRetry,
  message,
  className = '',
}: EnvelopeStatusBannerProps) {
  if (status !== 'partial' && status !== 'unavailable') {
    return null
  }

  const body = message ?? DEFAULT_COPY[status]
  const kicker = status === 'partial' ? 'Some data incomplete' : 'Temporarily unavailable'

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
