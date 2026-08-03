/**
 * Stake amount presets + fee headroom (SPEC §6.4).
 *
 * Max-safe never stakes the entire balance: a documented Luna headroom is
 * reserved for fees. P0-03 did not lock a testnet fee matrix, so this uses a
 * conservative constant (1 NIM) rather than inventing a protocol minimum.
 */

import { LUNA_PER_NIM, nimToLuna } from '../luna'

/**
 * Luna reserved so presets never drain the whole liquid balance.
 * Documented product safety floor until a device-verified fee matrix lands.
 */
export const STAKE_FEE_HEADROOM_LUNA = 1 * LUNA_PER_NIM // 1 NIM

/** Minimum positive stake the UI will submit (1 Luna). Protocol floor is unresolved. */
export const MIN_STAKE_LUNA = 1

export type AmountPresetId = '25' | '50' | 'max-safe' | 'custom'

/**
 * Maximum Luna the user may stake from an available account balance.
 * Returns 0 when balance cannot cover headroom + minimum stake.
 */
export function maxSafeStakeLuna(availableLuna: number | null | undefined): number {
  if (availableLuna == null || !Number.isFinite(availableLuna)) return 0
  const available = Math.floor(availableLuna)
  if (available <= STAKE_FEE_HEADROOM_LUNA) return 0
  return Math.max(0, available - STAKE_FEE_HEADROOM_LUNA)
}

/** Preset fraction of max-safe (not of raw balance). */
export function presetStakeLuna(
  availableLuna: number | null | undefined,
  preset: Exclude<AmountPresetId, 'custom'>,
): number {
  const maxSafe = maxSafeStakeLuna(availableLuna)
  if (maxSafe <= 0) return 0
  if (preset === 'max-safe') return maxSafe
  if (preset === '25') return Math.floor(maxSafe * 0.25)
  if (preset === '50') return Math.floor(maxSafe * 0.5)
  return 0
}

/**
 * Parse a NIM amount string into Luna for intent creation.
 * Rejects empty, non-numeric, negative, and unsafe values.
 */
export function parseNimInputToLuna(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, '')
  if (!trimmed) return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const nim = Number(trimmed)
  if (!Number.isFinite(nim) || nim <= 0) return null
  const luna = nimToLuna(nim)
  if (!Number.isSafeInteger(luna) || luna < MIN_STAKE_LUNA) return null
  return luna
}

export function isStakeAmountAllowed(
  valueLuna: number,
  availableLuna: number | null | undefined,
): boolean {
  if (!Number.isSafeInteger(valueLuna) || valueLuna < MIN_STAKE_LUNA) return false
  const maxSafe = maxSafeStakeLuna(availableLuna)
  if (maxSafe <= 0) return false
  return valueLuna <= maxSafe
}
