import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const fixtureDirectory = resolve(process.cwd(), 'tests/fixtures/rpc')
const network = 'mainnet'
const fixtureNames = [
  'p0-04-get-block-number',
  'p0-04-validator-by-address',
  'p0-04-active-validators',
  'p0-04-account-by-address',
  'p0-04-staker-by-address',
  'p0-04-transactions-by-address-page-1',
  'p0-04-transactions-by-address-page-2',
  'p0-04-transaction-by-hash',
]

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertNoSensitiveKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveKeys)
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    expect(key).not.toMatch(/seed|mnemonic|private.?key|passphrase|secret/i)
    assertNoSensitiveKeys(item)
  }
}

function resultData(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.result)) return undefined
  return value.result.data
}

describe('P0-04 RPC fixtures', () => {
  it('has metadata for every required read capture', () => {
    const metadata = readJson(resolve(fixtureDirectory, '_meta.json'))
    expect(isRecord(metadata)).toBe(true)
    expect(metadata).toMatchObject({ network, capture: 'P0-04 RPC read-layer probe' })

    const captures = metadata.captures
    expect(Array.isArray(captures)).toBe(true)
    expect(captures).toHaveLength(fixtureNames.length)
    expect(captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'getBlockNumber' }),
        expect.objectContaining({ method: 'getValidatorByAddress' }),
        expect.objectContaining({ method: 'getActiveValidators' }),
        expect.objectContaining({ method: 'getAccountByAddress' }),
        expect.objectContaining({ method: 'getStakerByAddress' }),
        expect.objectContaining({ method: 'getTransactionsByAddress' }),
        expect.objectContaining({ method: 'getTransactionByHash' }),
      ]),
    )
  })

  it('loads valid JSON-RPC envelopes without sensitive fields', () => {
    for (const name of fixtureNames) {
      const fixture = readJson(resolve(fixtureDirectory, `${name}-${network}.json`))
      expect(fixture).toMatchObject({ jsonrpc: '2.0', id: 1 })
      expect(isRecord(fixture) && ('result' in fixture || 'error' in fixture)).toBe(true)
      expect(isRecord(fixture) && !('result' in fixture && 'error' in fixture)).toBe(true)
      assertNoSensitiveKeys(fixture)
    }
  })

  it('contains the captured read shapes and an exclusive transaction cursor', () => {
    const block = readJson(resolve(fixtureDirectory, `p0-04-get-block-number-${network}.json`))
    const validator = readJson(resolve(fixtureDirectory, `p0-04-validator-by-address-${network}.json`))
    const activeValidators = readJson(resolve(fixtureDirectory, `p0-04-active-validators-${network}.json`))
    const account = readJson(resolve(fixtureDirectory, `p0-04-account-by-address-${network}.json`))
    const staker = readJson(resolve(fixtureDirectory, `p0-04-staker-by-address-${network}.json`))
    const pageOne = readJson(resolve(fixtureDirectory, `p0-04-transactions-by-address-page-1-${network}.json`))
    const pageTwo = readJson(resolve(fixtureDirectory, `p0-04-transactions-by-address-page-2-${network}.json`))
    const transaction = readJson(resolve(fixtureDirectory, `p0-04-transaction-by-hash-${network}.json`))

    expect(typeof resultData(block)).toBe('number')
    expect(validator).toMatchObject({
      result: {
        data: expect.objectContaining({
          address: expect.any(String),
          rewardAddress: expect.any(String),
          balance: expect.any(Number),
          numStakers: expect.any(Number),
        }),
      },
    })
    expect(Array.isArray(resultData(activeValidators))).toBe(true)
    expect(account).toMatchObject({
      result: { data: expect.objectContaining({ address: expect.any(String), balance: expect.any(Number), type: expect.any(String) }) },
    })
    expect(staker).toMatchObject({ error: { code: -32603, message: 'Internal error' } })

    const firstPageData = resultData(pageOne)
    const secondPageData = resultData(pageTwo)
    expect(Array.isArray(firstPageData)).toBe(true)
    expect(Array.isArray(secondPageData)).toBe(true)
    expect((firstPageData as Array<{ hash: string }>)[0].hash).not.toBe(
      (secondPageData as Array<{ hash: string }>)[0].hash,
    )
    expect(transaction).toMatchObject({
      result: { data: expect.objectContaining({ hash: expect.any(String), executionResult: expect.any(Boolean) }) },
    })
  })
})
