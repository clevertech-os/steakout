/**
 * Observation status chip (METHODOLOGY §3 / STYLING §5).
 * Neutral labels only; never accusatory. Colors from `--so-*` tokens only.
 */
import './StatusChip.css'

export type ObservationStatus =
  | 'on-schedule'
  | 'mostly-on-schedule'
  | 'irregular'
  | 'insufficient-data'
  | 'unavailable'

/** Display labels (METHODOLOGY §3). */
export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  'on-schedule': 'On schedule',
  'mostly-on-schedule': 'Mostly on schedule',
  irregular: 'Irregular',
  'insufficient-data': 'Not enough observed data',
  unavailable: 'Observation unavailable',
}

/**
 * One-sentence definitions for every observation label (P2-09 / METHODOLOGY §3).
 * Shown via title + aria so chips are never bare color blobs.
 */
export const OBSERVATION_STATUS_DEFINITIONS: Record<ObservationStatus, string> = {
  'on-schedule':
    'At least 95% of expected payout windows were observed in the analysis window.',
  'mostly-on-schedule':
    'Between 80% and 95% of expected payout windows were observed in the analysis window.',
  irregular:
    'Fewer than 80% of expected payout windows were observed, with a normalizable schedule and enough history to judge.',
  'insufficient-data':
    'Not enough indexed history or too few windows to judge schedule adherence yet.',
  unavailable:
    'No reward address, indexer gap, or schedule cannot be normalized and no runs are available to show.',
}

/**
 * Tone → STYLING §3 semantic mapping:
 * - verified (green): on-schedule only
 * - warn (gold): mostly-on-schedule, irregular (incomplete)
 * - disabled (neutral): insufficient-data, unavailable
 */
const TONES: Record<ObservationStatus, 'verified' | 'warn' | 'disabled'> = {
  'on-schedule': 'verified',
  'mostly-on-schedule': 'warn',
  irregular: 'warn',
  'insufficient-data': 'disabled',
  unavailable: 'disabled',
}

export interface StatusChipProps {
  status: ObservationStatus
  /** Override the one-sentence definition (title + aria). */
  definition?: string
  className?: string
}

export default function StatusChip({
  status,
  definition,
  className = '',
}: StatusChipProps) {
  const label =
    OBSERVATION_STATUS_LABELS[status] ?? OBSERVATION_STATUS_LABELS['insufficient-data']
  const tone = TONES[status] ?? 'disabled'
  const def =
    definition ??
    OBSERVATION_STATUS_DEFINITIONS[status] ??
    OBSERVATION_STATUS_DEFINITIONS['insufficient-data']

  return (
    <span
      className={`status-chip status-chip--${tone} ${className}`.trim()}
      title={def}
      aria-label={`${label}. ${def}`}
      data-status={status}
    >
      <span className="status-chip-label">{label}</span>
      <span className="status-chip-info" aria-hidden="true">
        i
      </span>
    </span>
  )
}
