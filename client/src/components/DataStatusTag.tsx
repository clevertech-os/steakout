/**
 * Data provenance tag (METHODOLOGY §2 / STYLING §5).
 * Every accountability metric carries exactly one status.
 * Captions distinguish Registry declaration vs Verified observation (P2-09).
 */
import './DataStatusTag.css'

export type DataStatus =
  | 'verified'
  | 'registry'
  | 'inferred'
  | 'insufficient'
  | 'unavailable'

/** Full captions shown on the tag (METHODOLOGY §2). */
export const DATA_STATUS_LABELS: Record<DataStatus, string> = {
  verified: 'Verified observation',
  registry: 'Registry declaration',
  inferred: 'Inferred',
  insufficient: 'Insufficient data',
  unavailable: 'Unavailable',
}

/** One-sentence definitions for title/aria (P2-09). */
export const DATA_STATUS_DEFINITIONS: Record<DataStatus, string> = {
  verified:
    'Derived from a confirmed on-chain transaction or account state indexed by Steakout.',
  registry:
    'Supplied by the Nimiq validators registry; not independently verified on chain by Steakout.',
  inferred:
    'Computed from observable patterns with stated assumptions; not a direct chain fact.',
  insufficient:
    'Not enough history, or the declared policy cannot be normalized for grading.',
  unavailable:
    'The network or registry did not provide the data needed for this field.',
}

export interface DataStatusTagProps {
  status: DataStatus
  className?: string
}

export default function DataStatusTag({ status, className = '' }: DataStatusTagProps) {
  const label = DATA_STATUS_LABELS[status] ?? DATA_STATUS_LABELS.unavailable
  const definition = DATA_STATUS_DEFINITIONS[status] ?? DATA_STATUS_DEFINITIONS.unavailable

  return (
    <span
      className={`data-status-tag data-status-tag--${status} ${className}`.trim()}
      title={definition}
      aria-label={`${label}. ${definition}`}
      data-status={status}
    >
      <span className="data-status-tag-mark" aria-hidden="true">
        {status === 'verified' ? '✓' : status === 'registry' ? 'R' : '·'}
      </span>
      <span className="data-status-tag-label">{label}</span>
    </span>
  )
}
