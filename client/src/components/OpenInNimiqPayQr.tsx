/**
 * Desktop: Pay QR for opening Steakout in Nimiq Pay.
 * Optionally pairs phone login → desktop session (no Hub popup).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  claimDesktopPair,
  createDesktopPair,
  getDesktopPairStatus,
} from '../api/desktopPair'
import {
  buildQrImageUrl,
  getPhoneReachableMiniAppUrl,
  isCleartextHttpAppUrl,
  isLoopbackAppOrigin,
  isNimiqPayHost,
  nimiqPayDeepLink,
  NIMIQ_PAY_ANDROID_URL,
  NIMIQ_PAY_IOS_URL,
} from '../nimiq'
import './OpenInNimiqPayQr.css'

const IS_TESTNET =
  (import.meta.env.VITE_NIMIQ_NETWORK ?? 'mainnet').trim().toLowerCase() === 'testnet' ||
  (import.meta.env.VITE_NIMIQ_NETWORK ?? 'mainnet').trim().toLowerCase() === 'test'

function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export interface OpenInNimiqPayQrProps {
  appUrl?: string
  compact?: boolean
  className?: string
  /**
   * When true (default), create a desktop-pair slot and embed it in the Pay URL.
   * Phone can approve → this browser claims a session cookie.
   */
  linkDesktopSession?: boolean
  /** Called after desktop successfully claims the phone session. */
  onDesktopLinked?: (address: string) => void
}

