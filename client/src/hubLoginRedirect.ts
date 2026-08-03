/**
 * Lenient Hub login redirect completion (when the browser referrer is empty).
 * Ported from VeriLock Hub redirect helpers (P1-01); login-only handlers.
 */

import HubApi from '@nimiq/hub-api'
import type { ChooseAddressResult, SignedMessage } from '@nimiq/hub-api'

import { createHubRedirectBehavior } from './hubRedirectBehavior'
import {
  clearRpcIdSearchParam,
  consumeRedirectHash,
  getHubReturnUrl,
  loadStoredRpcRequest,
  readRedirectResponse,
} from './hubRedirectParse'
import { walletError, walletLog, walletWarn } from './walletDebug'

const { RequestType } = HubApi

export type HubRedirectDeps = {
  appName: string
  getHubApi: () => HubApi
  bytesToHex: (bytes: Uint8Array) => string
}

function formatHubRedirectError(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof result === 'string' && result.trim()) return result
  return 'Hub redirect failed'
}

/**
 * Hub's default redirect parser requires browser referrer, which is often empty when
 * Hub sends the user back. Parse the URL hash (and stored rpc responses) ourselves.
 * Handles login only (signMessage / chooseAddress).
 */
export function processLenientHubRedirect(
  deps: HubRedirectDeps,
  getChallenge: (address?: string | null) => Promise<{ token: string; nonce: string }>,
  onComplete: (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => void,
  onError: (err: Error) => void,
): boolean {
  const redirect = readRedirectResponse()
  if (!redirect) return false

  const request = loadStoredRpcRequest(redirect.id)
  walletLog('hub:lenientRedirect', {
    redirectId: redirect.id,
    hasRequest: Boolean(request),
  })

  if (!request) {
    // Hash / ?rpcId= without rpcRequests cannot complete. Consume so Login is
    // not stuck forever on hasPendingHubRedirect / peekHubRedirectInUrl.
    walletWarn('hub:lenientRedirectMissingRequest', { id: redirect.id })
    consumeRedirectHash()
    clearRpcIdSearchParam()
    return true
  }

  consumeRedirectHash()
  clearRpcIdSearchParam()

  if (redirect.status === 'error') {
    onError(new Error(formatHubRedirectError(redirect.result)))
    return true
  }

  if (request.command === RequestType.CHOOSE_ADDRESS) {
    try {
      const { address } = redirect.result as ChooseAddressResult
      walletLog('hub:lenientChooseAddress', { address })
      void (async () => {
        try {
          const { token, nonce } = await getChallenge(address)
          const hub = deps.getHubApi()
          const behavior = createHubRedirectBehavior(getHubReturnUrl(), { token, flow: 'login' })
          await hub.signMessage(
            { appName: deps.appName, message: nonce, signer: address },
            behavior as Parameters<typeof hub.signMessage>[1],
          )
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
        }
      })()
      return true
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
      return true
    }
  }

  if (request.command === RequestType.SIGN_MESSAGE) {
    try {
      const token = request.state?.token as string | undefined
      if (!token) throw new Error('Login session expired - try again.')
      const msg = redirect.result as SignedMessage
      onComplete({
        token,
        address: msg.signer,
        publicKey: deps.bytesToHex(msg.signerPublicKey),
        signature: deps.bytesToHex(msg.signature),
      })
      return true
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
      return true
    }
  }

  walletError('hub:lenientRedirectUnhandled', { command: request.command })
  return false
}
