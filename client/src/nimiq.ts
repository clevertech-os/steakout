/**
 * Pay + Hub wallet facade: provider warmup, connection, message signing,
 * Hub redirect login, generic tx broadcast/poll, explorer-adjacent helpers.
 *
 * Ported from VeriLock `client/src/nimiq.ts` (P1-01); product-specific flows removed.
 *
 * Non-custodial: never constructs or signs staking txs outside the provider.
 * Staking writes go through `@nimiq/mini-app-sdk` methods only (P1-06+).
 */

import HubApi from '@nimiq/hub-api'
import type { ChooseAddressResult, SignedMessage, SignedTransaction } from '@nimiq/hub-api'
import { init, type ErrorResponse, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { createHubRedirectBehavior } from './hubRedirectBehavior'
import { processLenientHubRedirect } from './hubLoginRedirect'
import { saveHubReturnPath, savePayReturnPath } from './hubReturnPath'
import {
  clearStaleHubRpcStateIfIdle,
  getHubReturnUrl,
  peekHubRedirectInUrl,
  RPC_ID_SEARCH_PARAM,
} from './hubRedirectParse'
import { formatDisplayAddress } from './addresses'
import { tryDeriveTxHash } from './txHashFromSerialized'
import { walletLog, walletWarn } from './walletDebug'

export { peekHubRedirectInUrl, RPC_ID_SEARCH_PARAM }

const { RequestType } = HubApi

/**
 * Client network label (same source as NetworkBadge).
 * Hub + client RPC must follow this, otherwise "testnet" badge still opens mainnet Hub.
 */
const CLIENT_NETWORK = (import.meta.env.VITE_NIMIQ_NETWORK ?? 'mainnet').trim().toLowerCase()
const IS_TESTNET = CLIENT_NETWORK === 'testnet' || CLIENT_NETWORK === 'test'

/** Override with VITE_NIMIQ_HUB_URL; otherwise derive from network. */
const HUB_ENDPOINT =
  (import.meta.env.VITE_NIMIQ_HUB_URL as string | undefined)?.trim() ||
  (IS_TESTNET ? 'https://hub.nimiq-testnet.com' : 'https://hub.nimiq.com')

/** Override with VITE_NIMIQ_RPC_URL; used for client-side tx poll helpers. */
const NIMIQ_RPC_URL =
  (import.meta.env.VITE_NIMIQ_RPC_URL as string | undefined)?.trim() ||
  (IS_TESTNET ? 'https://rpc.testnet.nimiqwatch.com' : 'https://rpc.nimiqwatch.com')

/** Shown in Nimiq Hub / Pay when approving login and transactions. */
const APP_NAME = 'Steakout'

export function getClientNetwork(): string {
  return IS_TESTNET ? 'testnet' : CLIENT_NETWORK || 'mainnet'
}

export function getHubEndpoint(): string {
  return HUB_ENDPOINT
}

export type WalletMode = 'nimiq-pay' | 'hub'

let hubApi: HubApi | null = null
let hubRedirectHandlersReady = false

export function getProviderErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  const maybeError = (value as { error?: { message?: unknown } }).error
  if (maybeError && typeof maybeError.message === 'string') return maybeError.message
  return 'Provider request failed.'
}

export function getWalletMode(): WalletMode {
  if (isNimiqPayHost() || (typeof window !== 'undefined' && window.nimiq)) return 'nimiq-pay'
  return 'hub'
}

/** Nimiq Pay injects `window.nimiqPay` before page scripts — reliable host detection. */
export function isNimiqPayHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nimiqPay)
}

export async function probeNimiqPay(timeoutMs = 2_500): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (window.nimiq) return true
  const timeout = isNimiqPayHost() ? Math.max(timeoutMs, 20_000) : timeoutMs
  try {
    await init({ timeout })
    return Boolean(window.nimiq)
  } catch {
    return false
  }
}

/** Pre-warm the injected provider as soon as the Nimiq Pay host is detected. */
export function warmNimiqProvider(): void {
  if (!isNimiqPayHost() || window.nimiq) return
  void init({ timeout: 30_000 }).catch(() => {
    /* user may connect manually */
  })
}

