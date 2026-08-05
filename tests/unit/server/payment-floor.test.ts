/**
 * Observed payment floor: compute, weekly persist, request-path DB reads.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'
import {
  computePaymentFloors,
  getObservedPaymentFloor,
  getPaymentFloorLastComputedAt,
  isPaymentFloorRefreshDue,
  loadPaymentFloors,
  loadPaymentFloorsFromDb,
  PAYMENT_FLOOR_MIN_SAMPLES,
  PAYMENT_FLOOR_REFRESH_MS,
  persistPaymentFloors,
  refreshPaymentFloors,
  resetPaymentFloorCache,
  startPaymentFloorScheduler,
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
  it('returns unavailable when no outflows (after refresh)', () => {
    const floor = getObservedPaymentFloor(db, VALIDATOR, { reload: true })
    expect(floor.status).toBe('unavailable')
    expect(floor.sampleSize).toBe(0)
    expect(floor.p5Nim).toBeNull()
  })

  it('computes min and p5; excludes self-transfers', () => {
    insertTx(REWARD, 0.001, { hash: 'self'.padEnd(64, '0') })
    for (let i = 0; i < PAYMENT_FLOOR_MIN_SAMPLES; i += 1) {
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

  it('refresh persists and loadPaymentFloors reads SQLite without rescanning when not reload', () => {
    insertTx(OTHER, 12, { hash: 'persist'.padEnd(64, 'd') })
    const result = refreshPaymentFloors(db, { logger: () => {} })
    expect(result.count).toBe(1)
    expect(getPaymentFloorLastComputedAt(db)).toBe(result.computedAt)

    // Wipe txs so a recompute would see zero outflows.
    db.prepare(`DELETE FROM transactions`).run()
    resetPaymentFloorCache()

    const fromDb = loadPaymentFloorsFromDb(db)
    expect(fromDb.size).toBe(1)
    const floor = getObservedPaymentFloor(db, VALIDATOR)
    // Still the precomputed values — request path does not recompute.
    expect(floor.minNim).toBe(12)
    expect(floor.sampleSize).toBe(1)
    expect(floor.status).toBe('insufficient')
  })

  it('isPaymentFloorRefreshDue when empty or older than weekly window', () => {
    expect(isPaymentFloorRefreshDue(db, Date.now())).toBe(true)

    const nowMs = Date.parse('2026-08-01T00:00:00.000Z')
    refreshPaymentFloors(db, { nowMs, logger: () => {} })
    expect(isPaymentFloorRefreshDue(db, nowMs + 1000)).toBe(false)
    expect(
      isPaymentFloorRefreshDue(db, nowMs + PAYMENT_FLOOR_REFRESH_MS - 1),
    ).toBe(false)
    expect(
      isPaymentFloorRefreshDue(db, nowMs + PAYMENT_FLOOR_REFRESH_MS),
    ).toBe(true)
  })

  it('persistPaymentFloors replaces rows for dropped validators', () => {
    const computedAt = '2026-08-01T00:00:00.000Z'
    persistPaymentFloors(
      db,
      new Map([
        [
          'AAAA',
          {
            minNim: 1,
            p5Nim: 2,
            sampleSize: 10,
            recipientCount: 3,
            historyDepthDays: 7,
            status: 'inferred',
            computedAt,
          },
        ],
        [
          'BBBB',
          {
            minNim: null,
            p5Nim: null,
            sampleSize: 0,
            recipientCount: 0,
            historyDepthDays: null,
            status: 'unavailable',
            computedAt,
          },
        ],
      ]),
    )
    expect(loadPaymentFloorsFromDb(db).size).toBe(2)

    persistPaymentFloors(
      db,
      new Map([
        [
          'AAAA',
          {
            minNim: 3,
            p5Nim: 4,
            sampleSize: 20,
            recipientCount: 5,
            historyDepthDays: 14,
            status: 'inferred',
            computedAt: '2026-08-08T00:00:00.000Z',
          },
        ],
      ]),
    )
    const map = loadPaymentFloorsFromDb(db)
    expect(map.size).toBe(1)
    expect(map.get('AAAA')?.minNim).toBe(3)
  })

  it('scheduler runNow refreshes when due', () => {
    insertTx(OTHER, 5, { hash: 'sched'.padEnd(64, 'e') })
    const logs: string[] = []
    const { stop, runNow } = startPaymentFloorScheduler(db, {
      runIfDueOnStart: false,
      logger: (line) => logs.push(line),
      checkIntervalMs: 60_000,
    })
    try {
      expect(isPaymentFloorRefreshDue(db)).toBe(true)
      const result = runNow()
      expect(result?.count).toBe(1)
      expect(logs.some((l) => l.includes('"paymentFloors":"refresh"'))).toBe(true)
      expect(loadPaymentFloors(db).size).toBe(1)
    } finally {
      stop()
    }
  })
})
