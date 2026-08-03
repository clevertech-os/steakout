/**
 * Pay-aligned wallet balance: free basic + open HTLCs as sender.
 */

import { describe, expect, it } from 'vitest'
import {
  readWalletBalanceBreakdown,
  sumOpenHtlcBalanceAsSender,
} from '../../../server/src/walletBalance.ts'
import type { NimiqAccount, NimiqTransaction } from '../../../server/src/nimiq-rpc.ts'

const USER = 'NQ21 C3EU F69A E1GV UFVC XSSJ HLXB SJU5 DRAF'
const HTLC = 'NQ26 J7L5 8FX6 T8RT T58G 5DE1 U0MF VGLR P0T1'
const OTHER = 'NQ54 FTGY F6VJ EJPU NSMN RA5Q 0K21 8EQT Q05P'

function tx(partial: Partial<NimiqTransaction> & Pick<NimiqTransaction, 'from' | 'to' | 'value'>): NimiqTransaction {
  return {
    hash: partial.hash ?? 'aa'.repeat(32),
    fee: partial.fee ?? 0,
    executionResult: partial.executionResult ?? true,
    ...partial,
  }
}

describe('sumOpenHtlcBalanceAsSender', () => {
  it('sums open HTLC balances where user is sender', async () => {
    const result = await sumOpenHtlcBalanceAsSender({
      address: USER,
      getTransactions: async () => [
        tx({ from: USER, to: HTLC, value: 33_000_000_000 }),
      ],
      getAccount: async (addr) => {
        if (addr.replace(/\s+/g, '') === HTLC.replace(/\s+/g, '')) {
          return {
            address: HTLC,
            balance: 33_000_000_000,
            type: 'htlc',
            sender: USER,
            recipient: OTHER,
          } as NimiqAccount
        }
        throw new Error('unexpected')
      },
    })
    expect(result.htlcBalanceLuna).toBe(33_000_000_000)
    expect(result.htlcCount).toBe(1)
  })

  it('ignores contracts that are not HTLC or wrong sender', async () => {
    const result = await sumOpenHtlcBalanceAsSender({
      address: USER,
      getTransactions: async () => [
        tx({ from: USER, to: HTLC, value: 1 }),
        tx({ from: USER, to: OTHER, value: 1 }),
      ],
      getAccount: async (addr) => {
        if (addr.includes('NQ26')) {
          return {
            address: HTLC,
            balance: 1_000,
            type: 'basic',
            sender: USER,
          } as NimiqAccount
        }
        return {
          address: OTHER,
          balance: 9_000,
          type: 'htlc',
          sender: OTHER, // not user
        } as NimiqAccount
      },
    })
    expect(result.htlcBalanceLuna).toBe(0)
    expect(result.htlcCount).toBe(0)
  })
})

describe('readWalletBalanceBreakdown', () => {
  it('wallet total = free + HTLC (matches Pay-style total)', async () => {
    const breakdown = await readWalletBalanceBreakdown({
      address: USER,
      getAccount: async (addr) => {
        if (addr.replace(/\s+/g, '') === USER.replace(/\s+/g, '')) {
          return { address: USER, balance: 0, type: 'basic' }
        }
        return {
          address: HTLC,
          balance: 33_000_000_000,
          type: 'htlc',
          sender: USER,
          recipient: OTHER,
        } as NimiqAccount
      },
      getTransactions: async () => [tx({ from: USER, to: HTLC, value: 33_000_000_000 })],
    })
    expect(breakdown).toEqual({
      accountBalanceLuna: 0,
      htlcBalanceLuna: 33_000_000_000,
      walletBalanceLuna: 33_000_000_000,
      htlcCount: 1,
    })
  })

  it('skipHtlcScan leaves only free balance', async () => {
    const breakdown = await readWalletBalanceBreakdown({
      address: USER,
      skipHtlcScan: true,
      getAccount: async () => ({ address: USER, balance: 5_000, type: 'basic' }),
    })
    expect(breakdown.walletBalanceLuna).toBe(5_000)
    expect(breakdown.htlcBalanceLuna).toBe(0)
  })
})