function getHubApi(): HubApi {
  if (!hubApi) hubApi = new HubApi(HUB_ENDPOINT)
  return hubApi
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function ensureNimiqProvider(existing: Awaited<ReturnType<typeof init>> | null = null) {
  if (existing) return existing
  if (typeof window !== 'undefined' && window.nimiq) return window.nimiq
  const inPay = await probeNimiqPay(isNimiqPayHost() ? 30_000 : 10_000)
  if (!inPay) {
    throw new Error(
      'Nimiq Pay wallet not found. On desktop, connect via Nimiq Hub instead.',
    )
  }
  const { nimiq } = await connectNimiq()
  return nimiq
}

/**
 * First native Pay sheet: account access (`connect` → `listAccounts`).
 * Callers that also need a login signature should issue the server challenge
 * *before* this, then call `signChallenge` immediately after — never await
 * network between the two sheets (WebView can reclaim focus and hide Approve).
 */
export async function connectNimiq() {
  const timeout = isNimiqPayHost() ? 30_000 : 10_000
  const nimiq = await init({ timeout })
  // connect() prompts the native Nimiq Pay account dialog when needed.
  await nimiq.connect()
  const accountsResult = await nimiq.listAccounts()
  const accountsError = getProviderErrorMessage(accountsResult)
  if (accountsError) throw new Error(accountsError)
  const accounts = accountsResult as string[]
  if (!accounts.length) throw new Error('No Nimiq accounts returned.')
  return { nimiq, address: accounts[0] }
}

export async function signChallenge(nimiq: Awaited<ReturnType<typeof init>>, nonce: string) {
  // Pass as object with isHex:false so the provider treats the nonce as a plain text/UTF-8 message
  // (not a hex string). This must match the isHex:false passed to verifySignature on the server for 'pay'.
  const signatureResult = await nimiq.sign({ message: nonce, isHex: false })
  const signatureError = getProviderErrorMessage(signatureResult)
  if (signatureError) throw new Error(signatureError)
  const { publicKey, signature } = signatureResult as { publicKey: string; signature: string }
  return { publicKey, signature }
}

export function isPopupBlockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /failed to open popup|popup blocked|blocked/i.test(message)
}

export function popupBlockedHelp(): string {
  return (
    'Pop-up blocked. Allow pop-ups for this site in your browser settings, ' +
    'or open Steakout inside the Nimiq Pay app (recommended, no pop-ups needed).'
  )
}

/** Non-deprecated CallOptions redirect (avoids hub-api callAndSaveLocalState warn). */
function hubRedirectBehavior(localState: Record<string, unknown>) {
  return createHubRedirectBehavior(getHubReturnUrl(), localState)
}

/**
 * Prefer full-page Hub redirect on mobile (popup blockers).
 * On desktop, prefer **popup**: choose-address → challenge → sign-message in one
 * chain without putting Hub’s response in the SPA hash (hash router conflict).
 * Explicit `useRedirect` / `usePopup` still override.
 */
export function shouldUseHubRedirect(options?: { useRedirect?: boolean; usePopup?: boolean }): boolean {
  if (options?.usePopup === true) return false
  if (options?.useRedirect === false) return false
  if (options?.useRedirect === true) return true
  // Mobile / kiosk: redirects avoid popup blockers (Nimiq integration guide).
  if (isMobileDevice()) return true
  // Desktop: popup keeps the two-step login inside the SPA.
  return false
}

export const HUB_REDIRECT_MESSAGE = 'Redirecting to Nimiq Hub…'

export function isHubRedirectError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message === HUB_REDIRECT_MESSAGE
}

/** Friendly copy when the user dismisses Hub / Pay login. */
export const LOGIN_CANCELED_MESSAGE = 'Login Canceled'

/**
 * Per Nimiq Hub integration guide: explicit cancel vs error.
 * Hub/Pay may surface "Request was cancelled", "CANCELED", or similar.
 */
export function isHubCancelError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).trim()
  if (!message) return false
  if (message === 'Request was cancelled') return true
  if (/^cancell?ed$/i.test(message)) return true
  if (/cancell?ed by user/i.test(message)) return true
  if (/request was cancell?ed/i.test(message)) return true
  if (/user cancell?ed/i.test(message)) return true
  return false
}

// ── Client-side RPC helpers (broadcast / poll only; not identity) ──────────

function normalizeTxHash(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase()
}

function signedTxHash(signed: SignedTransaction): string {
  if (signed.hash) return normalizeTxHash(signed.hash)
  throw new Error('Hub did not return a transaction hash.')
}

function formatRpcError(error: { message?: string; data?: unknown }): string {
  const message = error.message?.trim() || 'Nimiq RPC error'
  const data = typeof error.data === 'string' ? error.data.trim() : ''
  if (!data || message.toLowerCase().includes(data.toLowerCase())) return message
  return `${message}: ${data}`
}

