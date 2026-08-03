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
 * Maximum Luna the user may stake from an available wallet budget.
 *
 * Callers pass Pay-aligned wallet total when known (free basic + open HTLC as
 * sender). That lets us test whether Nimiq Pay can fund stake txs from payment
 * contracts; chain/wallet remains authoritative at approve time.
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

/**
 * Luna that can be retired: active + inactive (not already retired).
 * No fee headroom — these are already staked protocol balances.
 */
export function maxRetireLuna(staker: {
  activeLuna?: number | null
  inactiveLuna?: number | null
} | null | undefined): number {
  if (!staker) return 0
  const active = Math.floor(Number(staker.activeLuna) || 0)
  const inactive = Math.floor(Number(staker.inactiveLuna) || 0)
  if (!Number.isFinite(active) || !Number.isFinite(inactive)) return 0
  return Math.max(0, active + inactive)
}

/**
 * Luna that can be removed: retired only, and only when position is Withdrawable
 * (client still gates on state; this is the pool size).
 */
export function maxRemoveLuna(
  retiredLuna: number | null | undefined,
): number {
  if (retiredLuna == null || !Number.isFinite(retiredLuna)) return 0
  return Math.max(0, Math.floor(retiredLuna))
}

/** Preset of a pool (retire/remove) without fee headroom. */
export function presetPoolLuna(
  poolLuna: number | null | undefined,
  preset: Exclude<AmountPresetId, 'custom'>,
): number {
  const pool =
    poolLuna == null || !Number.isFinite(poolLuna) ? 0 : Math.floor(poolLuna)
  if (pool <= 0) return 0
  if (preset === 'max-safe') return pool
  if (preset === '25') return Math.floor(pool * 0.25)
  if (preset === '50') return Math.floor(pool * 0.5)
  return 0
}

export function isPoolAmountAllowed(
  valueLuna: number,
  poolLuna: number | null | undefined,
): boolean {
  if (!Number.isSafeInteger(valueLuna) || valueLuna < MIN_STAKE_LUNA) return false
  const pool =
    poolLuna == null || !Number.isFinite(poolLuna) ? 0 : Math.floor(poolLuna)
  if (pool <= 0) return false
  return valueLuna <= pool
}
