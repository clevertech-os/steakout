/**
 * Shown inside Nimiq Pay when the URL carries ?desktopPair=…
 * Phone must already have a Steakout session (Pay connect).
 */

import { useCallback, useState } from 'react'
import {
  approveDesktopPair,
  clearDesktopPairFromLocation,
  readDesktopPairIdFromLocation,
} from '../api/desktopPair'
import './OpenInNimiqPayQr.css'

export interface DesktopPairApproveProps {
  /** When false, hide (not in Pay or no pair id). */
  enabled: boolean
  /** Wallet already connected in this WebView. */
  walletConnected: boolean
  onConnect: () => void
  connecting?: boolean
}

export default function DesktopPairApprove({
  enabled,
  walletConnected,
  onConnect,
  connecting = false,
}: DesktopPairApproveProps) {
  const [pairId] = useState(() => readDesktopPairIdFromLocation())
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const onApprove = useCallback(async () => {
    if (!pairId) return
    setStatus('working')
    setMessage(null)
    try {
      const result = await approveDesktopPair(pairId)
      setStatus('done')
      setMessage(result.message)
      clearDesktopPairFromLocation()
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Could not approve desktop link.')
    }
  }, [pairId])

  if (!enabled || !pairId) return null

  return (
    <section className="open-in-pay-qr open-in-pay-qr--compact" aria-labelledby="desktop-pair-title">
      <h2 id="desktop-pair-title" className="open-in-pay-qr-title">
        Link desktop browser
      </h2>
      <p className="open-in-pay-qr-lede">
        A desktop browser is waiting to sign in as this wallet. Approve only if you started the QR
        from your own computer.
      </p>
      {!walletConnected ? (
        <div className="open-in-pay-qr-actions">
          <button
            type="button"
            className="nq-pill-blue open-in-pay-qr-btn"
            disabled={connecting}
            onClick={onConnect}
          >
            {connecting ? 'Connecting…' : 'Connect in Pay first'}
          </button>
        </div>
      ) : (
        <div className="open-in-pay-qr-actions">
          <button
            type="button"
            className="nq-pill-blue open-in-pay-qr-btn"
            disabled={status === 'working' || status === 'done'}
            onClick={() => {
              void onApprove()
            }}
          >
            {status === 'working'
              ? 'Approving…'
              : status === 'done'
                ? 'Desktop linked'
                : 'Approve desktop sign-in'}
          </button>
        </div>
      )}
      {message ? (
        <p className="open-in-pay-qr-pair-status" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
