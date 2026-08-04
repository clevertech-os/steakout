/**
 * Observation status chip (METHODOLOGY §3 / STYLING §5).
 * Neutral labels only; never accusatory. Colors from `--so-*` tokens only.
 *
 * Definition is available on tap/click (mobile-safe) — native `title` alone
 * does not work on touch devices.
 */
import { useId, useState } from 'react'
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
 */
export const OBSERVATION_STATUS_DEFINITIONS: Record<ObservationStatus, string> = {
  'on-schedule':
    'At least 95% of expected payout windows were observed in the analysis period.',
  'mostly-on-schedule':
    'Between 80% and 95% of expected payout windows were observed in the analysis period.',
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
  /** Override the one-sentence definition. */
  definition?: string
  /**
   * When true, always show the definition under the chip (hero surfaces).
   * When false (default), definition toggles via the info control.
   */
  alwaysShowDefinition?: boolean
  className?: string
}

export default function StatusChip({
  status,
  definition,
  alwaysShowDefinition = false,
  className = '',
}: StatusChipProps) {
  const label =
    OBSERVATION_STATUS_LABELS[status] ?? OBSERVATION_STATUS_LABELS['insufficient-data']
  const tone = TONES[status] ?? 'disabled'
  const def =
    definition ??
    OBSERVATION_STATUS_DEFINITIONS[status] ??
    OBSERVATION_STATUS_DEFINITIONS['insufficient-data']
  const defId = useId()
  const [open, setOpen] = useState(false)
  const showDef = alwaysShowDefinition || open

  return (
    <span className={`status-chip-wrap ${className}`.trim()} data-status={status}>
      <span
        className={`status-chip status-chip--${tone}`}
        data-status={status}
      >
        <span className="status-chip-label">{label}</span>
        {alwaysShowDefinition ? null : (
          <button
            type="button"
            className="status-chip-info"
            aria-expanded={open}
            aria-controls={defId}
            aria-label={open ? 'Hide status definition' : 'Show status definition'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOpen((v) => !v)
            }}
          >
            i
          </button>
        )}
      </span>
      {showDef ? (
        <span id={defId} className="status-chip-definition" role="note">
          {def}
        </span>
      ) : null}
    </span>
  )
}
