/**
 * Wallet-level balance for Pay-aligned UI.
 *
 * Nimiq Pay often holds spendable-looking NIM in open HTLC contracts (sender =
 * user) for fast payment paths. A plain getAccountByAddress only returns the
 * basic free balance, which understates what Pay shows.
 *
 * We observe open HTLCs by scanning recent outbound txs and re-reading those
 * contract accounts. Status: Verified observation (RPC account type + sender).
 */

import { normalizeAddress } from './addresses.js'
import {
  fetchTransactionsByAddress,
  getAccountByAddress,
  type NimiqAccount,
  type NimiqTransaction,
} from './nimiq-rpc.js'

/** How many recent txs to scan for contract destinations. */
export const HTLC_SCAN_TX_MAX = 40

/** Cap concurrent getAccountByAddress calls during HTLC discovery. */
const HTLC_LOOKUP_CONCURRENCY = 4

export interface WalletBalanceBreakdown {
  /** Free basic-account balance (stake sizing baseline). Null if account read failed. */
  accountBalanceLuna: number | null
  /** Sum of open HTLC balances where this address is the contract sender. */
  htlcBalanceLuna: number
  /** account + htlc when free balance known; null if free read failed. */
  walletBalanceLuna: number | null
  /** Distinct open HTLC contracts counted. */
  htlcCount: number
}

export interface ReadWalletBalanceOptions {
  address: string
  rpcUrl?: string
  getAccount?: (address: string) => Promise<NimiqAccount>
  getTransactions?: (
    address: string,
    max: number,
  ) => Promise<NimiqTransaction[]>
  /** Skip HTLC scan (tests). */
  skipHtlcScan?: boolean
  maxTxs?: number
}

function nonNegInt(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function isHtlcAccount(account: NimiqAccount): boolean {
  return String(account.type).toLowerCase() === 'htlc'
}

function accountSender(account: NimiqAccount): string | null {
  const raw = account.sender
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null
}

/**
 * Sum balances of open HTLCs whose `sender` is the given address.
 * Best-effort: scan failures return 0 (never invents funds).
 */
export async function sumOpenHtlcBalanceAsSender(options: {
  address: string
  getAccount: (address: string) => Promise<NimiqAccount>
  getTransactions: (address: string, max: number) => Promise<NimiqTransaction[]>
  maxTxs?: number
}): Promise<{ htlcBalanceLuna: number; htlcCount: number }> {
  const user = normalizeAddress(options.address)
  const maxTxs = Math.min(
    Math.max(1, options.maxTxs ?? HTLC_SCAN_TX_MAX),
    100,
  )

  let txs: NimiqTransaction[]
  try {
    txs = await options.getTransactions(user, maxTxs)
  } catch {
    return { htlcBalanceLuna: 0, htlcCount: 0 }
  }

  const candidateTo = new Set<string>()
  for (const tx of txs) {
    if (!tx.executionResult) continue
    try {
      if (normalizeAddress(tx.from) !== user) continue
      const to = normalizeAddress(tx.to)
      if (to !== user) candidateTo.add(to)
    } catch {
      // skip malformed addresses
    }
  }

  if (candidateTo.size === 0) {
    return { htlcBalanceLuna: 0, htlcCount: 0 }
  }

  const addresses = [...candidateTo]
  let htlcBalanceLuna = 0
  let htlcCount = 0
  const seen = new Set<string>()

  for (let i = 0; i < addresses.length; i += HTLC_LOOKUP_CONCURRENCY) {
    const batch = addresses.slice(i, i + HTLC_LOOKUP_CONCURRENCY)
    const accounts = await Promise.all(
      batch.map(async (addr) => {
        try {
          return await options.getAccount(addr)
        } catch {
          return null
        }
      }),
    )
    for (const account of accounts) {
      if (account == null || !isHtlcAccount(account)) continue
      const sender = accountSender(account)
      if (sender == null) continue
      try {
        if (normalizeAddress(sender) !== user) continue
      } catch {
        continue
      }
      const contractKey = normalizeAddress(account.address)
      if (seen.has(contractKey)) continue
      seen.add(contractKey)
      const bal = nonNegInt(account.balance)
      if (bal <= 0) continue
      htlcBalanceLuna += bal
      htlcCount += 1
    }
  }

  return { htlcBalanceLuna, htlcCount }
}

/**
 * Free basic balance + open HTLCs as sender (Pay-aligned wallet total).
 */
export async function readWalletBalanceBreakdown(
  options: ReadWalletBalanceOptions,
): Promise<WalletBalanceBreakdown> {
  const address = normalizeAddress(options.address)
  const getAccount =
    options.getAccount ??
    ((addr: string) => getAccountByAddress(addr, options.rpcUrl))
  const getTransactions =
    options.getTransactions ??
    ((addr: string, max: number) =>
      fetchTransactionsByAddress(addr, max, null, options.rpcUrl))

  let accountBalanceLuna: number | null = null
  try {
    const account = await getAccount(address)
    if (typeof account.balance === 'number' && Number.isFinite(account.balance)) {
      accountBalanceLuna = nonNegInt(account.balance)
    }
  } catch {
    accountBalanceLuna = null
  }

  let htlcBalanceLuna = 0
  let htlcCount = 0
  if (!options.skipHtlcScan) {
    const htlc = await sumOpenHtlcBalanceAsSender({
      address,
      getAccount,
      getTransactions,
      maxTxs: options.maxTxs,
    })
    htlcBalanceLuna = htlc.htlcBalanceLuna
    htlcCount = htlc.htlcCount
  }

  const walletBalanceLuna =
    accountBalanceLuna == null ? null : accountBalanceLuna + htlcBalanceLuna

  return {
    accountBalanceLuna,
    htlcBalanceLuna,
    walletBalanceLuna,
    htlcCount,
  }
}