function isTransactionNotFoundError(message: string): boolean {
  return message.toLowerCase().includes('not found')
}

async function nimiqRpcCall<T>(
  method: string,
  params: unknown[],
  options?: { allowEmpty?: boolean },
): Promise<T> {
  const res = await fetch(NIMIQ_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  if (!res.ok) throw new Error(`Nimiq RPC HTTP ${res.status}`)
  const json = (await res.json()) as {
    result?: { data: T }
    error?: { message: string; data?: unknown }
  }
  if (json.error) throw new Error(formatRpcError(json.error))
  if (json.result?.data === undefined || json.result?.data === null) {
    if (options?.allowEmpty) return undefined as T
    throw new Error(`Empty Nimiq RPC response (${method})`)
  }
  return json.result.data
}

async function transactionKnownOnNetwork(hash: string): Promise<boolean> {
  const clean = normalizeTxHash(hash)
  try {
    await nimiqRpcCall<Record<string, unknown>>('getTransactionByHash', [clean])
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isTransactionNotFoundError(message)) {
      walletWarn('hub:transactionLookupFailed', { hash: clean, message })
    }
  }
  try {
    await nimiqRpcCall<Record<string, unknown>>('getTransactionFromMempool', [clean])
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isTransactionNotFoundError(message)) {
      walletWarn('hub:mempoolLookupFailed', { hash: clean, message })
    }
    return false
  }
}

const BROADCAST_POLL_MS = 1_500
const BROADCAST_VERIFY_MS = 4_000
const BROADCAST_VERIFY_POLL_MS = 500
const HUB_CHECKOUT_NETWORK_WAIT_MS = 30_000
const RELAY_NETWORK_SOFT_WAIT_MS = 20_000

async function waitForTransactionOnNetwork(
  hash: string,
  timeoutMs: number,
  options?: { required?: boolean },
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await transactionKnownOnNetwork(hash)) {
      walletLog('hub:transactionVisibleOnNetwork', { hash })
      return true
    }
    await new Promise(resolve => setTimeout(resolve, BROADCAST_POLL_MS))
  }
  if (options?.required) {
    throw new Error(
      'Transaction was signed in Hub but did not reach the Nimiq network. Try again.',
    )
  }
  return false
}

export type TransactionBroadcastFallback = (serializedTx: string) => Promise<void>

function normalizeRawTransactionHex(rawTx: string): string {
  const clean = rawTx.replace(/^0x/i, '').trim()
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid serialized transaction from Hub')
  }
  return clean.toLowerCase()
}

function serializedTxFromSigned(signed: SignedTransaction): string {
  if (signed.serializedTx) return normalizeRawTransactionHex(signed.serializedTx)
  if (signed.transaction instanceof Uint8Array && signed.transaction.length > 0) {
    return bytesToHex(signed.transaction)
  }
  throw new Error('Hub did not return a serialized transaction.')
}

async function broadcastViaServer(
  serialized: string,
  broadcastFallback: TransactionBroadcastFallback,
  label: string,
): Promise<void> {
  walletLog(label, { bytes: serialized.length / 2 })
  await broadcastFallback(serialized)
}

async function waitForTransactionVisible(
  hash: string,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await transactionKnownOnNetwork(hash)) return true
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return false
}

