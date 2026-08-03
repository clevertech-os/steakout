import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fetchValidators,
  normalizeOfficialScore,
  normalizePayoutType,
  normalizeValidator,
  type ValidatorsFetch,
} from '../../../server/src/validators-api.js'

const fixtureDirectory = resolve(process.cwd(), 'tests/fixtures/registry')

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8')) as unknown
}

describe('validators API normalization', () => {
  it('normalizes both captured registry modes without fabricating fields', () => {
    const known = readJson('p0-05-validators-known-mainnet.json')
    const observable = readJson('p0-05-validators-observable-mainnet.json')
    const timestamp = '2026-08-03T05:24:27.000Z'

    expect(Array.isArray(known)).toBe(true)
    expect(Array.isArray(observable)).toBe(true)

    const normalizedKnown = (known as unknown[]).map((record) =>
      normalizeValidator(record, timestamp),
    )
    const normalizedObservable = (observable as unknown[]).map((record) =>
      normalizeValidator(record, timestamp),
    )

    expect(normalizedKnown).toHaveLength(24)
    expect(normalizedObservable).toHaveLength(78)
    expect(normalizedObservable.filter((validator) => validator.isListed)).toHaveLength(24)
    expect(normalizedObservable.every((validator) => validator.sourceTimestamp === timestamp)).toBe(true)
    expect(normalizedObservable.some((validator) => validator.payoutSchedule === 'Every 12 hours')).toBe(true)
    expect(normalizedObservable.some((validator) => validator.payoutSchedule === null)).toBe(true)
    expect(normalizedObservable.some((validator) => validator.officialScore === null)).toBe(true)
    expect(normalizedObservable.some((validator) => validator.fee === null)).toBe(true)
  })

  it('maps unsupported payout types and sentinel values to null or unknown', () => {
    expect(normalizePayoutType('none')).toBe('unknown')
    expect(normalizePayoutType('DIRECT')).toBe('direct')
    expect(normalizePayoutType(undefined)).toBe('unknown')
    expect(normalizeOfficialScore({ total: -1 })).toBeNull()
    expect(normalizeOfficialScore(undefined)).toBeNull()

    const normalized = normalizeValidator(
      {
        address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
        fee: -1,
        payoutType: 'none',
        payoutSchedule: '  every 9 hours  ',
        score: { total: -1 },
        dominanceRatio: -1,
        balance: -1,
        stakers: -1,
      },
      '2026-08-03T05:24:27.000Z',
    )

    expect(normalized).toMatchObject({
      fee: null,
      payoutType: 'unknown',
      payoutSchedule: '  every 9 hours  ',
      officialScore: null,
      dominanceRatio: null,
      stakeLuna: null,
      stakersCount: null,
      rewardAddress: null,
    })
  })

  it('fetches known-only records and resolves reward addresses through the injected RPC path', async () => {
    const fixture = readJson('p0-05-validators-known-mainnet.json')
    const requests: string[] = []
    const fetcher: ValidatorsFetch = async (input) => {
      requests.push(String(input))
      return {
        ok: true,
        status: 200,
        json: async () => fixture,
      } as Response
    }

    const snapshot = await fetchValidators('known-only', {
      apiUrl: 'https://registry.example.test/api/v1/validators',
      fetcher,
      now: () => '2026-08-03T05:24:27.000Z',
      resolveRewardAddress: async (address) => address,
    })

    expect(requests).toEqual([
      'https://registry.example.test/api/v1/validators?only-known=true',
    ])
    expect(snapshot.validators).toHaveLength(24)
    expect(snapshot.rewardAddressResolution).toEqual({ attempted: 24, resolved: 24, unavailable: 0 })
    expect(snapshot.validators[0]?.rewardAddress).toBe(snapshot.validators[0]?.address)
  })
})
