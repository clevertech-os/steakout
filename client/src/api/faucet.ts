/**
 * Public Nimiq testnet faucet (TestAlbatross).
 * Browser-callable; CORS allows *. Not available / not used on mainnet.
 *
 * @see https://faucet.pos.nimiq-testnet.com (tapit)
 */

import { formatDisplayAddress, isValidNimiqAddress, normalizeAddress } from '../addresses'

const FAUCET_URL = 'https://faucet.pos.nimiq-testnet.com/tapit'

export interface FaucetTapResult {
  success: boolean
  message: string
  expectedBlocks?: number
}

/**
 * Request testnet NIM for a wallet address.
 * Sends form body `address=…` (spaces allowed; faucet accepts display form).
 */
export async function requestTestnetFaucet(address: string): Promise<FaucetTapResult> {
  if (!isValidNimiqAddress(address)) {
    throw new Error('A valid Nimiq address is required to request testnet NIM.')
  }
  const display = formatDisplayAddress(normalizeAddress(address))

  const response = await fetch(FAUCET_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ address: display }).toString(),
  })

  let body: unknown = null
  const text = await response.text()
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const msg =
      body &&
      typeof body === 'object' &&
      body !== null &&
      'msg' in body &&
      typeof (body as { msg: unknown }).msg === 'string'
        ? (body as { msg: string }).msg
        : `Faucet request failed (HTTP ${response.status}).`
    throw new Error(msg)
  }

  if (body && typeof body === 'object' && body !== null) {
    const record = body as { success?: unknown; msg?: unknown; expectedBlocks?: unknown }
    const success = record.success === true
    const message =
      typeof record.msg === 'string' && record.msg.trim()
        ? record.msg.trim()
        : success
          ? 'Testnet NIM are on the way.'
          : 'Faucet did not confirm the request.'
    const expectedBlocks =
      typeof record.expectedBlocks === 'number' ? record.expectedBlocks : undefined
    if (!success) {
      throw new Error(message)
    }
    return { success: true, message, expectedBlocks }
  }

  return { success: true, message: 'Testnet NIM are on the way.' }
}
