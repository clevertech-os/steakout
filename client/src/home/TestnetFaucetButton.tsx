/**
 * Testnet-only control: request faucet NIM for the connected address.
 * Hidden on mainnet builds (getClientNetwork).
 *
 * After a successful tap, re-poll position for a short window so the free
 * balance updates once the faucet tx is included (immediate refresh alone is
 * often too early — the faucet API returns before the block lands).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestTestnetFaucet } from '../api/faucet'
import { getClientNetwork } from '../nimiq'

export interface TestnetFaucetButtonProps {
  address: string
  /**
   * Called after a successful tap (and on follow-up polls) so available balance
   * can update once the faucet tx is included. Prefer a fresh position read.
   */
  onFunded?: (options?: { fresh?: boolean }) => void
  className?: string
}

/** How long to keep re-fetching after faucet success (ms). */
const FAUCET_FOLLOWUP_MS = 45_000
/** Interval between follow-up balance refreshes (ms). */
const FAUCET_FOLLOWUP_INTERVAL_MS = 3_000

export default function TestnetFaucetButton({
  address,
  onFunded,
  className,
}: TestnetFaucetButtonProps) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const followUpTimers = useRef<number[]>([])

  const clearFollowUps = useCallback(() => {
    for (const id of followUpTimers.current) {
      window.clearTimeout(id)
    }
    followUpTimers.current = []
  }, [])

  useEffect(() => () => clearFollowUps(), [clearFollowUps])

  /** Refresh now and again until the faucet block is likely visible. */
  const scheduleBalanceFollowUp = useCallback(() => {
    clearFollowUps()
    onFunded?.({ fresh: true })
    const started = Date.now()
    const tick = () => {
      onFunded?.({ fresh: true })
      if (Date.now() - started + FAUCET_FOLLOWUP_INTERVAL_MS < FAUCET_FOLLOWUP_MS) {
        const id = window.setTimeout(tick, FAUCET_FOLLOWUP_INTERVAL_MS)
        followUpTimers.current.push(id)
      }
    }
    const first = window.setTimeout(tick, FAUCET_FOLLOWUP_INTERVAL_MS)
    followUpTimers.current.push(first)
  }, [clearFollowUps, onFunded])

  const onClick = useCallback(async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await requestTestnetFaucet(address)
      const blocks =
        result.expectedBlocks != null
          ? ` (~${result.expectedBlocks} block${result.expectedBlocks === 1 ? '' : 's'})`
          : ''
      setStatus(
        `${result.message}${blocks} Wallet balance updates when the block confirms — usually within a few seconds. Nimiq Pay may then hold some NIM in payment contracts; Steakout shows that in the wallet total.`,
      )
      scheduleBalanceFollowUp()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Faucet request failed.')
    } finally {
      setBusy(false)
    }
  }, [address, scheduleBalanceFollowUp])

  if (getClientNetwork() !== 'testnet') {
    return null
  }

  return (
    <div className={className ? `home-faucet ${className}` : 'home-faucet'}>
      <button
        type="button"
        className="nq-pill-secondary home-cta"
        onClick={() => {
          void onClick()
        }}
        disabled={busy}
      >
        {busy ? 'Requesting testnet NIM…' : 'Get testnet NIM'}
      </button>
      <p className="home-faucet-note nq-subline">
        Testnet only — requests free NIM from the public faucet for this connected
        address (same as Nimiq Pay). After confirm, Pay may move NIM into payment
        contracts; Steakout wallet total includes those. Not real value.
      </p>
      {status ? (
        <p className="home-status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="home-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
