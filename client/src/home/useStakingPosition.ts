/**
 * Load authenticated staking position when the wallet session is ready.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  fetchStakingPosition,
  type StakingPositionEnvelope,
} from '../api/position'
import { ApiError } from '../api/http'

export type PositionQueryStatus = 'idle' | 'loading' | 'success' | 'error'

export interface UseStakingPositionResult {
  status: PositionQueryStatus
  envelope: StakingPositionEnvelope | null
  error: ApiError | Error | null
  refresh: () => void
}

export function useStakingPosition(options: {
  /** When false, skips fetch (disconnected or boot not ready). */
  enabled: boolean
}): UseStakingPositionResult {
  const { enabled } = options
  const [status, setStatus] = useState<PositionQueryStatus>('idle')
  const [envelope, setEnvelope] = useState<StakingPositionEnvelope | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      setEnvelope(null)
      setError(null)
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    void fetchStakingPosition()
      .then((data) => {
        if (cancelled) return
        setEnvelope(data)
        setStatus('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setEnvelope(null)
        setError(err instanceof Error ? err : new Error(String(err)))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [enabled, tick])

  return { status, envelope, error, refresh }
}
