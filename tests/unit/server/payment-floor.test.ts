/**
 * Observed payment floor from indexed reward outflows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  computePaymentFloors,
  getObservedPaymentFloor,
  PAYMENT_FLOOR_MIN_SAMPLES,
  resetPaymentFloorCache,
} from '../../../server/src/paymentFloor.js'
import type Database from 'better-sqlite3'

const VALIDATOR = 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV'
const REWARD = 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV'
const OTHER = 'NQ96 X97C 94M1 6MV3 KJ0G JA5U 6VB4 6Y63 EUH4'
const LUNA = 100_000

let db: Database.Database

beforeEach(() => {
  resetPaymentFloorCache()
  db = openDatabase(':memory:')
  db.prepare(
    `INSERT INTO validators (
      address, name, reward_address, payout_type_declared, is_listed, registry_updated_at
    ) VALUES (?, 'Test Pool', ?, 'direct', 1, ?)`,
  ).run(VALIDATOR, REWARD, new Date().toISOString())
})

afterEach(() => {
  resetPaymentFloorCache()
  db.close()
})

function insertTx(
  to: string,
  valueNim: number,
  opts?: { from?: string; ts?: string; hash?: string },
): void {
  const from = opts?.from ?? REWARD
  const ts = opts?.ts ?? '2026-08-01T12:00:00.000Z'
  const hash =
    opts?.hash ??
    `h${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(
      0,
      64,
    )
  db.prepare(
    `INSERT INTO transactions (
      hash, from_address, to_address, value_luna, fee_luna, block_number,
      timestamp, execution_result, raw_json
    ) VALUES (?, ?, ?, ?, 0, 1, ?, 'ok', '{}')`,
  ).run(hash, from, to, Math.round(valueNim * LUNA), ts)
}

describe('paymentFloor', () => {
  it('returns unavailable when no outflows', () => {
    const floor = getObservedPaymentFloor(db, VALIDATOR, { reload: true })
    expect(floor.status).toBe('unavailable')
    expect(floor.sampleSize).toBe(0)
    expect(floor.p5Nim).toBeNull()
  })

  it('computes min and p5; excludes self-transfers', () => {
    // Self-loop should be ignored
    insertTx(REWARD, 0.001, { hash: 'self'.padEnd(64, '0') })
    // Build a series of payments to many recipients with a hard ~10 floor and rare dust
    for (let i = 0; i < PAYMENT_FLOOR_MIN_SAMPLES; i += 1) {
      const to = `NQ${String(i).padStart(2, '0')} TEST RECIPIENT ADDR ${i}`.slice(
        0,
        44,
      )
      // Nimiq addresses need proper format - use OTHER with suffix via unique hash only
      // Use spaced OTHER for first, then random-looking but any string is ok for this unit test
      insertTx(
        i === 0 ? OTHER : `${OTHER.slice(0, -1)}${i % 10}`,
        i < 2 ? 4 : 10 + i * 0.01,
        {
          hash: `hash${i}`.padEnd(64, 'a'),
          ts: `2026-08-0${(i % 9) + 1}T12:00:00.000Z`,
        },
      )
    }
    const floor = getObservedPaymentFloor(db, VALIDATOR, { reload: true })
    expect(floor.sampleSize).toBeGreaterThanOrEqual(PAYMENT_FLOOR_MIN_SAMPLES)
    expect(floor.minNim).not.toBeNull()
    expect(floor.p5Nim).not.toBeNull()
    // Absolute min can be dust; p5 should sit near the 10 NIM regime
    expect(floor.minNim!).toBeLessThan(floor.p5Nim!)
    expect(floor.p5Nim!).toBeGreaterThanOrEqual(4)
    expect(floor.status).toBe('inferred')
  })

  it('marks insufficient when sample is thin', () => {
    insertTx(OTHER, 10, { hash: 'thin'.padEnd(64, 'b') })
    const floor = getObservedPaymentFloor(db, VALIDATOR, { reload: true })
    expect(floor.sampleSize).toBe(1)
    expect(floor.status).toBe('insufficient')
    expect(floor.minNim).toBe(10)
  })

  it('computePaymentFloors returns map keyed by validator', () => {
    insertTx(OTHER, 1.5, { hash: 'map'.padEnd(64, 'c') })
    const map = computePaymentFloors(db)
    expect(map.size).toBe(1)
    const only = [...map.values()][0]!
    expect(only.minNim).toBe(1.5)
  })
})
