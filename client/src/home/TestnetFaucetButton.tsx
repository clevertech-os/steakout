/**
 * Testnet-only control: request faucet NIM for the connected address.
 * Hidden on mainnet builds (getClientNetwork).
 */

import { useCallback, useState } from 'react'
import { requestTestnetFaucet } from '../api/faucet'
import { getClientNetwork } from '../nimiq'

export interface TestnetFaucetButtonProps {
  address: string
  /** Called after a successful tap (e.g. refresh balance). */
  onFunded?: () => void
  className?: string
}

export default function TestnetFaucetButton({
  address,
  onFunded,
  className,
}: TestnetFaucetButtonProps) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      setStatus(`${result.message}${blocks}`)
      onFunded?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Faucet request failed.')
    } finally {
      setBusy(false)
    }
  }, [address, onFunded])

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
        Testnet only — requests free NIM from the public faucet for this connected address.
        Not real value.
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
