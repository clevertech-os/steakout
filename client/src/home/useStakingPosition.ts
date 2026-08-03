/**
 * Load authenticated staking position when the wallet session is ready.
 *
 * Balance is the on-chain account for the **session address only** (Pay/desktop
 * pair). It is not a live subscription: we re-fetch on mount, manual refresh,
 * window focus, and a short poll so incoming NIM shows up without a full reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchStakingPosition,
  type StakingPositionEnvelope,
} from '../api/position'
import { ApiError } from '../api/http'

export type PositionQueryStatus = 'idle' | 'loading' | 'success' | 'error'

/** Background re-poll while home is open (server position cache is ~10s). */
const POSITION_POLL_MS = 20_000

export interface UseStakingPositionResult {
  status: PositionQueryStatus
  envelope: StakingPositionEnvelope | null
  error: ApiError | Error | null
  /** Re-fetch position. Pass `{ fresh: true }` after faucet / external funding. */
  refresh: (options?: { fresh?: boolean }) => void
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
  /** Next fetch should bypass server cache (consumed once per tick). */
  const freshRef = useRef(false)

  const refresh = useCallback((options?: { fresh?: boolean }) => {
    if (options?.fresh) freshRef.current = true
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
    // Keep showing the last envelope while a background refresh runs.
    setStatus((prev) => (prev === 'success' ? 'success' : 'loading'))
    setError(null)

    const wantFresh = freshRef.current
    freshRef.current = false

    void fetchStakingPosition({ fresh: wantFresh })
      .then((data) => {
        if (cancelled) return
        setEnvelope(data)
        setStatus('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Keep last good envelope on soft refresh failure.
        setError(err instanceof Error ? err : new Error(String(err)))
        setStatus((prev) => (prev === 'success' ? 'success' : 'error'))
      })

    return () => {
      cancelled = true
    }
  }, [enabled, tick])

  // Re-fetch when the tab becomes visible (user returns from Pay / faucet).
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh({ fresh: true })
    }
    const onFocus = () => refresh({ fresh: true })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, refresh])

  // Light poll so incoming NIM appears without manual retry.
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => refresh({ fresh: true }), POSITION_POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, refresh])

  return { status, envelope, error, refresh }
}
