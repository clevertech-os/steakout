import './FreshnessTag.css'

export interface FreshnessTagProps {
  /** ISO timestamp when the underlying data was produced. */
  updatedAt?: string | null
  /** Age in seconds from the envelope (preferred when present). */
  ageSeconds?: number | null
  /** Optional history depth for observation metrics. */
  historyDepthDays?: number | null
  className?: string
}

/** Relative age without the "Updated" prefix — e.g. "2 hours ago", "just now". */
export function formatAgeLabel(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 'recently'
  if (ageSeconds < 60) return 'just now'
  const minutes = Math.floor(ageSeconds / 60)
  if (minutes < 60) {
    return minutes === 1 ? '1 min ago' : `${minutes} min ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/** Full freshness phrase — e.g. "Updated 2 hours ago". */
export function formatRelativeAge(ageSeconds: number): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 'Updated recently'
  if (ageSeconds < 60) return 'Updated just now'
  return `Updated ${formatAgeLabel(ageSeconds)}`
}

export function ageSecondsFromIso(iso: string): number | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 1000))
}

/** Prefer envelope ageSeconds; fall back to clock age of updatedAt. */
export function resolveAgeSeconds(
  ageSeconds?: number | null,
  updatedAt?: string | null,
): number | null {
  if (ageSeconds != null && Number.isFinite(ageSeconds) && ageSeconds >= 0) {
    return ageSeconds
  }
  if (updatedAt) return ageSecondsFromIso(updatedAt)
  return null
}

/**
 * Freshness line for timestamped values (STYLING.md §5, METHODOLOGY §8).
 */
export default function FreshnessTag({
  updatedAt,
  ageSeconds,
  historyDepthDays,
  className = '',
}: FreshnessTagProps) {
  const age = resolveAgeSeconds(ageSeconds, updatedAt)

  if (age == null && historyDepthDays == null) {
    return null
  }

  const parts: string[] = []
  if (age != null && Number.isFinite(age)) {
    parts.push(formatRelativeAge(age))
  }
  if (historyDepthDays != null && Number.isFinite(historyDepthDays) && historyDepthDays > 0) {
    const d = Math.floor(historyDepthDays)
    parts.push(d === 1 ? '1 day of history' : `${d} days of history`)
  }

  if (parts.length === 0) return null

  return (
    <span className={`so-freshness ${className}`.trim()} title={updatedAt ?? undefined}>
      {parts.join(' · ')}
    </span>
  )
}