async function broadcastRawTransaction(
  serialized: string,
  broadcastFallback?: TransactionBroadcastFallback,
  options?: { preferServer?: boolean },
): Promise<void> {
  const clean = normalizeRawTransactionHex(serialized)

  if (options?.preferServer && broadcastFallback) {
    await broadcastViaServer(clean, broadcastFallback, 'hub:broadcastViaServer')
    return
  }

  walletLog('hub:broadcastRawTransaction', { bytes: clean.length / 2 })
  let acceptedHash: string | null = null
  try {
    const hash = await nimiqRpcCall<string>('sendRawTransaction', [clean])
    if (hash) {
      acceptedHash = normalizeTxHash(hash)
      walletLog('hub:broadcastAccepted', { hash: acceptedHash })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    walletWarn('hub:clientBroadcastFailed', { message })
  }

  if (acceptedHash && broadcastFallback) {
    const visible = await waitForTransactionVisible(
      acceptedHash,
      BROADCAST_VERIFY_MS,
      BROADCAST_VERIFY_POLL_MS,
    )
    if (visible) return
    walletWarn('hub:clientBroadcastNotVisible', { hash: acceptedHash })
    await broadcastViaServer(clean, broadcastFallback, 'hub:broadcastViaServerRetry')
    return
  }

  if (acceptedHash) return

  if (broadcastFallback) {
    await broadcastViaServer(clean, broadcastFallback, 'hub:broadcastViaServer')
    return
  }

  throw new Error('Could not broadcast transaction to the Nimiq network.')
}

/** Relay a Hub-signed transaction to the network; returns normalized tx hash. */
export async function relaySignedTransaction(
  signed: SignedTransaction,
  broadcastFallback?: TransactionBroadcastFallback,
): Promise<string> {
  const hash = signedTxHash(signed)
  if (await transactionKnownOnNetwork(hash)) {
    walletLog('hub:relaySkipped (already known)', { hash })
    return hash
  }

  const serialized = serializedTxFromSigned(signed)
  walletLog('hub:relaySignedTransaction', { hash })
  let broadcastAttempted = false
  try {
    await broadcastRawTransaction(serialized, broadcastFallback, { preferServer: true })
    broadcastAttempted = true
  } catch (err) {
    if (await transactionKnownOnNetwork(hash)) {
      walletLog('hub:relayRecovered (broadcast race)', { hash })
      return hash
    }
    throw err
  }
  if (await waitForTransactionOnNetwork(hash, RELAY_NETWORK_SOFT_WAIT_MS)) {
    return hash
  }
  if (broadcastAttempted) {
    walletWarn('hub:relayProceedingBeforeVisible', { hash })
    return hash
  }
  throw new Error('Could not broadcast transaction to the Nimiq network.')
}

/**
 * Finalize a Hub-signed transaction (checkout already broadcasts; signTransaction does not).
 * Returns the normalized tx hash for server-side confirm matching (P1-06).
 */
export async function finalizeHubTransaction(
  signed: SignedTransaction,
  options?: {
    hubBroadcast?: boolean
    broadcastFallback?: TransactionBroadcastFallback
  },
): Promise<string> {
  const hash = signedTxHash(signed)
  if (await transactionKnownOnNetwork(hash)) {
    walletLog('hub:txAlreadyOnNetwork', { hash })
    return hash
  }

  if (options?.hubBroadcast) {
    walletLog('hub:checkoutAwaitNetwork', { hash })
    if (await waitForTransactionOnNetwork(hash, HUB_CHECKOUT_NETWORK_WAIT_MS)) {
      return hash
    }
    walletWarn('hub:checkoutNotVisibleYet', { hash })
    try {
      return await relaySignedTransaction(signed, options?.broadcastFallback)
    } catch (err) {
      walletWarn('hub:checkoutRelayFallbackFailed', err)
      return hash
    }
  }

  return relaySignedTransaction(signed, options?.broadcastFallback)
}

// ── Hub redirect login ─────────────────────────────────────────────────────

const hubRedirectDeps = () => ({
  appName: APP_NAME,
  getHubApi,
  bytesToHex,
})

function registerHubLoginHandlers(
  hub: HubApi,
  getChallenge: (address?: string | null) => Promise<{ token: string; nonce: string }>,
  onComplete: (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => void,
  onError: (err: Error) => void,
): void {
  /**
   * Hub login trip 1 → 2: chooseAddress returns an address (and auto-opens
   * onboard when the user has no wallet). Then challenge + signMessage.
   * Single-trip signMessage-without-signer skips Hub’s empty-wallet onboard.
   */
  hub.on(RequestType.CHOOSE_ADDRESS, async chosen => {
    try {
      const { address } = chosen as ChooseAddressResult
      const { token, nonce } = await getChallenge(address)
      const behavior = hubRedirectBehavior({ token, flow: 'login' })
      await hub.signMessage(
        { appName: APP_NAME, message: nonce, signer: address },
        behavior as Parameters<typeof hub.signMessage>[1],
      )
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })
  hub.on(RequestType.SIGN_MESSAGE, (signed, state) => {
    try {
      const token = state?.token as string | undefined
      if (!token) throw new Error('Login session expired - try again.')
      const msg = signed as SignedMessage
      onComplete({
        token,
        address: msg.signer,
        publicKey: bytesToHex(msg.signerPublicKey),
        signature: bytesToHex(msg.signature),
      })
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export type HubRedirectSetupResult = {
  redirectHandled: boolean
  loginHandled: boolean
}

/**
 * Call on app load to finish Hub redirect login round-trips.
 * Requires a challenge issuer (wired by P1-02 auth API).
 */
export async function setupHubRedirectHandlers(
  getChallenge: (address?: string | null) => Promise<{ token: string; nonce: string }>,
  onComplete: (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => void,
  onError: (err: Error) => void,
): Promise<HubRedirectSetupResult> {
  const hub = getHubApi()
  let loginRedirectHandled = false

  const handleLoginComplete = (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => {
    loginRedirectHandled = true
    onComplete(result)
  }

  const lenientHandled = processLenientHubRedirect(
    hubRedirectDeps(),
    getChallenge,
    handleLoginComplete,
    onError,
  )

  if (!hubRedirectHandlersReady) {
    hubRedirectHandlersReady = true
    registerHubLoginHandlers(hub, getChallenge, handleLoginComplete, onError)
  }

  if (lenientHandled) {
    walletLog('hub:lenientRedirectHandled', {
      loginHandled: loginRedirectHandled,
    })
    return {
      redirectHandled: true,
      loginHandled: loginRedirectHandled,
    }
  }

  walletLog('hub:checkRedirectResponse', {
    href: window.location.href,
    rpcId: new URLSearchParams(window.location.search).get(RPC_ID_SEARCH_PARAM),
  })
  await hub.checkRedirectResponse()
  walletLog('hub:redirectHandlersReady', {
    redirectHandled: loginRedirectHandled,
    loginRedirectHandled,
  })
  return {
    redirectHandled: loginRedirectHandled,
    loginHandled: loginRedirectHandled,
  }
}

/**
 * Hub login via chooseAddress → signMessage (two Hub trips on redirect).
 *
 * Why not signMessage alone? Hub’s Sign Message view does **not** auto-open
 * onboard when the user has zero wallets. Choose Address does.
 *
 * Redirect: chooseAddress → (onboard if needed) → return → challenge → signMessage.
 * Popup: chooseAddress → challenge → signMessage (same window chain).
 *
 * Requires auth challenge issuer (P1-02). For address-only connect without auth,
 * use `chooseAddressViaHub` instead.
 */
export async function connectViaHub(
  getChallenge: (address?: string | null) => Promise<{ token: string; nonce: string }>,
  options?: { preferRedirect?: boolean },
): Promise<{
  token: string
  address: string
  publicKey: string
  signature: string
  authScheme: 'hub'
}> {
  const hub = getHubApi()
  const preferRedirect = options?.preferRedirect ?? true

  clearStaleHubRpcStateIfIdle()

  if (preferRedirect) {
    saveHubReturnPath()
    walletLog('hub:redirectChooseAddress', { returnUrl: getHubReturnUrl() })
    const behavior = hubRedirectBehavior({ flow: 'login' })
    await hub.chooseAddress(
      { appName: APP_NAME },
      behavior as Parameters<typeof hub.chooseAddress>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
    walletLog('hub:popupChooseAddress')
    const chosen = await hub.chooseAddress({ appName: APP_NAME })
    const address = chosen.address
    const { token, nonce } = await getChallenge(address)
    walletLog('hub:popupSignMessageLogin', { address })
    const signed = await hub.signMessage({
      appName: APP_NAME,
      message: nonce,
      signer: address,
    })
    return {
      token,
      address: signed.signer,
      publicKey: bytesToHex(signed.signerPublicKey),
      signature: bytesToHex(signed.signature),
      authScheme: 'hub',
    }
  } catch (err) {
    if (isPopupBlockedError(err)) {
      throw new Error(popupBlockedHelp())
    }
    throw err
  }
}

/**
 * Address-only Hub connect (no server challenge). Used until P1-02 wires auth.
 * Prefer `connectViaHub` once challenge/verify endpoints exist.
 */
export async function chooseAddressViaHub(options?: {
  preferRedirect?: boolean
}): Promise<{ address: string }> {
  const hub = getHubApi()
  const preferRedirect = options?.preferRedirect ?? true

  clearStaleHubRpcStateIfIdle()

  if (preferRedirect) {
    saveHubReturnPath()
    walletLog('hub:redirectChooseAddressOnly', { returnUrl: getHubReturnUrl() })
    const behavior = hubRedirectBehavior({ flow: 'choose_address' })
    await hub.chooseAddress(
      { appName: APP_NAME },
      behavior as Parameters<typeof hub.chooseAddress>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
    const chosen = await hub.chooseAddress({ appName: APP_NAME })
    return { address: chosen.address }
  } catch (err) {
    if (isPopupBlockedError(err)) {
      throw new Error(popupBlockedHelp())
    }
    throw err
  }
}

/** Sign an arbitrary UTF-8 message via Hub (popup). Requires a known signer address. */
export async function signMessageViaHub(
  address: string,
  message: string,
): Promise<{ publicKey: string; signature: string; signer: string }> {
  const hub = getHubApi()
  try {
    const signed = await hub.signMessage({
      appName: APP_NAME,
      message,
      signer: address,
    })
    return {
      publicKey: bytesToHex(signed.signerPublicKey),
      signature: bytesToHex(signed.signature),
      signer: signed.signer,
    }
  } catch (err) {
    if (isPopupBlockedError(err)) {
      throw new Error(popupBlockedHelp())
    }
    throw err
  }
}

// ── Mini-app / mobile helpers ──────────────────────────────────────────────

/**
 * Build a Nimiq Pay mini-app target URL.
 * Prefer full path+query+hash so SPA deep links survive Pay open.
 */
export function normalizeMiniAppUrl(appUrl: string): string {
  try {
    const base =
      typeof window !== 'undefined' ? window.location.href : 'https://steakout.app/'
    const parsed = new URL(appUrl, base)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    const search = parsed.search || ''
    const hash = parsed.hash || ''
    return `${parsed.origin}${path}${search}${hash}`
  } catch {
    return appUrl.replace(/\/+$/, '')
  }
}

/** Current page as a mini-app URL. */
export function currentMiniAppUrl(): string {
  if (typeof window === 'undefined') return 'https://steakout.app'
  return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
}

export const NIMIQ_PAY_IOS_URL = 'https://apps.apple.com/us/app/nimiq-pay/id6471844738'
export const NIMIQ_PAY_ANDROID_URL =
  'https://play.google.com/store/apps/details?id=com.nimiq.pay'

/**
 * Whether this client is a phone/tablet for login & Pay deeplinks.
 *
 * Uses **browser-reported identity only** (UA / platform / touch points) — never
 * CSS viewport width. Docking DevTools or shrinking a desktop window must not
 * flip this.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
  // iPadOS 13+ often reports as Macintosh (desktop UA) with multi-touch.
  return (
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  )
}

export function getMiniAppWebUrl(appUrl?: string): string {
  return normalizeMiniAppUrl(appUrl ?? currentMiniAppUrl())
}

/**
 * Origin used in QR / share links that a **phone** must open.
 * Locally `window.location.origin` is often `http://localhost:5173` — the phone
 * cannot reach desktop localhost. Set `VITE_PUBLIC_APP_URL` to a tunnel or LAN URL.
 */
export function getPublicAppOrigin(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim()
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}

/** True when the public origin is loopback (phone cannot open desktop localhost). */
export function isLoopbackAppOrigin(origin = getPublicAppOrigin()): boolean {
  try {
    const host = new URL(origin).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return true
  }
}

/**
 * True for plain HTTP app URLs (typical LAN dev).
 * Nimiq Pay mini-app WebViews commonly refuse cleartext `http://` loads — Pay opens
 * but the page stays blank. Prefer HTTPS (tunnel or deployed host).
 */
export function isCleartextHttpAppUrl(appUrl: string): boolean {
  try {
    return new URL(appUrl).protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Mini-app URL a phone can open (LAN / tunnel when desktop is on localhost).
 * Rewrites loopback origins to `VITE_PUBLIC_APP_URL` when configured.
 */
export function getPhoneReachableMiniAppUrl(appUrl?: string): string {
  const raw = normalizeMiniAppUrl(appUrl ?? currentMiniAppUrl())
  const publicOrigin = getPublicAppOrigin()
  try {
    const parsed = new URL(raw)
    if (
      isLoopbackAppOrigin(parsed.origin) &&
      publicOrigin &&
      !isLoopbackAppOrigin(publicOrigin)
    ) {
      const pub = new URL(publicOrigin)
      parsed.protocol = pub.protocol
      parsed.host = pub.host
    }
    return parsed.href
  } catch {
    return raw
  }
}

/** `nimiqpay://miniapp?url=…` using a phone-reachable web URL. */
export function getPhoneReachablePayDeepLink(appUrl?: string): string {
  return nimiqPayDeepLink(getPhoneReachableMiniAppUrl(appUrl))
}

/**
 * QR image URL for a payload (no extra npm dependency).
 * Uses a public QR API; the encoded string is still shown as plain text for offline fallback.
 */
export function buildQrImageUrl(payload: string, size = 220): string {
  const dim = Math.max(120, Math.min(400, Math.floor(size)))
  return `https://api.qrserver.com/v1/create-qr-code/?size=${dim}x${dim}&margin=8&ecc=M&data=${encodeURIComponent(payload)}`
}

/**
 * `nimiqpay://miniapp?url=<https url>`
 * @see https://www.nimiq.dev/mini-apps - Sharing Your Mini App
 */
export function nimiqPayDeepLink(appUrl: string): string {
  const target = normalizeMiniAppUrl(appUrl)
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`
}

export type NimiqPayLaunchResult = 'already-in-pay' | 'launched' | 'unavailable'

/**
 * Only attempts `nimiqpay://` on mobile — desktop browsers log a scheme error and
 * never leave the tab. Callers must treat “launched” as best-effort and fall back
 * if the page stays visible (see useWallet scheduleDeeplinkFallback).
 */
export function launchNimiqPayMiniApp(appUrl?: string): NimiqPayLaunchResult {
  if (isNimiqPayHost()) return 'already-in-pay'
  if (!isMobileDevice()) return 'unavailable'
  const target = appUrl ?? currentMiniAppUrl()
  try {
    const parsed = new URL(normalizeMiniAppUrl(target), window.location.origin)
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
    if (path && path !== '/') savePayReturnPath(path)
  } catch {
    savePayReturnPath()
  }
  const deeplink = nimiqPayDeepLink(target)
  try {
    window.location.assign(deeplink)
  } catch {
    return 'unavailable'
  }
  return 'launched'
}

export async function copyNimiqPayDeepLink(appUrl?: string): Promise<string> {
  const link = nimiqPayDeepLink(appUrl ?? currentMiniAppUrl())
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(link)
  }
  return link
}

// ── Staking provider wrappers (P1-12) ──────────────────────────────────────
// Non-custodial: only window.nimiq / mini-app-sdk methods. No local signing of
// raw staking transactions. Product stake flow does NOT hard-block mainnet
// (spike harness is testnet-only). Callers must show ReviewSheet first.

export type ProviderTxOutcome =
  | {
      kind: 'hash'
      hash: string
      raw: string
      /** How the hash was obtained from the provider string. */
      source: 'hash' | 'serialized'
    }
  | { kind: 'raw'; value: string; raw: string }
  | { kind: 'error'; message: string; type?: string; raw: string }

/**
 * Classification label for harness / debug UI.
 * - `hash` — provider returned a 64-hex hash directly
 * - `serialized→hash` — non-64-hex string parsed via Transaction.fromAny
 * - `raw` — string that could not be derived into a hash
 * - `error` — ErrorResponse or unexpected shape
 */
export type ProviderTxClassification = 'hash' | 'serialized→hash' | 'raw' | 'error'

export function providerTxClassification(
  outcome: ProviderTxOutcome,
): ProviderTxClassification {
  if (outcome.kind === 'error') return 'error'
  if (outcome.kind === 'raw') return 'raw'
  return outcome.source === 'serialized' ? 'serialized→hash' : 'hash'
}

/**
 * Normalize a provider staking return for confirm polling.
 * - 64-hex string → treat as tx hash (source: 'hash')
 * - other hex string → try Transaction.fromAny(...).hash() (source: 'serialized'); on failure kind:'raw'
 * - ErrorResponse → cancel/error neutrally
 *
 * Provisional: package types document basic tx as serialized; staking methods share
 * the same Promise<string | ErrorResponse> family. Device must confirm semantics.
 */
export function normalizeProviderTxResult(result: unknown): ProviderTxOutcome {
  const errMsg = getProviderErrorMessage(result)
  if (errMsg) {
    const type =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof (result as ErrorResponse).error?.type === 'string'
        ? (result as ErrorResponse).error.type
        : undefined
    return {
      kind: 'error',
      message: errMsg,
      type,
      raw: formatProviderRaw(result),
    }
  }

  if (typeof result === 'string') {
    const trimmed = result.trim()
    const derived = tryDeriveTxHash(trimmed)
    if (derived) {
      return {
        kind: 'hash',
        hash: derived.hash,
        raw: trimmed,
        source: derived.source,
      }
    }
    return { kind: 'raw', value: trimmed, raw: trimmed }
  }

  return {
    kind: 'error',
    message: 'Unexpected wallet response. No staking change was confirmed by Steakout.',
    raw: formatProviderRaw(result),
  }
}

function formatProviderRaw(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

async function withConnectedProvider(
  existing?: NimiqProvider | null,
): Promise<NimiqProvider> {
  const provider = await ensureNimiqProvider(existing ?? null)
  await provider.connect()
  // App testnet vs Pay mainnet is a common blank failure — refuse early with a clear message.
  try {
    const active = (provider.getNetwork?.() ?? '').trim().toLowerCase()
    if (IS_TESTNET && active && active !== 'testnet' && active !== 'test') {
      throw new Error(
        `Nimiq Pay is on “${active}”, but Steakout is testnet. Switch Pay to testnet and try again.`,
      )
    }
    if (!IS_TESTNET && (active === 'testnet' || active === 'test')) {
      throw new Error(
        `Nimiq Pay is on testnet, but Steakout is mainnet. Switch Pay to mainnet (or use a testnet app build).`,
      )
    }
  } catch (err) {
    if (err instanceof Error && /Nimiq Pay is on/i.test(err.message)) throw err
    // getNetwork may be missing on older hosts — continue.
  }
  return provider
}

function outcomeFromThrown(err: unknown): ProviderTxOutcome {
  const message =
    err instanceof Error
      ? err.message
      : getProviderErrorMessage(err) || 'Wallet request failed.'
  return {
    kind: 'error',
    message,
    raw: formatProviderRaw(err),
  }
}

/** Create staker + delegate. ReviewSheet must have been confirmed first. */
export async function sendNewStakerTransaction(
  args: { delegation: string; value: number },
  existing?: NimiqProvider | null,
): Promise<ProviderTxOutcome> {
  try {
    const provider = await withConnectedProvider(existing)
    // SDK docs use spaced NQ form; compact form can fail on some hosts.
    const result = await provider.sendNewStakerTransaction({
      delegation: formatDisplayAddress(args.delegation),
      value: args.value,
    })
    return normalizeProviderTxResult(result)
  } catch (err) {
    return outcomeFromThrown(err)
  }
}

/** Add stake to existing staker. */
export async function sendStakeTransaction(
  args: { value: number },
  existing?: NimiqProvider | null,
): Promise<ProviderTxOutcome> {
  try {
    const provider = await withConnectedProvider(existing)
    const result = await provider.sendStakeTransaction({ value: args.value })
    return normalizeProviderTxResult(result)
  } catch (err) {
    return outcomeFromThrown(err)
  }
}

/** Change delegation. */
export async function sendUpdateStakerTransaction(
  args: { newDelegation: string; reactivateAllStake?: boolean },
  existing?: NimiqProvider | null,
): Promise<ProviderTxOutcome> {
  try {
    const provider = await withConnectedProvider(existing)
    const result = await provider.sendUpdateStakerTransaction({
      newDelegation: formatDisplayAddress(args.newDelegation),
      reactivateAllStake: args.reactivateAllStake,
    })
    return normalizeProviderTxResult(result)
  } catch (err) {
    return outcomeFromThrown(err)
  }
}

/** Retire stake (waiting period applies). */
export async function sendRetireStakeTransaction(
  args: { retireStake: number },
  existing?: NimiqProvider | null,
): Promise<ProviderTxOutcome> {
  try {
    const provider = await withConnectedProvider(existing)
    const result = await provider.sendRetireStakeTransaction({
      retireStake: args.retireStake,
    })
    return normalizeProviderTxResult(result)
  } catch (err) {
    return outcomeFromThrown(err)
  }
}

/** Remove retired stake after waiting period. */
export async function sendRemoveStakeTransaction(
  args: { value: number },
  existing?: NimiqProvider | null,
): Promise<ProviderTxOutcome> {
  try {
    const provider = await withConnectedProvider(existing)
    const result = await provider.sendRemoveStakeTransaction({ value: args.value })
    return normalizeProviderTxResult(result)
  } catch (err) {
    return outcomeFromThrown(err)
  }
}

/** Set active stake balance. */
export async function sendSetActiveStakeTransaction(
  args: { newActiveBalance: number },
  existing?: NimiqProvider | null,
): Promise<ProviderTxOutcome> {
  try {
    const provider = await withConnectedProvider(existing)
    const result = await provider.sendSetActiveStakeTransaction({
      newActiveBalance: args.newActiveBalance,
    })
    return normalizeProviderTxResult(result)
  } catch (err) {
    return outcomeFromThrown(err)
  }
}