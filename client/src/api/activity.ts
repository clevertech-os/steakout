/**
 * Personal + network activity timeline client (API.md §5 / P2-10).
 */

import { apiGet } from './http'

export type PersonalActivityType =
  | 'direct-payout'
  | 'observed-position-growth'
  | 'position-change'
  | 'staking-intent'

export type NetworkActivityType = 'payout-run'

export interface ActivityItem {
  id?: string
  type: PersonalActivityType | NetworkActivityType | string
  at: string
  txHash: string | null
  amountLuna: number | null
  validatorAddress: string | null
  status: string
  label: string
  growthLabel?: string
  validatorName?: string | null
  txCount?: number | null
  recipientCount?: number | null
}

export interface ActivityEnvelope {
  updatedAt: string
  source: 'indexer' | string
  status: 'ok' | 'unavailable' | string
  dataFreshness: { ageSeconds: number; historyDepthDays: number | null }
  data: {
    items: ActivityItem[]
    nextCursor: string | null
  }
}

export function fetchPersonalActivity(limit?: number): Promise<ActivityEnvelope> {
  const q =
    limit != null && Number.isFinite(limit)
      ? `?limit=${encodeURIComponent(String(Math.floor(limit)))}`
      : ''
  return apiGet<ActivityEnvelope>(`/api/me/activity${q}`)
}

export function fetchNetworkActivity(limit?: number): Promise<ActivityEnvelope> {
  const q =
    limit != null && Number.isFinite(limit)
      ? `?limit=${encodeURIComponent(String(Math.floor(limit)))}`
      : ''
  return apiGet<ActivityEnvelope>(`/api/activity/network${q}`)
}
