/**
 * Nimiq Watch explorer URL builders (server-side).
 * Ported from VeriLock `server/src/explorer.ts` (P1-01).
 * Mainnet: https://nimiq.watch — testnet: https://test.nimiq.watch
 */

export type ExplorerNetwork = 'mainnet' | 'testnet'

/**
 * Resolve active network from env (or an explicit override).
 * Accepts common aliases: main / mainnet, test / testnet.
 */
export function resolveExplorerNetwork(
  networkEnv: string | undefined = process.env.NIMIQ_NETWORK,
): ExplorerNetwork {
  const raw = (networkEnv ?? 'main').trim().toLowerCase()
  if (raw === 'test' || raw === 'testnet') return 'testnet'
  return 'mainnet'
}

export function explorerBaseUrl(network?: ExplorerNetwork | string): string {
  const resolved =
    network === 'testnet' || network === 'test'
      ? 'testnet'
      : network === 'mainnet' || network === 'main'
        ? 'mainnet'
        : resolveExplorerNetwork(typeof network === 'string' ? network : undefined)
  return resolved === 'testnet' ? 'https://test.nimiq.watch' : 'https://nimiq.watch'
}

/** Nimiq Watch expects the hash directly in the fragment, e.g. nimiq.watch/#ABCD… */
export function buildNimiqExplorerUrl(
  txHash: string,
  network?: ExplorerNetwork | string,
): string {
  const clean = txHash.replace(/^0x/i, '').toUpperCase()
  return `${explorerBaseUrl(network)}/#${clean}`
}

/** Nimiq Watch auto-detects NQ-prefixed account addresses in the fragment. */
export function buildNimiqAddressExplorerUrl(
  address: string,
  network?: ExplorerNetwork | string,
): string {
  const clean = address.replace(/\s+/g, '').toUpperCase()
  return `${explorerBaseUrl(network)}/#${clean}`
}

/** Loose check for a hex transaction hash (with optional 0x). */
export function isPlausibleTxHash(hash: string | null | undefined): boolean {
  if (hash == null || !String(hash).trim()) return false
  const clean = String(hash).replace(/^0x/i, '').trim()
  // Nimiq Albatross hashes are 32-byte hex (64 chars).
  return /^[0-9a-fA-F]{64}$/.test(clean)
}
