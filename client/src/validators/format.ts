/**
 * Display formatters for the validator directory (P1-10).
 * Null / missing / registry -1 → "Insufficient data" (never fake zeros).
 */

export const LUNA_PER_NIM = 100_000

export const INSUFFICIENT_DATA = 'Insufficient data'

/** Official Validator Trust Score is 0–1; null/-1 → insufficient. */
export function formatOfficialScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score) || score < 0) return INSUFFICIENT_DATA
  // Compact percent; avoid fake multi-decimal precision.
  const pct = score * 100
  if (pct >= 99.995) return '100%'
  if (pct >= 10) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(2)}%`
}

/** Dominance ratio 0–1 → percent, or insufficient. */
export function formatDominance(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio) || ratio < 0) return INSUFFICIENT_DATA
  const pct = ratio * 100
  if (pct >= 10) return `${pct.toFixed(2)}%`
  if (pct >= 1) return `${pct.toFixed(2)}%`
  if (pct >= 0.01) return `${pct.toFixed(3)}%`
  return `${pct.toFixed(4)}%`
}

/** Stake in Luna → compact NIM string. */
export function formatStakeNim(stakeLuna: number | null | undefined): string {
  if (stakeLuna == null || !Number.isFinite(stakeLuna) || stakeLuna < 0) {
    return INSUFFICIENT_DATA
  }
  const nim = stakeLuna / LUNA_PER_NIM
  if (nim >= 1_000_000_000) return `${(nim / 1_000_000_000).toFixed(2)}B NIM`
  if (nim >= 1_000_000) return `${(nim / 1_000_000).toFixed(2)}M NIM`
  if (nim >= 1_000) return `${(nim / 1_000).toFixed(1)}k NIM`
  return `${nim.toLocaleString('en-US', { maximumFractionDigits: 2 })} NIM`
}

export function formatStakersCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count) || count < 0) return INSUFFICIENT_DATA
  return count.toLocaleString('en-US')
}

/**
 * Declared fee from registry may be a decimal fraction string ("0.05") or already
 * percent-like. Show as percent when parseable as 0–1 exclusive of whole percents.
 */
export function formatDeclaredFee(fee: string | null | undefined): string {
  if (fee == null || fee.trim() === '') return INSUFFICIENT_DATA
  const n = Number(fee)
  if (!Number.isFinite(n) || n < 0) return fee.trim()
  // Registry stores fractions (0.05 = 5%). Whole numbers ≥1 treated as already percent.
  if (n > 0 && n < 1) {
    const pct = n * 100
    const rounded = Math.round(pct * 100) / 100
    return `${rounded}%`
  }
  if (n === 0) return '0%'
  return `${n}%`
}

export function formatPayoutType(type: 'direct' | 'restake' | 'unknown'): string {
  switch (type) {
    case 'direct':
      return 'Direct payout'
    case 'restake':
      return 'Restake'
    default:
      return 'Unknown'
  }
}

export type FormatMinPayoutInput = {
  nim?: number | null
  kind?: string | null
} | null | undefined

/**
 * Format Steakout-researched min payout for Registry declaration display.
 * fixed → "N NIM"; none → "None"; stake-based / n/a / unknown → labeled or insufficient.
 */
export function formatDeclaredMinPayout(min: FormatMinPayoutInput): string {
  if (min == null || min.kind == null || min.kind === '' || min.kind === 'unknown') {
    return INSUFFICIENT_DATA
  }
  switch (min.kind) {
    case 'fixed': {
      const n = min.nim
      if (n == null || !Number.isFinite(n) || n < 0) return INSUFFICIENT_DATA
      // Prefer compact whole NIM when integer.
      if (Number.isInteger(n)) return `${n} NIM`
      return `${n} NIM`
    }
    case 'none':
      return 'None'
    case 'stake-based':
      return 'Stake-based'
    case 'not_applicable':
      return 'Not applicable'
    default:
      return INSUFFICIENT_DATA
  }
}

export type FormatObservedFloorInput = {
  p5Nim?: number | null
  minNim?: number | null
  status?: string | null
  sampleSize?: number | null
} | null | undefined

/**
 * Format live observed payment floor. Prefer p5; fall back to min.
 * insufficient/unavailable → Insufficient data.
 */
export function formatObservedPaymentFloor(
  floor: FormatObservedFloorInput,
): string {
  if (floor == null) return INSUFFICIENT_DATA
  if (floor.status === 'unavailable' || floor.status === 'insufficient') {
    return INSUFFICIENT_DATA
  }
  const n =
    floor.p5Nim != null && Number.isFinite(floor.p5Nim)
      ? floor.p5Nim
      : floor.minNim != null && Number.isFinite(floor.minNim)
        ? floor.minNim
        : null
  if (n == null || n < 0) return INSUFFICIENT_DATA
  if (n >= 100) return `~${n.toFixed(1)} NIM`
  if (n >= 10) return `~${n.toFixed(2)} NIM`
  if (n >= 1) return `~${n.toFixed(2)} NIM`
  if (n >= 0.01) return `~${n.toFixed(3)} NIM`
  return `~${n.toFixed(4)} NIM`
}

/**
 * Tooltip for directory “Min payout” — declaration first, optional observed
 * floor when inferred (so we do not need a second line on the card).
 */
export function formatMinPayoutTooltip(
  declared: FormatMinPayoutInput,
  floor?: FormatObservedFloorInput,
): string {
  const base =
    'Operator-stated or researched payout threshold (Registry declaration). Not the protocol minimum stake.'
  const observed = formatObservedPaymentFloor(floor)
  if (observed === INSUFFICIENT_DATA) {
    return `${base} Observed floor: insufficient indexed data.`
  }
  return `${base} Observed floor ${observed} (5th percentile of indexed reward outflows; Inferred).`
}

/**
 * @deprecated Prefer StatusChip / OBSERVATION_STATUS_LABELS (P2-09 source of truth).
 * Kept for non-UI formatters and tests.
 */
export function formatObservationStatus(
  status: 'on-schedule' | 'mostly-on-schedule' | 'irregular' | 'insufficient-data' | 'unavailable',
): string {
  switch (status) {
    case 'on-schedule':
      return 'On schedule'
    case 'mostly-on-schedule':
      return 'Mostly on schedule'
    case 'irregular':
      return 'Irregular'
    case 'unavailable':
      return 'Observation unavailable'
    case 'insufficient-data':
    default:
      return 'Not enough observed data'
  }
}

/** Initials for logo fallback (name preferred, else address digits). */
export function validatorInitials(name: string | null, address: string): string {
  const trimmed = name?.trim()
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase()
    }
    return trimmed.slice(0, 2).toUpperCase()
  }
  const compact = address.replace(/\s+/g, '')
  return compact.slice(2, 4) || 'NQ'
}
