/** Authenticated personal continuity, including restake position growth. */

import { apiGet } from './http'

export interface GrowthSnapshot {
  at: string
  totalLuna: number
  sourceBlock: number | null
  validatorAddress: string | null
}

export interface GrowthInterval {
  from: GrowthSnapshot
  to: GrowthSnapshot
  deltaLuna: number
  status: 'observed' | 'confounded'
  confoundedBy:
    | 'staking-intent'
    | 'delegation-change'
    | 'chain-staking-action'
    | 'chain-history-unavailable'
    | null
}

export interface ObservedPositionGrowth {
  label: 'Observed position growth'
  definition: string
  status: 'observed' | 'insufficient-data'
  latest: GrowthSnapshot | null
  previous: GrowthSnapshot | null
  deltaLuna: number | null
  totalDeltaLuna: number | null
  window: { from: string; to: string; durationDays: number } | null
  intervals: GrowthInterval[]
  expectedRange: {
    version: string
    lowerLuna: number
    upperLuna: number
    annualRateLowPercent: number
    annualRateHighPercent: number
    assumptions: string
    status: 'inferred'
    methodologyUrl: string
  } | null
  freshness: { at: string; ageSeconds: number; sourceBlock: number | null } | null
}

export interface PersonalContinuityEnvelope {
  updatedAt: string
  source: 'indexer' | 'rpc' | 'cache' | string
  status: 'ok' | 'stale' | 'partial' | 'unavailable' | string
  dataFreshness: { ageSeconds: number; historyDepthDays: number | null }
  data: {
    mode: 'not-staked' | 'direct-payout' | 'restake' | 'unknown-payout'
    positionState: string
    validatorAddress: string | null
    validatorName: string | null
    observedPositionGrowth: ObservedPositionGrowth | null
  }
}

export function fetchPersonalContinuity(): Promise<PersonalContinuityEnvelope> {
  return apiGet<PersonalContinuityEnvelope>('/api/me/observations')
}
