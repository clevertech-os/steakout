/**
 * Luna ↔ NIM conversion and display helpers.
 * 1 NIM = 100_000 Luna (protocol constant). Amounts cross the wire in Luna.
 */

export const LUNA_PER_NIM = 100_000

export function lunaToNim(luna: number): number {
  return luna / LUNA_PER_NIM
}

export function nimToLuna(nim: number): number {
  return Math.round(nim * LUNA_PER_NIM)
}

export interface FormatNimOptions {
  /** Max fraction digits (default 2). Never invents fake precision beyond this. */
  maxFractionDigits?: number
  /** Show trailing zeros to fixed digits (default false). */
  fixed?: boolean
}

/**
 * Format Luna as a human-readable NIM string without mid-number wraps.
 * Null/undefined → em dash (caller may prefer "Insufficient data").
 */
export function formatNimFromLuna(
  luna: number | null | undefined,
  options: FormatNimOptions = {},
): string {
  if (luna == null || !Number.isFinite(luna)) return '—'
  const maxFrac = options.maxFractionDigits ?? 2
  const nim = lunaToNim(luna)
  const abs = Math.abs(nim)
  let fractionDigits = 0
  if (abs > 0 && abs < 1) fractionDigits = Math.min(maxFrac, 2)
  else if (!Number.isInteger(nim)) fractionDigits = Math.min(maxFrac, 2)

  if (options.fixed) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: maxFrac,
      maximumFractionDigits: maxFrac,
    }).format(nim)
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(nim)
}
