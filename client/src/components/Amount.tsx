import { formatNimFromLuna } from '../luna'
import './Amount.css'

export interface AmountProps {
  /** Amount in Luna (wire unit). Null → placeholder. */
  luna: number | null | undefined
  /** Append "NIM" unit label (default true). */
  showUnit?: boolean
  /** Larger display for hero totals. */
  size?: 'md' | 'lg'
  className?: string
  /** Accessible label prefix, e.g. "Total staked". */
  label?: string
}

/**
 * NIM amount display (STYLING.md §5). Fira Mono; never wraps mid-number.
 */
export default function Amount({
  luna,
  showUnit = true,
  size = 'md',
  className = '',
  label,
}: AmountProps) {
  const text = formatNimFromLuna(luna)
  const classes = [
    'so-amount',
    size === 'lg' ? 'so-amount--lg' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const content = showUnit && text !== '—' ? `${text} NIM` : text

  return (
    <span
      className={classes}
      title={luna != null && Number.isFinite(luna) ? `${luna} Luna` : undefined}
      aria-label={label ? `${label}: ${content}` : undefined}
    >
      {content}
    </span>
  )
}
