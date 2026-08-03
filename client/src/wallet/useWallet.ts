/**
 * Wallet connection state machine (Nimiq Pay + Hub).
 * Ported from VeriLock `client/src/journey/useJourneyWallet.ts` (P1-01).
 * Journey-specific coupling removed.
 *
 * Auth challenge/verify is optional (inject via `WalletAuthApi` when P1-02
 * lands); without it, connect still obtains an address via Pay `listAccounts`
 * or Hub `chooseAddress`.
 *
 * Non-custodial: never stores keys; staking writes stay on the provider.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  chooseAddressViaHub,
  connectNimiq,
  connectViaHub,
  HUB_REDIRECT_MESSAGE,
  isHubCancelError,
  isHubRedirectError,
  isMobileDevice,
  isNimiqPayHost,
  launchNimiqPayMiniApp,
  LOGIN_CANCELED_MESSAGE,
  peekHubRedirectInUrl,
  probeNimiqPay,
  setupHubRedirectHandlers,
  signChallenge,
  signMessageViaHub,
  warmNimiqProvider,
  shouldUseHubRedirect,
  getWalletMode,
  type WalletMode,
} from '../nimiq'
import {
  clearOrphanedHubRedirectReturn,
  clearStaleHubRpcStateIfIdle,
  hasPendingHubRedirect,
} from '../hubRedirectParse'
import { clearSession, loadSession, saveSession } from '../session'
import { isValidNimiqAddress, normalizeAddress } from '../addresses'

/** Optional auth API wired by P1-02. Without it, connect is address-only. */
export interface WalletAuthApi {
  challenge: (address?: string | null) => Promise<{ token: string; nonce: string }>
  verify: (
    token: string,
    body: { publicKey: string; signature: string; authScheme: 'pay' | 'hub' },
  ) => Promise<{ address: string }>
  me?: (token: string) => Promise<unknown>
}

export type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ProviderAvailability = 'pay' | 'hub' | 'none'

export interface UseWalletOptions {
  auth?: WalletAuthApi | null
}

export interface UseWalletResult {
  /** High-level connection status. */
  status: WalletConnectionStatus
  address: string | null
  token: string | null
  nimiq: NimiqProvider | null
  connecting: boolean
  /** Human-readable in-progress status (Hub redirect, Pay prompts, …). */
  walletStatus: string | null
  error: string | null
  setError: (message: string | null) => void
  connect: (options?: { useRedirect?: boolean }) => Promise<void>
  disconnect: () => void
  /**
   * Sign a UTF-8 challenge message with the connected wallet.
   * Pay uses the mini-app provider; Hub uses a popup signMessage.
   */
  signMessage: (message: string) => Promise<{ publicKey: string; signature: string }>
  setNimiq: (provider: NimiqProvider | null) => void
  applySession: (token: string | undefined, address: string) => void
  bootReady: boolean
  /** User is inside Nimiq Pay WebView (host probe or window.nimiq). */
  inNimiqPay: boolean
  /**
   * Mobile device, not in Pay, not connected — use “Open in Nimiq Pay” copy
   * and deeplink-first connect.
   */
  mobilePayConnect: boolean
  /**
   * True after deeplink launch truly fails (page stayed in foreground).
   * Surfaces install / Hub options — not set after a successful handoff.
   */
  showOpenInPay: boolean
  /** Detected provider path: Pay host, Hub browser, or none yet. */
  providerAvailability: ProviderAvailability
  walletMode: WalletMode
}

const PAY_DEEPLINK_FALLBACK_MS = 1800
const PAY_INSTALL_HINT =
  'Nimiq Pay was not detected on this phone. Install the app, then try again.'
const PAY_HANDOFF_HINT =
  'Continue in Nimiq Pay to finish login. This browser tab stays separate and will not show that session.'

/**
 * Module-level: one auto-connect attempt per full page load inside Nimiq Pay.
 * Survives React StrictMode remounts; resets on real navigation/reload.
 */
let payHostAutoConnectStarted = false

