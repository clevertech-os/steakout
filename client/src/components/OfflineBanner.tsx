/**
 * Offline / reconnect notice for the app shell (P3-08).
 * Neutral copy; does not block reading public content.
 */

import { useEffect, useState } from 'react'
import './OfflineBanner.css'

function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

/**
 * Compact banner when the browser reports offline.
 * Public screens stay readable; staking actions should remain gated by live APIs.
 */
export default function OfflineBanner() {
  const [online, setOnline] = useState(readOnline)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    setOnline(readOnline())
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  if (online) return null

  return (
    <p className="so-offline-banner" role="status" data-testid="offline-banner">
      <span className="so-offline-banner-kicker">Offline</span>
      <span className="so-offline-banner-body">
        You appear to be offline. Previously loaded content may still be readable; live
        position and staking actions need a connection.
      </span>
    </p>
  )
}