function AppStoreIcon() {
  return (
    <svg
      className="open-in-pay-qr-store-icon"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function PlayStoreIcon() {
  return (
    <svg
      className="open-in-pay-qr-store-icon"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.61 1.81 13.79 12 3.61 22.19a.99.99 0 0 1-.61-.92V2.73c0-.4.24-.75.61-.92zm10.89 10.89 2.3 2.3-10.93 6.33 8.63-8.63zm3.2-3.2 2.81 1.63a1 1 0 0 1 0 1.73l-2.81 1.63L15.21 12l2.49-2.5zM5.86 2.66 16.8 8.99l-2.3 2.3-8.64-8.63z" />
    </svg>
  )
}

export default function OpenInNimiqPayQr({
  appUrl,
  compact = false,
  className,
  linkDesktopSession = true,
  onDesktopLinked,
}: OpenInNimiqPayQrProps) {
  const [copied, setCopied] = useState(false)
  const [pairId, setPairId] = useState<string | null>(null)
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null)
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)
  const [pairStatus, setPairStatus] = useState<string | null>(null)
  const [pairError, setPairError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const claimedRef = useRef(false)
  const creatingPairRef = useRef(false)
  const autoRefreshedPairRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const onLinkedRef = useRef(onDesktopLinked)
  onLinkedRef.current = onDesktopLinked

  const refreshPair = useCallback(async () => {
    if (!linkDesktopSession || creatingPairRef.current) return
    if (typeof window !== 'undefined' && isNimiqPayHost()) return
    creatingPairRef.current = true
    setPairError(null)
    setPairStatus('preparing')
    setPairExpiresAt(null)
    setSecondsRemaining(null)
    try {
      const created = await createDesktopPair()
      if (!mountedRef.current) return
      const expiresAt = Date.parse(created.expiresAt)
      claimedRef.current = false
      autoRefreshedPairRef.current = null
      setPairId(created.pairId)
      setPairExpiresAt(Number.isFinite(expiresAt) ? expiresAt : null)
      setPairStatus('waiting')
    } catch (err) {
      if (mountedRef.current) {
        setPairStatus('expired')
        setPairError(err instanceof Error ? err.message : 'Could not refresh the QR code.')
      }
    } finally {
      creatingPairRef.current = false
    }
  }, [linkDesktopSession])

  useEffect(() => {
    mountedRef.current = true
    void refreshPair()
    return () => {
      mountedRef.current = false
    }
  }, [refreshPair])

  // Keep the short-lived login QR fresh without making the user reload the page.
  useEffect(() => {
    if (!pairId || pairExpiresAt == null || pairStatus === 'claimed') return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((pairExpiresAt - Date.now()) / 1000))
      setSecondsRemaining(remaining)
      if (remaining === 0 && autoRefreshedPairRef.current !== pairId) {
        autoRefreshedPairRef.current = pairId
        void refreshPair()
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [pairExpiresAt, pairId, pairStatus, refreshPair])

  // Poll until phone approves, then claim cookie on this origin.
  useEffect(() => {
    if (!pairId || !linkDesktopSession) return
    if (claimedRef.current) return
    let cancelled = false
    const tick = async () => {
      try {
        const status = await getDesktopPairStatus(pairId)
        if (cancelled) return
        setPairStatus(status.status)
        if (status.status === 'approved' && !claimedRef.current) {
          claimedRef.current = true
          setLinking(true)
          const claimed = await claimDesktopPair(pairId)
          if (cancelled) return
          setPairStatus('claimed')
          setLinking(false)
          onLinkedRef.current?.(claimed.address)
        }
        if (status.status === 'expired' || status.status === 'claimed') {
          setLinking(false)
        }
      } catch {
        /* keep polling until expiry */
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pairId, linkDesktopSession])

  const webUrl = useMemo(() => {
    const base = getPhoneReachableMiniAppUrl(appUrl)
    if (!pairId) return base
    try {
      const url = new URL(base)
      url.searchParams.set('desktopPair', pairId)
      // Prefer landing on home with pair in query (survives Pay open).
      if (!url.hash || url.hash === '#' || url.hash === '#/') {
        url.hash = '#/'
      }
      return url.href
    } catch {
      return base
    }
  }, [appUrl, pairId])

  const payDeepLink = useMemo(() => nimiqPayDeepLink(webUrl), [webUrl])
  const loopback = isLoopbackAppOrigin(webUrl)
  const cleartext = isCleartextHttpAppUrl(webUrl)
  const qrSrc = useMemo(() => buildQrImageUrl(payDeepLink, compact ? 180 : 220), [payDeepLink, compact])

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payDeepLink)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }, [payDeepLink])

  if (typeof window !== 'undefined' && isNimiqPayHost()) {
    return null
  }

  const rootClass = [
    'open-in-pay-qr',
    compact ? 'open-in-pay-qr--compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const pairStatusText = pairError
    ? pairError
    : linking
      ? 'Approved. Signing you in…'
      : pairStatus === 'waiting'
        ? 'Waiting for connection…'
        : pairStatus === 'claimed'
          ? 'Signed in.'
          : pairStatus === 'expired'
            ? 'Link expired. Refresh for a new QR.'
            : pairId
              ? 'Preparing…'
              : 'Preparing QR…'

  return (
    <section className={rootClass} aria-labelledby="open-in-pay-qr-title">
      <h2 id="open-in-pay-qr-title" className="open-in-pay-qr-title">
        {linkDesktopSession ? 'Sign in with Nimiq Pay' : 'Open in Nimiq Pay'}
      </h2>
      <p className="open-in-pay-qr-lede">
        {linkDesktopSession
          ? 'Scan with your phone. Connect in Pay, then approve to sign in here.'
          : 'Scan to open Steakout inside Nimiq Pay.'}
      </p>

      {loopback ? (
        <p className="open-in-pay-qr-warn" role="status">
          This page is on <code>localhost</code>. Set <code>VITE_PUBLIC_APP_URL</code> to your{' '}
          <strong>HTTPS</strong> tunnel URL and restart Vite.
        </p>
      ) : null}

      {cleartext ? (
        <div className="open-in-pay-qr-warn" role="status">
          <p>
            <strong>HTTP LAN URLs often open Pay with a blank page.</strong> Use an HTTPS tunnel (
            <code>cloudflared tunnel --url http://127.0.0.1:5173</code>) and set{' '}
            <code>VITE_PUBLIC_APP_URL</code> + <code>CORS_ORIGIN</code> to that host.
          </p>
        </div>
      ) : null}

      <div className="open-in-pay-qr-grid">
        <figure className="open-in-pay-qr-figure">
          <img
            className="open-in-pay-qr-img"
            src={qrSrc}
            width={compact ? 180 : 220}
            height={compact ? 180 : 220}
            alt="QR code to open Steakout in Nimiq Pay"
          />
        </figure>
      </div>

      <div className="open-in-pay-qr-actions">
        <button type="button" className="nq-pill-secondary open-in-pay-qr-btn" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {linkDesktopSession ? (
          <button
            type="button"
            className="nq-ghost-btn open-in-pay-qr-btn"
            onClick={() => void refreshPair()}
            disabled={pairStatus === 'preparing'}
          >
            {pairStatus === 'preparing' ? 'Refreshing…' : 'Refresh QR'}
          </button>
        ) : null}
      </div>

      {linkDesktopSession ? (
        <div className="open-in-pay-qr-pair-meta">
          <p className="open-in-pay-qr-pair-status" role="status">
            {pairStatusText}
          </p>
          {pairStatus === 'waiting' && secondsRemaining != null ? (
            <p className="open-in-pay-qr-countdown">
              QR refreshes in <span>{formatCountdown(secondsRemaining)}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="open-in-pay-qr-stores">
        <p className="open-in-pay-qr-stores-label nq-label">Get Nimiq Pay</p>
        <div className="open-in-pay-qr-store-row">
          <a
            className="open-in-pay-qr-store"
            href={NIMIQ_PAY_IOS_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Download Nimiq Pay on the App Store"
          >
            <AppStoreIcon />
            <span>App Store</span>
          </a>
          <a
            className="open-in-pay-qr-store"
            href={NIMIQ_PAY_ANDROID_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Download Nimiq Pay on Google Play"
          >
            <PlayStoreIcon />
            <span>Google Play</span>
          </a>
        </div>
        {IS_TESTNET ? (
          <p className="open-in-pay-qr-hint nq-subline">Use testnet in Pay when testing with faucet NIM.</p>
        ) : null}
      </div>
    </section>
  )
}
