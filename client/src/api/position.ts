/**
 * Authenticated staking position client (API.md §5).
 */

import { apiGet } from './http'

export type PositionState =
  | 'NotStaked'
  | 'Pending'
  | 'Active'
  | 'Inactive'
  | 'Retiring'
  | 'Withdrawable'

export type PositionEnvelopeStatus = 'ok' | 'stale' | 'partial' | 'unavailable'

export interface StakingPositionData {
  state: PositionState
  /** Free basic-account balance on the session address. */
  accountBalanceLuna: number | null
  /**
   * Open HTLC balances where this address is the contract sender
   * (Nimiq Pay payment contracts). Verified observation.
   */
  htlcBalanceLuna: number
  /**
   * Free + open HTLC as sender — aligns with what Nimiq Pay typically shows
   * as wallet total. Null only when the free-balance read failed.
   */
  walletBalanceLuna: number | null
  /** Distinct open HTLC contracts included in htlcBalanceLuna. */
  htlcCount: number
  staker: {
    activeLuna: number
    inactiveLuna: number
    retiredLuna: number
    totalLuna: number
    delegation: string | null
    validatorName: string | null
  }
  retire: { withdrawableAt: string | null }
  lastRewardObservation: {
    type: 'direct-payout' | 'balance-change'
    at: string
    txHash: string | null
  } | null
}

export interface StakingPositionEnvelope {
  updatedAt: string
  source: 'rpc' | 'cache'
  status: PositionEnvelopeStatus
  dataFreshness: { ageSeconds: number }
  data: StakingPositionData
}

export function fetchStakingPosition(options?: {
  /** Skip server short-TTL cache (e.g. after faucet / return from Pay). */
  fresh?: boolean
}): Promise<StakingPositionEnvelope> {
  const path = options?.fresh
    ? '/api/me/staking-position?fresh=1'
    : '/api/me/staking-position'
  return apiGet<StakingPositionEnvelope>(path)
}

/** True when the position represents a staked (or transitional) stake. */
export function isStakedState(state: PositionState): boolean {
  return state !== 'NotStaked'
}
