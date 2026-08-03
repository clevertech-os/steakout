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
  accountBalanceLuna: number | null
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

export function fetchStakingPosition(): Promise<StakingPositionEnvelope> {
  return apiGet<StakingPositionEnvelope>('/api/me/staking-position')
}

/** True when the position represents a staked (or transitional) stake. */
export function isStakedState(state: PositionState): boolean {
  return state !== 'NotStaked'
}
