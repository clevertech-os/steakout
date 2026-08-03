/**
 * WalletAuthApi adapter for Steakout cookie sessions (P1-09).
 *
 * Maps useWallet's VeriLock-shaped `{ token, nonce }` challenge interface onto
 * server routes: POST /api/auth/challenge|verify + GET /api/me (API.md §4).
 * Session identity lives in the httpOnly `steakout_session` cookie — the
 * challengeId is only a short-lived verify handle, not a Bearer token.
 */

import { isValidNimiqAddress, normalizeAddress } from '../addresses'
import type { WalletAuthApi } from '../wallet/useWallet'
import { apiGet, apiPost } from './http'

interface ChallengeResponse {
  challengeId: string
  message: string
  expiresAt: string
}

interface VerifyResponse {
  address: string
  sessionExpiresAt: string
}

interface MeResponse {
  address: string
  sessionExpiresAt: string
}

export const walletAuthApi: WalletAuthApi = {
  async challenge(address?: string | null) {
    const raw = address?.trim() ?? ''
    if (!raw || !isValidNimiqAddress(raw)) {
      throw new Error(
        'A valid Nimiq address is required to start sign-in. Connect the wallet first.',
      )
    }
    const normalized = normalizeAddress(raw)
    const data = await apiPost<ChallengeResponse>('/api/auth/challenge', {
      address: normalized,
    })
    // token → challengeId; nonce → exact message to sign (Pay sign / Hub signMessage).
    return { token: data.challengeId, nonce: data.message }
  },

  async verify(
    token: string,
    body: { publicKey: string; signature: string; authScheme: 'pay' | 'hub' },
  ) {
    // authScheme is client-path metadata only; server verifies the signed message envelope.
    void body.authScheme
    const data = await apiPost<VerifyResponse>('/api/auth/verify', {
      challengeId: token,
      signature: body.signature,
      publicKey: body.publicKey,
    })
    return { address: normalizeAddress(data.address) }
  },

  async me(_token: string) {
    // Cookie carries the session; token arg is ignored (may be a spent challengeId).
    void _token
    return apiGet<MeResponse>('/api/me')
  },
}
