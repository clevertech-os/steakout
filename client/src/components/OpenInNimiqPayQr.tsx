/**
 * Desktop: single Pay deeplink QR.
 * Optionally runs desktop↔phone session pairing (login on desktop after Pay login).
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

export default function OpenInNimiqPayQr({
  appUrl,
  compact = false,
  className,
  linkDesktopSession = true,
  onDesktopLinked,
}: OpenInNimiqPayQrProps) {
  const [copied, setCopied] = useState(false)
  const [pairId, setPairId] = useState<string | null>(null)
  const [pairStatus, setPairStatus] = useState<string | null>(null)
  const [pairError, setPairError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const claimedRef = useRef(false)
  const onLinkedRef = useRef(onDesktopLinked)
  onLinkedRef.current = onDesktopLinked

  // Create pairing slot once when linking desktop session.
  useEffect(() => {
    if (!linkDesktopSession) return
    if (typeof window !== 'undefined' && isNimiqPayHost()) return
    let cancelled = false
    void (async () => {
      try {
        const created = await createDesktopPair()
        if (!cancelled) {
          setPairId(created.pairId)
          setPairStatus('waiting')
          setPairError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setPairError(err instanceof Error ? err.message : 'Could not start desktop link.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [linkDesktopSession])

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

  return (
    <section className={rootClass} aria-labelledby="open-in-pay-qr-title">
      <h2 id="open-in-pay-qr-title" className="open-in-pay-qr-title">
        {linkDesktopSession ? 'Sign in with Nimiq Pay' : 'Open in Nimiq Pay'}
      </h2>
      <p className="open-in-pay-qr-lede">
        {linkDesktopSession
          ? 'Scan with your phone to open Steakout inside Nimiq Pay. After you connect there, approve linking — this desktop browser will sign in as the same wallet (no Hub popup).'
          : 'Scan to open Steakout inside Nimiq Pay for staking. Use testnet in Pay when testing.'}
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
            alt="QR code: open Steakout in Nimiq Pay"
          />
          <figcaption className="open-in-pay-qr-caption">Nimiq Pay deeplink</figcaption>
        </figure>
      </div>

      <p className="open-in-pay-qr-url mono" title={payDeepLink}>
        {payDeepLink}
      </p>

      <div className="open-in-pay-qr-actions">
        <button type="button" className="nq-pill-secondary open-in-pay-qr-btn" onClick={() => void copy()}>
          {copied ? 'Copied Pay link' : 'Copy Pay link'}
        </button>
      </div>

      {linkDesktopSession ? (
        <p className="open-in-pay-qr-pair-status" role="status">
          {pairError
            ? pairError
            : linking
              ? 'Phone approved — signing this browser in…'
              : pairStatus === 'waiting'
                ? 'Waiting for you to connect in Pay and approve desktop link…'
                : pairStatus === 'claimed'
                  ? 'Desktop signed in.'
                  : pairStatus === 'expired'
                    ? 'Link expired — refresh the page for a new QR.'
                    : pairId
                      ? 'Preparing secure link…'
                      : 'Preparing QR…'}
        </p>
      ) : null}

      <p className="open-in-pay-qr-hint nq-subline">
        Install Pay:{' '}
        <a href={NIMIQ_PAY_IOS_URL} target="_blank" rel="noreferrer">
          iOS
        </a>
        {' · '}
        <a href={NIMIQ_PAY_ANDROID_URL} target="_blank" rel="noreferrer">
          Android
        </a>
        . Use <strong>testnet</strong> when testing with faucet NIM.
      </p>
    </section>
  )
}
