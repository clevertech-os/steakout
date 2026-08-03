/**
 * P1-12 — staking intent/confirm client (mocked fetch).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../client/src/api/http.ts'
import {
  confirmStakingIntent,
  createStakingIntent,
  normalizeIntentSummary,
  pollConfirmStakingIntent,
} from '../../../client/src/api/staking.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('normalizeIntentSummary', () => {
  it('maps server fromState/toStateHint to client stateFrom/stateTo', () => {
    const summary = normalizeIntentSummary({
      operation: 'update-staker',
      operationLabel: 'Change validator',
      amountLuna: null,
      validatorName: 'Next',
      validatorAddress: 'NQ02',
      fromState: 'Active',
      toStateHint: 'Active',
      waitingPeriodNote: 'Reporting window note',
      networkNote: 'This action will be submitted on mainnet.',
    } as Parameters<typeof normalizeIntentSummary>[0])

    expect(summary.stateFrom).toBe('Active')
    expect(summary.stateTo).toBe('Active')
    expect(summary.hasWaitingPeriod).toBe(false)
    expect(summary.waitingPeriodNote).toMatch(/Reporting window/)
    expect(summary.notes).toEqual(['This action will be submitted on mainnet.'])
  })
})

describe('createStakingIntent', () => {
  it('POSTs credentials and returns intent + summary', async () => {
    const body = {
      intentId: 'intent-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      summary: {
        operation: 'new-staker',
        operationLabel: 'Create staker and delegate',
        amountLuna: 100_000,
        validatorName: 'Test',
        validatorAddress: 'NQ01 TEST',
        stateFrom: 'NotStaked',
        stateTo: 'Active',
        hasWaitingPeriod: false,
        waitingPeriodNote: null,
      },
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/staking/intent')
      expect(init?.method).toBe('POST')
      expect(init?.credentials).toBe('include')
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch

    const res = await createStakingIntent({
      operation: 'new-staker',
      params: { valueLuna: 100_000, delegation: 'NQ01 TEST' },
    })
    expect(res.intentId).toBe('intent-1')
    expect(res.summary.amountLuna).toBe(100_000)
  })

  it('normalizes server update-staker summary field names', async () => {
    const body = {
      intentId: 'intent-upd',
      expiresAt: '2099-01-01T00:00:00.000Z',
      summary: {
        operation: 'update-staker',
        operationLabel: 'Change validator',
        amountNim: null,
        amountLuna: null,
        validatorName: 'Next Pool',
        validatorAddress: 'NQ02 NEW',
        fromState: 'Active',
        toStateHint: 'Active',
        waitingPeriodNote: 'Changing validator is not the multi-step retire/remove wait.',
        networkNote: 'This action will be submitted on mainnet.',
      },
    }
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch

    const res = await createStakingIntent({
      operation: 'update-staker',
      params: { newDelegation: 'NQ02 NEW', reactivateAllStake: true },
    })
    expect(res.summary.operation).toBe('update-staker')
    expect(res.summary.stateFrom).toBe('Active')
    expect(res.summary.stateTo).toBe('Active')
    expect(res.summary.hasWaitingPeriod).toBe(false)
    expect(res.summary.waitingPeriodNote).toMatch(/not the multi-step/i)
  })
})

describe('confirmStakingIntent', () => {
  it('maps 202 to pending', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { code: 'TX_PENDING', message: 'Still pending' } }),
        { status: 202 },
      )
    }) as typeof fetch

    const res = await confirmStakingIntent({ intentId: 'i', txHash: 'a'.repeat(64) })
    expect(res.status).toBe('pending')
    if (res.status === 'pending') {
      expect(res.message).toMatch(/pending/i)
    }
  })

  it('maps 200 to confirmed', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: 'confirmed',
          blockNumber: 42,
          position: {
            state: 'Active',
            accountBalanceLuna: 0,
            staker: {
              activeLuna: 100_000,
              inactiveLuna: 0,
              retiredLuna: 0,
              totalLuna: 100_000,
              delegation: 'NQ01',
              validatorName: null,
            },
            retire: { withdrawableAt: null },
            lastRewardObservation: null,
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const res = await confirmStakingIntent({ intentId: 'i', txHash: 'b'.repeat(64) })
    expect(res.status).toBe('confirmed')
    if (res.status === 'confirmed') {
      expect(res.blockNumber).toBe(42)
      expect(res.position.state).toBe('Active')
    }
  })

  it('throws ApiError on TX_MISMATCH', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { code: 'TX_MISMATCH', message: 'Does not match intent' },
        }),
        { status: 422 },
      )
    }) as typeof fetch

    await expect(
      confirmStakingIntent({ intentId: 'i', txHash: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'TX_MISMATCH', httpStatus: 422 })
  })
})

describe('pollConfirmStakingIntent', () => {
  it('returns after pending then confirmed', async () => {
    let n = 0
    globalThis.fetch = vi.fn(async () => {
      n += 1
      if (n === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'TX_PENDING', message: 'wait' } }),
          { status: 202 },
        )
      }
      return new Response(
        JSON.stringify({
          status: 'confirmed',
          blockNumber: 1,
          position: {
            state: 'Active',
            accountBalanceLuna: null,
            staker: {
              activeLuna: 1,
              inactiveLuna: 0,
              retiredLuna: 0,
              totalLuna: 1,
              delegation: null,
              validatorName: null,
            },
            retire: { withdrawableAt: null },
            lastRewardObservation: null,
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const res = await pollConfirmStakingIntent({
      intentId: 'i',
      txHash: 'd'.repeat(64),
      maxMs: 5_000,
    })
    expect(res.status).toBe('confirmed')
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('times out with CONFIRM_TIMEOUT', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { code: 'TX_PENDING', message: 'wait' } }),
        { status: 202 },
      )
    }) as typeof fetch

    try {
      await pollConfirmStakingIntent({
        intentId: 'i',
        txHash: 'e'.repeat(64),
        maxMs: 50,
      })
      expect.fail('expected timeout')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('CONFIRM_TIMEOUT')
    }
  })
})
