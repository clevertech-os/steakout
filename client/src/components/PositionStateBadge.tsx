import type { PositionState } from '../api/position'
import './PositionStateBadge.css'

export interface PositionStateBadgeProps {
  state: PositionState
  className?: string
}

const LABELS: Record<PositionState, string> = {
  NotStaked: 'Not staked',
  Pending: 'Pending',
  Active: 'Active',
  Inactive: 'Inactive',
  Retiring: 'Retiring',
  Withdrawable: 'Withdrawable',
}

/**
 * Position lifecycle badge — distinct from validator observation colors
 * (STYLING.md §5 PositionStateBadge).
 */
export default function PositionStateBadge({ state, className = '' }: PositionStateBadgeProps) {
  const modifier = state.toLowerCase()
  const label = LABELS[state]
  const definition = 'Staker position status from on-chain account state'
  return (
    <span
      className={`so-position-badge so-position-badge--${modifier} ${className}`.trim()}
      title={definition}
      aria-label={`${label}. ${definition}`}
    >
      {label}
    </span>
  )
}
