/** Authenticated validator watchlist and in-app alert inbox. */
import { apiDelete, apiGet, apiPost } from './http'

export interface WatchlistItem {
  id: number
  validatorAddress: string
  validatorName: string | null
  createdAt: string
}

export interface WatchlistEnvelope {
  updatedAt: string
  source: string
  status: string
  data: { validators: WatchlistItem[] }
}

export type AlertType =
  | 'direct-payout'
  | 'position-change'
  | 'withdrawable'
  | 'staking-intent'
  | 'validator-status'
  | 'payout-run'

export interface UserAlert {
  id: number
  type: AlertType | string
  title: string
  message: string
  observedAt: string
  createdAt: string
  readAt: string | null
  isRead: boolean
  validatorAddress: string | null
  validatorName: string | null
  txHash: string | null
  amountLuna: number | null
}

export interface AlertsEnvelope {
  updatedAt: string
  source: string
  status: string
  data: {
    alerts: UserAlert[]
    unreadCount: number
    nextCursor: string | null
  }
}

export function fetchWatchlist(): Promise<WatchlistEnvelope> {
  return apiGet<WatchlistEnvelope>('/api/me/watchlist')
}

export function watchValidator(validatorAddress: string): Promise<WatchlistEnvelope> {
  return apiPost<WatchlistEnvelope>('/api/me/watchlist', { validatorAddress })
}

export function unwatchValidator(validatorAddress: string): Promise<WatchlistEnvelope> {
  return apiDelete<WatchlistEnvelope>(
    `/api/me/watchlist/${encodeURIComponent(validatorAddress)}`,
  )
}

export function fetchAlerts(limit = 50): Promise<AlertsEnvelope> {
  return apiGet<AlertsEnvelope>(`/api/me/alerts?limit=${encodeURIComponent(String(limit))}`)
}

export function markAlertRead(id: number): Promise<AlertsEnvelope> {
  return apiPost<AlertsEnvelope>(`/api/me/alerts/${encodeURIComponent(String(id))}/read`, {})
}

export function markAllAlertsRead(): Promise<AlertsEnvelope> {
  return apiPost<AlertsEnvelope>('/api/me/alerts/read-all', {})
}
