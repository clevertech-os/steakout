/**
 * Steakout-curated minimum payout declarations (not in official validators-api).
 *
 * Loaded from `server/config/min-payout-declarations.json` (or MIN_PAYOUT_DECLARATIONS_PATH).
 * Research source of truth: `docs/research/min-payout-amounts.json` — copy into
 * server config after updates so production deploys include the data.
 *
 * Caption as Registry declaration when shown (operator-stated / researched),
 * never as a Verified observation.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAddress } from './addresses.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PATH = join(MODULE_DIR, '../config/min-payout-declarations.json')

export type MinPayoutKind =
  | 'fixed'
  | 'none'
  | 'stake-based'
  | 'not_applicable'
  | 'unknown'

export type MinPayoutConfidence = 'high' | 'medium' | 'low'

/** API + list/profile `declared.minPayout` shape. */
export interface DeclaredMinPayout {
  /** Fixed threshold in NIM when kind is `fixed`; otherwise null. */
  nim: number | null
  kind: MinPayoutKind
  /** Research confidence; null when unknown / not checked. */
  confidence: MinPayoutConfidence | null
}

interface RawRow {
  validatorAddress?: unknown
  validatorAddressCompact?: unknown
  minPayoutNim?: unknown
  minPayoutKind?: unknown
  confidence?: unknown
}

let cachedPath: string | null = null
let byCompact: Map<string, DeclaredMinPayout> | null = null

function resolvePath(): string {
  const fromEnv = process.env.MIN_PAYOUT_DECLARATIONS_PATH?.trim()
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : join(process.cwd(), fromEnv)
  }
  return DEFAULT_PATH
}

function asKind(value: unknown): MinPayoutKind {
  if (
    value === 'fixed' ||
    value === 'none' ||
    value === 'stake-based' ||
    value === 'not_applicable' ||
    value === 'unknown'
  ) {
    return value
  }
  return 'unknown'
}

function asConfidence(value: unknown): MinPayoutConfidence | null {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return null
}

function asNim(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

function rowToDeclared(raw: RawRow): DeclaredMinPayout {
  const kind = asKind(raw.minPayoutKind)
  const nim = kind === 'fixed' ? asNim(raw.minPayoutNim) : null
  return {
    nim: kind === 'fixed' ? nim : null,
    kind,
    confidence: asConfidence(raw.confidence),
  }
}

/**
 * Load (and cache) min-payout declarations. Missing file → empty map.
 */
export function loadMinPayoutDeclarations(options?: {
  path?: string
  reload?: boolean
}): Map<string, DeclaredMinPayout> {
  const path = options?.path ?? cachedPath ?? resolvePath()
  if (!options?.reload && byCompact && cachedPath === path) {
    return byCompact
  }

  const map = new Map<string, DeclaredMinPayout>()
  if (!existsSync(path)) {
    cachedPath = path
    byCompact = map
    return map
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const rows = Array.isArray(parsed) ? parsed : []
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue
      const raw = item as RawRow
      const address =
        typeof raw.validatorAddress === 'string'
          ? raw.validatorAddress
          : typeof raw.validatorAddressCompact === 'string'
            ? raw.validatorAddressCompact
            : ''
      if (!address.trim()) continue
      let compact: string
      try {
        compact = normalizeAddress(address)
      } catch {
        continue
      }
      map.set(compact, rowToDeclared(raw))
    }
  } catch {
    // Corrupt file → empty (do not crash list API).
  }

  cachedPath = path
  byCompact = map
  return map
}

/** Lookup declared min payout for a validator address; unknown stub if missing. */
export function getDeclaredMinPayout(
  validatorAddress: string,
  options?: { path?: string; reload?: boolean },
): DeclaredMinPayout {
  let compact: string
  try {
    compact = normalizeAddress(validatorAddress)
  } catch {
    return { nim: null, kind: 'unknown', confidence: null }
  }
  const map = loadMinPayoutDeclarations(options)
  return map.get(compact) ?? { nim: null, kind: 'unknown', confidence: null }
}

/** Test helper: drop cache so the next load re-reads disk. */
export function resetMinPayoutDeclarationsCache(): void {
  cachedPath = null
  byCompact = null
}