export function useWallet(options: UseWalletOptions = {}): UseWalletResult {
  const auth = options.auth ?? null

  const [token, setToken] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [nimiq, setNimiq] = useState<NimiqProvider | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [walletStatus, setWalletStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bootReady, setBootReady] = useState(false)
  const [inNimiqPay, setInNimiqPay] = useState(() =>
    typeof window !== 'undefined' ? isNimiqPayHost() : false,
  )
  const [showOpenInPay, setShowOpenInPay] = useState(false)

  const hubConnectInFlightRef = useRef(false)
  const connectInFlightRef = useRef(false)
  const walletStatusRef = useRef<string | null>(null)
  const deeplinkFallbackTimerRef = useRef<number | null>(null)
  const loginCanceledTimerRef = useRef<number | null>(null)
  const skipPayAutoConnectRef = useRef(false)
  const payDeeplinkPendingRef = useRef(false)
  const payDeeplinkLeftPageRef = useRef(false)
  const authRef = useRef(auth)
  authRef.current = auth

  walletStatusRef.current = walletStatus

  const clearDeeplinkFallbackTimer = useCallback(() => {
    if (deeplinkFallbackTimerRef.current != null) {
      window.clearTimeout(deeplinkFallbackTimerRef.current)
      deeplinkFallbackTimerRef.current = null
    }
  }, [])

  const clearPayDeeplinkPending = useCallback(() => {
    payDeeplinkPendingRef.current = false
    payDeeplinkLeftPageRef.current = false
    clearDeeplinkFallbackTimer()
  }, [clearDeeplinkFallbackTimer])

  const clearLoginCanceledTimer = useCallback(() => {
    if (loginCanceledTimerRef.current != null) {
      window.clearTimeout(loginCanceledTimerRef.current)
      loginCanceledTimerRef.current = null
    }
  }, [])

  const showLoginCanceled = useCallback(() => {
    clearLoginCanceledTimer()
    setWalletStatus(null)
    setError(LOGIN_CANCELED_MESSAGE)
    loginCanceledTimerRef.current = window.setTimeout(() => {
      loginCanceledTimerRef.current = null
      setError(prev => (prev === LOGIN_CANCELED_MESSAGE ? null : prev))
    }, 5000)
  }, [clearLoginCanceledTimer])

  const applySession = useCallback(
    (sessionToken: string | undefined, addr: string) => {
      clearLoginCanceledTimer()
      const normalized = normalizeAddress(addr)
      if (!isValidNimiqAddress(normalized)) {
        setError('Invalid wallet address returned by provider.')
        return
      }
      saveSession({ token: sessionToken, address: normalized })
      setToken(sessionToken ?? null)
      setAddress(normalized)
      setShowOpenInPay(false)
      setError(null)
    },
    [clearLoginCanceledTimer],
  )

  const disconnect = useCallback(() => {
    skipPayAutoConnectRef.current = true
    clearSession()
    setToken(null)
    setAddress(null)
    setNimiq(null)
    setError(null)
    setWalletStatus(null)
    setShowOpenInPay(false)
    hubConnectInFlightRef.current = false
    connectInFlightRef.current = false
    clearPayDeeplinkPending()
  }, [clearPayDeeplinkPending])

  const resetAbandonedHubRedirect = useCallback(() => {
    if (typeof window === 'undefined') return
    if (clearOrphanedHubRedirectReturn()) {
      hubConnectInFlightRef.current = false
      connectInFlightRef.current = false
      setConnecting(false)
      setWalletStatus(null)
      return
    }
    if (peekHubRedirectInUrl() || hasPendingHubRedirect()) return
    if (loadSession()?.address) return

    const status = walletStatusRef.current
    const midHubRedirect =
      hubConnectInFlightRef.current ||
      status === HUB_REDIRECT_MESSAGE ||
      status === 'Connecting via Nimiq Hub…'
    if (!midHubRedirect) return

    hubConnectInFlightRef.current = false
    connectInFlightRef.current = false
    setConnecting(false)
    setWalletStatus(null)
    clearStaleHubRpcStateIfIdle()
  }, [])

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      if (isNimiqPayHost()) {
        setInNimiqPay(true)
        warmNimiqProvider()
      }

      const stored = loadSession()
      if (stored && !cancelled) {
        setAddress(stored.address)
        setToken(stored.token ?? null)
        const authApi = authRef.current
        if (stored.token && authApi?.me) {
          try {
            await authApi.me(stored.token)
          } catch {
            if (!cancelled) {
              clearSession()
              setToken(null)
              setAddress(null)
            }
          }
        }
      }

      void probeNimiqPay(isNimiqPayHost() ? 15_000 : 5_000).then(detected => {
        if (cancelled) return
        const inPay = detected || isNimiqPayHost()
        setInNimiqPay(inPay)
        if (inPay && window.nimiq) {
          setNimiq(window.nimiq)
        }
      })

      // Hub redirect plumbing only when auth can complete the challenge leg.
      if (authRef.current) {
        try {
          const authApi = authRef.current
          await setupHubRedirectHandlers(
            async addr => authApi.challenge(addr ?? undefined),
            async result => {
              try {
                const verified = await authApi.verify(result.token, {
                  publicKey: result.publicKey,
                  signature: result.signature,
                  authScheme: 'hub',
                })
                applySession(result.token, verified.address)
                setError(null)
                setWalletStatus(null)
              } catch (err) {
                clearSession()
                setToken(null)
                setAddress(null)
                if (isHubCancelError(err)) {
                  showLoginCanceled()
                } else {
                  setError(err instanceof Error ? err.message : 'Hub login failed')
                }
              } finally {
                hubConnectInFlightRef.current = false
                connectInFlightRef.current = false
                setConnecting(false)
              }
            },
            err => {
              hubConnectInFlightRef.current = false
              connectInFlightRef.current = false
              setConnecting(false)
              if (isHubCancelError(err)) {
                showLoginCanceled()
              } else {
                setError(err.message)
                setWalletStatus(null)
              }
            },
          )
          clearOrphanedHubRedirectReturn()
        } catch (err) {
          console.warn('[wallet] Hub redirect setup failed (Pay login still available)', err)
        }
      } else {
        clearOrphanedHubRedirectReturn()
      }

      if (!cancelled) {
        setBootReady(true)
        resetAbandonedHubRedirect()
      }
    }

    void boot()
    return () => {
      cancelled = true
      clearDeeplinkFallbackTimer()
      clearLoginCanceledTimer()
    }
  }, [
    applySession,
    clearDeeplinkFallbackTimer,
    clearLoginCanceledTimer,
    resetAbandonedHubRedirect,
    showLoginCanceled,
  ])

  const showPayHandoffHint = useCallback(() => {
    setError(prev => (prev === PAY_INSTALL_HINT ? null : prev))
    setShowOpenInPay(false)
    setWalletStatus(PAY_HANDOFF_HINT)
    connectInFlightRef.current = false
    setConnecting(false)
    window.setTimeout(() => {
      setWalletStatus(prev => (prev === PAY_HANDOFF_HINT ? null : prev))
    }, 8000)
  }, [])

  const markPayDeeplinkHandoff = useCallback(() => {
    if (!payDeeplinkPendingRef.current) return
    payDeeplinkLeftPageRef.current = true
    clearDeeplinkFallbackTimer()
    showPayHandoffHint()
  }, [clearDeeplinkFallbackTimer, showPayHandoffHint])

  const completePayDeeplinkReturn = useCallback(() => {
    if (!payDeeplinkPendingRef.current) return
    if (loadSession()?.address) {
      clearPayDeeplinkPending()
      return
    }
    if (payDeeplinkLeftPageRef.current) {
      clearPayDeeplinkPending()
      showPayHandoffHint()
    }
  }, [clearPayDeeplinkPending, showPayHandoffHint])

  useEffect(() => {
    const onPageShow = () => {
      resetAbandonedHubRedirect()
      completePayDeeplinkReturn()
    }
    const onFocus = () => {
      resetAbandonedHubRedirect()
      completePayDeeplinkReturn()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        markPayDeeplinkHandoff()
      } else if (document.visibilityState === 'visible') {
        completePayDeeplinkReturn()
      }
    }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [resetAbandonedHubRedirect, markPayDeeplinkHandoff, completePayDeeplinkReturn])

  const scheduleDeeplinkFallback = useCallback(() => {
    clearDeeplinkFallbackTimer()
    payDeeplinkPendingRef.current = true
    payDeeplinkLeftPageRef.current = false
    deeplinkFallbackTimerRef.current = window.setTimeout(() => {
      deeplinkFallbackTimerRef.current = null
      if (!payDeeplinkPendingRef.current) return
      if (payDeeplinkLeftPageRef.current || document.visibilityState !== 'visible') {
        if (payDeeplinkLeftPageRef.current || document.visibilityState === 'hidden') {
          markPayDeeplinkHandoff()
        }
        return
      }
      if (loadSession()?.address) {
        clearPayDeeplinkPending()
        return
      }
      payDeeplinkPendingRef.current = false
      connectInFlightRef.current = false
      setShowOpenInPay(true)
      setError(PAY_INSTALL_HINT)
      setWalletStatus(null)
      setConnecting(false)
    }, PAY_DEEPLINK_FALLBACK_MS)
  }, [clearDeeplinkFallbackTimer, clearPayDeeplinkPending, markPayDeeplinkHandoff])

  const connect = useCallback(
    async (connectOptions?: { useRedirect?: boolean }) => {
      clearOrphanedHubRedirectReturn()

      if (hubConnectInFlightRef.current || peekHubRedirectInUrl() || hasPendingHubRedirect()) {
        setConnecting(true)
        setWalletStatus(HUB_REDIRECT_MESSAGE)
        return
      }
      if (connectInFlightRef.current) {
        if (!hubConnectInFlightRef.current && !payDeeplinkPendingRef.current) {
          connectInFlightRef.current = false
        } else {
          setConnecting(true)
          setWalletStatus(
            walletStatusRef.current ||
              (hubConnectInFlightRef.current ? HUB_REDIRECT_MESSAGE : 'Login already in progress…'),
          )
          return
        }
      }

      connectInFlightRef.current = true
      setConnecting(true)
      clearLoginCanceledTimer()
      setError(null)
      setWalletStatus(null)
      setShowOpenInPay(false)
      clearPayDeeplinkPending()

      try {
        const payHost = isNimiqPayHost()
        const explicitHubRedirect = connectOptions?.useRedirect === true
        const hasNimiqProvider = typeof window !== 'undefined' && Boolean(window.nimiq)
        const alreadyInPay = payHost || hasNimiqProvider
        const authApi = authRef.current

        /**
         * Browser paths (not inside Nimiq Pay WebView):
         * Product path is Nimiq Pay only (same address for desktop prepare + phone approve).
         * Hub is no longer the default connect — use QR / deeplink / desktop-pair instead.
         * Opt-in Hub: connect({ useRedirect: true }) still works for rare debugging.
         */
        if (!alreadyInPay && !payHost) {
          const wantHub = explicitHubRedirect === true

          if (!wantHub) {
            // Mobile: try deeplink into Pay. Desktop: surface install / scan QR (no Hub popup).
            if (isMobileDevice()) {
              setWalletStatus('Opening Nimiq Pay…')
              const appUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
              const payResult = launchNimiqPayMiniApp(appUrl)
              if (payResult === 'already-in-pay') return
              if (payResult === 'launched') {
                setWalletStatus('Opening Nimiq Pay…')
                scheduleDeeplinkFallback()
                return
              }
            }
            setShowOpenInPay(true)
            setWalletStatus(null)
            // Desktop: QR on the home card is the path — do not surface a noisy error.
            setError(isMobileDevice() ? PAY_INSTALL_HINT : null)
            return
          }

          setWalletStatus('Connecting via Nimiq Hub…')
          hubConnectInFlightRef.current = true
          const preferRedirect = shouldUseHubRedirect(connectOptions)

          if (authApi) {
            const hubResult = await connectViaHub(
              async addr => authApi.challenge(addr ?? undefined),
              { preferRedirect },
            )
            const verified = await authApi.verify(hubResult.token, {
              publicKey: hubResult.publicKey,
              signature: hubResult.signature,
              authScheme: 'hub',
            })
            hubConnectInFlightRef.current = false
            applySession(hubResult.token, verified.address)
            setWalletStatus(null)
            return
          }

          const chosen = await chooseAddressViaHub({ preferRedirect })
          hubConnectInFlightRef.current = false
          applySession(undefined, chosen.address)
          setWalletStatus(null)
          return
        }

        let inPay = alreadyInPay
        if (payHost && !hasNimiqProvider) {
          setWalletStatus('Waiting for Nimiq Pay wallet… approve each dialog when it appears.')
          const detected = await probeNimiqPay(30_000)
          if (detected && window.nimiq) {
            setNimiq(window.nimiq)
            inPay = true
          }
        }
        setInNimiqPay(inPay || payHost)

        if (!inPay) {
          if (payHost) {
            throw new Error(
              'Nimiq Pay wallet is still loading. Wait a few seconds, then try Connect again.',
            )
          }
          throw new Error('Wallet connection failed')
        }

        if (authApi) {
          /**
           * Steakout challenges are address-bound (API.md §4). Obtain the Pay
           * address first, then challenge + sign with minimal gap between the
           * two native sheets (WebView can reclaim focus if we wait too long).
           * VeriLock could challenge(null) before connect; Steakout cannot.
           */
          setWalletStatus('Approve each Nimiq Pay prompt when it appears…')
          const { nimiq: provider, address: payAddress } = await connectNimiq()
          setNimiq(provider)
          setInNimiqPay(true)
          const { token: challengeToken, nonce } = await authApi.challenge(payAddress)
          const { publicKey, signature } = await signChallenge(provider, nonce)
          const verified = await authApi.verify(challengeToken, {
            publicKey,
            signature,
            authScheme: 'pay',
          })
          clearPayDeeplinkPending()
          // challengeToken is not a session bearer — cookie is set by verify.
          applySession(challengeToken, verified.address)
          setWalletStatus(null)
          return
        }

        // Address-only Pay connect (no challenge yet).
        setWalletStatus('Approve Nimiq Pay when prompted…')
        const { nimiq: provider, address: payAddress } = await connectNimiq()
        setNimiq(provider)
        setInNimiqPay(true)
        clearPayDeeplinkPending()
        applySession(undefined, payAddress)
        setWalletStatus(null)
      } catch (err) {
        if (isHubRedirectError(err)) {
          setError(null)
          setWalletStatus(HUB_REDIRECT_MESSAGE)
          return
        }
        if (isHubCancelError(err)) {
          hubConnectInFlightRef.current = false
          showLoginCanceled()
          return
        }
        hubConnectInFlightRef.current = false
        setError(err instanceof Error ? err.message : 'Wallet connection failed')
        setWalletStatus(null)
      } finally {
        if (!hubConnectInFlightRef.current && !payDeeplinkPendingRef.current) {
          connectInFlightRef.current = false
          setConnecting(false)
        }
      }
    },
    [
      applySession,
      clearLoginCanceledTimer,
      clearPayDeeplinkPending,
      scheduleDeeplinkFallback,
      showLoginCanceled,
    ],
  )

  /**
   * Inside Nimiq Pay: after boot, if there is no session, run Pay login once.
   */
  useEffect(() => {
    if (!bootReady) return
    if (!isNimiqPayHost()) return
    if (token || address || loadSession()?.address) return
    if (skipPayAutoConnectRef.current) return
    if (payHostAutoConnectStarted) return
    clearOrphanedHubRedirectReturn()
    if (hubConnectInFlightRef.current || peekHubRedirectInUrl() || hasPendingHubRedirect()) {
      return
    }

    payHostAutoConnectStarted = true
    setInNimiqPay(true)

    let cancelled = false
    const run = async () => {
      await probeNimiqPay(30_000).catch(() => false)
      if (cancelled || skipPayAutoConnectRef.current || loadSession()?.address) return
      await new Promise<void>(resolve => {
        window.setTimeout(resolve, 450)
      })
      if (cancelled || skipPayAutoConnectRef.current || loadSession()?.address) return
      if (document.visibilityState !== 'visible') return
      void connect()
    }
    void run()

    return () => {
      cancelled = true
    }
  }, [bootReady, token, address, connect])

  const signMessage = useCallback(
    async (message: string): Promise<{ publicKey: string; signature: string }> => {
      if (!message) throw new Error('Message required for signing.')

      if (nimiq || isNimiqPayHost() || window.nimiq) {
        const provider = nimiq ?? (await connectNimiq()).nimiq
        if (!nimiq) setNimiq(provider)
        return signChallenge(provider, message)
      }

      if (!address) {
        throw new Error('Connect a wallet before signing a message.')
      }
      const signed = await signMessageViaHub(address, message)
      return { publicKey: signed.publicKey, signature: signed.signature }
    },
    [nimiq, address],
  )

  const mobilePayConnect = useMemo(
    () => isMobileDevice() && !inNimiqPay && !isNimiqPayHost() && !address,
    [inNimiqPay, address],
  )

  const providerAvailability: ProviderAvailability = useMemo(() => {
    if (inNimiqPay || isNimiqPayHost() || (typeof window !== 'undefined' && window.nimiq)) {
      return 'pay'
    }
    if (typeof window !== 'undefined') return 'hub'
    return 'none'
  }, [inNimiqPay])

  const status: WalletConnectionStatus = useMemo(() => {
    if (address) return 'connected'
    if (
      connecting ||
      Boolean(walletStatus && walletStatus !== PAY_HANDOFF_HINT)
    ) {
      return 'connecting'
    }
    if (error && error !== LOGIN_CANCELED_MESSAGE) return 'error'
    return 'disconnected'
  }, [address, connecting, walletStatus, error])

  return {
    status,
    address,
    token,
    nimiq,
    connecting:
      connecting ||
      Boolean(walletStatus && !address && walletStatus !== PAY_HANDOFF_HINT),
    walletStatus,
    error,
    setError,
    connect,
    disconnect,
    signMessage,
    setNimiq,
    applySession,
    bootReady,
    inNimiqPay,
    mobilePayConnect,
    showOpenInPay,
    providerAvailability,
    walletMode: getWalletMode(),
  }
}
