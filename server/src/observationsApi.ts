/**
 * P2-06 — Public observations / evidence endpoints + network summary.
 *
 * - GET /api/validators/:address/observations
 * - GET /api/network/summary
 * - GET /api/explorer/transaction/:hash
 *
 * Response shapes follow docs/API.md §3. Recipient-coverage fields are included
 * when present on observations (P2-04); otherwise null so the client can plug in
 * cleanly when coverage lands.
 */

import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { isValidNimiqAddress, normalizeAddress } from './addresses.js'
import {
  buildNimiqExplorerUrl,
  isPlausibleTxHash,
  resolveExplorerNetwork,
} from './explorer.js'
import {
  applyIndexerStaleStatus,
  buildDataFreshness,
  computeHistoryDepthDays,
  getIndexerWatermarkIso,
  historyDepthDaysFromEarliest,
  type EnvelopeSource,
  type EnvelopeStatus,
} from './freshness.js'
import {
  RECIPIENT_COVERAGE_LIMITATIONS,
  RECIPIENT_COVERAGE_OBSERVATION_TYPE,
  listScheduleAdherenceObservation,
  type ObservationStatus,
  type RecipientCoveragePayload,
} from './observationScoring.js'
import {
  listPayoutRunObservations,
  type PayoutRunPayload,
} from './payoutClassifier.js'
import {
  buildPublicCacheStableKey,
  lookupPublicResponse,
  markEnvelopeStaleForServe,
  PUBLIC_CACHE_CONTROL,
  schedulePublicRevalidate,
  setCachedPublicResponse,
} from './responseCache.js'
import { buildCanaryCoverageSummary, type CanaryCoverageSummary } from './probeRoster.js'
import { getValidatorRowByAddress, listValidatorRows, type ValidatorRow } from './validatorSync.js'

/** Default page size for paginated payout runs. */
export const DEFAULT_RUNS_PAGE_SIZE = 25
export const MAX_RUNS_PAGE_SIZE = 100

/**
 * Always-present methodology caveats (API.md §3 `limitations` array).
 * Keys are stable machine tokens for the client/Learn page — not user copy.
 * Includes P2-04 recipient-coverage caveats so the array is complete even
 * before coverage rows exist for a validator.
 */
export const BASE_OBSERVATION_LIMITATIONS = [
  ...RECIPIENT_COVERAGE_LIMITATIONS,
  'analysis-covers-indexed-history-only',
  'missing-payment-does-not-prove-wrongdoing',
] as const

export interface ObservationRunItem {
  windowStart: string
  windowEnd: string
  txCount: number
  recipientCount: number
  /** Nullable until P2-04 recipient-coverage observations exist. */
  knownStakersCovered: number | null
  knownStakersTotal: number | null
  txHashes: string[]
  blockRange: [number, number]
}

export interface ObservationsPayload {
  observationStatus: ObservationStatus
  schedule: {
    declared: string | null
    normalized: { everyHours: number } | null
    normalizable: boolean
  }
  window: {
    from: string | null
    to: string | null
    expectedWindows: number
    observedWindows: number
  }
  runs: ObservationRunItem[]
  nextCursor: string | null
  limitations: string[]
}

export interface ObservationsEnvelope {
  updatedAt: string
  source: 'indexer' | 'registry'
  status: 'ok' | 'stale' | 'partial' | 'unavailable'
  dataFreshness: { ageSeconds: number; historyDepthDays: number }
  data: ObservationsPayload
}

export interface NetworkSummaryPayload {
  totalStakeLuna: number
  validators: {
    listed: number
    observable: number
  }
  dominanceBuckets: Array<{
    label: string
    minExclusive: number
    maxInclusive: number
    count: number
    stakeLuna: number
  }>
  /** Fraction of total stake on validators with a normalizable schedule (0–1). */
  stakeWithNormalizableScheduleRatio: number | null
  indexer: {
    addressesWithCursor: number
    newestCursorUpdatedAt: string | null
    oldestCursorUpdatedAt: string | null
  }
  /** Public roster coverage, classified only from indexed probe evidence. */
  canary: CanaryCoverageSummary
}

interface CursorPayload {
  offset: number
}

interface RecipientCoverageFields {
  knownStakersCovered: number | null
  knownStakersTotal: number | null
}

function sendApiError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    error: { code, message },
  })
}

function encodeCursor(offset: number): string {
  const payload: CursorPayload = { offset }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 0
  if (typeof raw !== 'string') return null
  // Accept plain integer offsets for simple clients/tests.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    return Number.isSafeInteger(n) && n >= 0 ? n : null
  }
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as CursorPayload
    if (
      typeof parsed?.offset !== 'number'
      || !Number.isSafeInteger(parsed.offset)
      || parsed.offset < 0
    ) {
      return null
    }
    return parsed.offset
  } catch {
    return null
  }
}

function parseLimit(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_RUNS_PAGE_SIZE
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null
  return Math.min(n, MAX_RUNS_PAGE_SIZE)
}

/**
 * Optional recipient-coverage overlay keyed by payout-run identity
 * (`source_tx_hash` = first tx hash of the run). When P2-04 is not present,
 * returns an empty map — callers default knownStakers* to null.
 */
export function loadRecipientCoverageByRunKey(
  database: Database.Database,
  validatorAddress: string,
): Map<string, RecipientCoverageFields> {
  const map = new Map<string, RecipientCoverageFields>()
  // May be empty until P2-04 classify has run for this validator.
  const rows = database.prepare(`
    SELECT source_tx_hash, payload_json
    FROM validator_observations
    WHERE validator_address = ?
      AND observation_type = ?
      AND calc_version = (
        SELECT MAX(calc_version)
        FROM validator_observations
        WHERE validator_address = ?
          AND observation_type = ?
      )
  `).all(
    validatorAddress,
    RECIPIENT_COVERAGE_OBSERVATION_TYPE,
    validatorAddress,
    RECIPIENT_COVERAGE_OBSERVATION_TYPE,
  ) as Array<{
    source_tx_hash: string | null
    payload_json: string
  }>

  for (const row of rows) {
    if (!row.source_tx_hash) continue
    try {
      const payload = JSON.parse(row.payload_json) as RecipientCoveragePayload
      const covered = payload.knownStakersCovered
      const total = payload.knownStakersTotal
      map.set(row.source_tx_hash, {
        knownStakersCovered:
          typeof covered === 'number' && Number.isFinite(covered) ? covered : null,
        knownStakersTotal:
          typeof total === 'number' && Number.isFinite(total) ? total : null,
      })
    } catch {
      // Ignore malformed payload; leave nulls for that run.
    }
  }
  return map
}

function runToItem(
  payload: PayoutRunPayload,
  coverage: RecipientCoverageFields | undefined,
): ObservationRunItem {
  return {
    windowStart: payload.windowStart,
    windowEnd: payload.windowEnd,
    txCount: payload.txCount,
    recipientCount: payload.recipientCount,
    knownStakersCovered: coverage?.knownStakersCovered ?? null,
    knownStakersTotal: coverage?.knownStakersTotal ?? null,
    txHashes: payload.txHashes,
    blockRange: payload.blockRange,
  }
}

function buildLimitations(input: {
  normalizable: boolean
  historyDepthDays: number
  runCount: number
}): string[] {
  const limitations: string[] = [...BASE_OBSERVATION_LIMITATIONS]
  if (!input.normalizable) {
    limitations.push('schedule-cannot-be-normalized')
  }
  if (input.historyDepthDays < 7 || input.runCount === 0) {
    limitations.push('insufficient-history')
  }
  return limitations
}

/**
 * Build the observations evidence payload for a known validator row.
 * Empty history still returns a full payload (HTTP 200) with insufficient-data
 * / unavailable status — never 404 for a known validator.
 */
export function buildObservationsForValidator(
  database: Database.Database,
  row: ValidatorRow,
  options: {
    cursorOffset?: number
    limit?: number
    nowMs?: number
  } = {},
): ObservationsEnvelope {
  const nowMs = options.nowMs ?? Date.now()
  const offset = options.cursorOffset ?? 0
  const limit = options.limit ?? DEFAULT_RUNS_PAGE_SIZE

  const everyHours = row.schedule_every_hours
  const normalizable = everyHours !== null && Number.isFinite(everyHours) && everyHours > 0
  const declared = row.payout_schedule_declared

  const adherence = listScheduleAdherenceObservation(database, row.address)
  const allRuns = listPayoutRunObservations(database, row.address)
  // Newest first for evidence browsing.
  const sorted = [...allRuns].sort(
    (a, b) => Date.parse(b.payload.windowStart) - Date.parse(a.payload.windowStart)
      || b.id - a.id,
  )

  const coverageByKey = loadRecipientCoverageByRunKey(database, row.address)
  const page = sorted.slice(offset, offset + limit)
  const nextOffset = offset + limit
  const nextCursor = nextOffset < sorted.length ? encodeCursor(nextOffset) : null

  const runs = page.map((run) => {
    const key = run.sourceTxHash ?? run.payload.firstTxHash
    return runToItem(run.payload, coverageByKey.get(key))
  })

  let observationStatus: ObservationStatus
  let window: ObservationsPayload['window']
  let updatedAt: string
  let source: EnvelopeSource = 'indexer'
  let baseStatus: EnvelopeStatus = 'ok'

  // Earliest indexed run/tx → now (P2-07). Prefer live depth; fall back to
  // adherence window anchor or scored payload when runs have not been stored.
  let historyDepthDays = computeHistoryDepthDays(database, {
    validatorAddress: row.address,
    rewardAddress: row.reward_address,
    nowMs,
  })

  if (adherence) {
    observationStatus = adherence.status
    const w = adherence.payload.window
    window = {
      from: w.from,
      to: w.to,
      expectedWindows: w.expectedWindows,
      observedWindows: w.observedWindows,
    }
    updatedAt = adherence.observedAt
    source = 'indexer'
    baseStatus = 'ok'
    if (historyDepthDays === 0 && w.from) {
      historyDepthDays = historyDepthDaysFromEarliest(w.from, nowMs)
    }
    if (historyDepthDays === 0) {
      historyDepthDays = adherence.payload.historyDepthDays
    }
  } else if (sorted.length > 0) {
    // Runs exist but adherence not yet computed — partial evidence.
    observationStatus = 'insufficient-data'
    const first = sorted[sorted.length - 1]!
    const last = sorted[0]!
    window = {
      from: first.payload.windowStart,
      to: last.payload.windowEnd,
      expectedWindows: 0,
      observedWindows: sorted.length,
    }
    updatedAt = last.observedAt
    source = 'indexer'
    baseStatus = 'partial'
  } else {
    // Empty history: still 200. Unavailable when schedule not normalizable
    // (METHODOLOGY §3); otherwise insufficient-data.
    observationStatus = normalizable ? 'insufficient-data' : 'unavailable'
    window = {
      from: null,
      to: null,
      expectedWindows: 0,
      observedWindows: 0,
    }
    updatedAt = row.registry_updated_at ?? new Date(0).toISOString()
    source = row.registry_updated_at ? 'registry' : 'indexer'
    baseStatus = 'ok'
  }

  const payload: ObservationsPayload = {
    observationStatus,
    schedule: {
      declared,
      normalized: normalizable && everyHours != null ? { everyHours } : null,
      normalizable,
    },
    window,
    runs,
    nextCursor,
    limitations: buildLimitations({
      normalizable,
      historyDepthDays,
      runCount: sorted.length,
    }),
  }

  // Indexer-backed responses: mark stale when global watermark is older than 2× cadence.
  const watermarkIso =
    source === 'indexer' || source === 'registry'
      ? getIndexerWatermarkIso(database)
      : null
  const status = source === 'indexer'
    ? applyIndexerStaleStatus(baseStatus, { nowMs, watermarkIso })
    : baseStatus

  // Age against indexer watermark when present and source is indexer; else updatedAt.
  const ageFromIso =
    source === 'indexer' && watermarkIso ? watermarkIso : updatedAt

  const freshness = buildDataFreshness({
    updatedAt,
    nowMs,
    historyDepthDays,
    ageFromIso,
  })

  return {
    updatedAt,
    source: source as ObservationsEnvelope['source'],
    status,
    // Envelope requires historyDepthDays; always set from computeHistoryDepthDays (P2-07).
    dataFreshness: {
      ageSeconds: freshness.ageSeconds,
      historyDepthDays,
    },
    data: payload,
  }
}

const DOMINANCE_BUCKETS: Array<{
  label: string
  minExclusive: number
  maxInclusive: number
}> = [
  { label: '0-1%', minExclusive: -1, maxInclusive: 0.01 },
  { label: '1-5%', minExclusive: 0.01, maxInclusive: 0.05 },
  { label: '5-10%', minExclusive: 0.05, maxInclusive: 0.1 },
  { label: '10%+', minExclusive: 0.1, maxInclusive: Number.POSITIVE_INFINITY },
]

/**
 * Aggregate network view for the decentralization summary.
 * Listed vs observable counts are separate (API.md §3).
 */
export function buildNetworkSummary(
  database: Database.Database,
  options: { nowMs?: number } = {},
): {
  envelope: {
    updatedAt: string
    source: 'registry' | 'indexer'
    status: EnvelopeStatus
    dataFreshness: { ageSeconds: number; historyDepthDays?: number }
    data: NetworkSummaryPayload
  }
} {
  const nowMs = options.nowMs ?? Date.now()
  const rows = listValidatorRows(database)

  let totalStakeLuna = 0
  let listed = 0
  let normalizableStake = 0
  let stakeKnown = 0

  const bucketAcc = DOMINANCE_BUCKETS.map((b) => ({
    ...b,
    count: 0,
    stakeLuna: 0,
  }))

  let maxRegistryAt: string | null = null
  let maxRegistryMs = -1

  for (const row of rows) {
    if (row.is_listed === 1) listed += 1
    const stake = row.stake_luna
    if (typeof stake === 'number' && Number.isFinite(stake) && stake > 0) {
      totalStakeLuna += stake
      stakeKnown += stake
      if (row.schedule_every_hours != null && Number.isFinite(row.schedule_every_hours)) {
        normalizableStake += stake
      }
    }
    const dom = row.dominance_ratio
    if (typeof dom === 'number' && Number.isFinite(dom)) {
      for (const bucket of bucketAcc) {
        if (dom > bucket.minExclusive && dom <= bucket.maxInclusive) {
          bucket.count += 1
          if (typeof stake === 'number' && Number.isFinite(stake) && stake > 0) {
            bucket.stakeLuna += stake
          }
          break
        }
      }
    }
    if (row.registry_updated_at) {
      const ms = Date.parse(row.registry_updated_at)
      if (!Number.isNaN(ms) && ms >= maxRegistryMs) {
        maxRegistryMs = ms
        maxRegistryAt = row.registry_updated_at
      }
    }
  }

  const cursorStats = database.prepare(`
    SELECT
      COUNT(*) AS count,
      MAX(updated_at) AS newest,
      MIN(updated_at) AS oldest
    FROM index_cursors
  `).get() as {
    count: number
    newest: string | null
    oldest: string | null
  }

  const data: NetworkSummaryPayload = {
    totalStakeLuna,
    validators: {
      listed,
      observable: rows.length,
    },
    dominanceBuckets: bucketAcc.map((b) => ({
      label: b.label,
      minExclusive: b.minExclusive < 0 ? 0 : b.minExclusive,
      maxInclusive: Number.isFinite(b.maxInclusive) ? b.maxInclusive : 1,
      count: b.count,
      stakeLuna: b.stakeLuna,
    })),
    stakeWithNormalizableScheduleRatio:
      stakeKnown > 0 ? normalizableStake / stakeKnown : null,
    indexer: {
      addressesWithCursor: cursorStats.count,
      newestCursorUpdatedAt: cursorStats.newest,
      oldestCursorUpdatedAt: cursorStats.oldest,
    },
    canary: buildCanaryCoverageSummary(database),
  }

  const watermarkIso = cursorStats.newest
  const updatedAt = maxRegistryAt ?? watermarkIso ?? new Date(0).toISOString()
  const source: 'registry' | 'indexer' = maxRegistryAt ? 'registry' : 'indexer'
  const baseStatus: EnvelopeStatus = rows.length === 0 ? 'unavailable' : 'ok'
  // Network summary includes indexer coverage; mark stale when watermark is old.
  const status = applyIndexerStaleStatus(baseStatus, {
    nowMs,
    watermarkIso,
  })
  // Network-level history depth: span of oldest→now cursor when present.
  const historyDepthDays =
    cursorStats.oldest != null
      ? Math.max(0, (nowMs - Date.parse(cursorStats.oldest)) / 86_400_000)
      : undefined

  return {
    envelope: {
      updatedAt,
      source,
      status,
      dataFreshness: buildDataFreshness({
        updatedAt,
        nowMs,
        historyDepthDays,
        // Prefer watermark age when indexer data is present so stale + ageSeconds align.
        ageFromIso: watermarkIso ?? updatedAt,
      }),
      data,
    },
  }
}

export function mountObservationsApi(app: Express, database: Database.Database): void {
  app.get('/api/validators/:address/observations', (req: Request, res: Response) => {
    const param = req.params.address
    const raw = (Array.isArray(param) ? param[0] : param) ?? ''
    const address = decodeURIComponent(raw)
    if (!isValidNimiqAddress(address)) {
      sendApiError(res, 400, 'VALIDATION', 'A valid Nimiq validator address is required.')
      return
    }

    const row = getValidatorRowByAddress(database, address)
    if (!row) {
      sendApiError(res, 404, 'VALIDATOR_NOT_FOUND', 'No registry record for this validator address.')
      return
    }

    const offset = decodeCursor(req.query.cursor)
    if (offset === null) {
      sendApiError(res, 400, 'VALIDATION', 'cursor must be a valid pagination cursor.')
      return
    }
    const limit = parseLimit(req.query.limit)
    if (limit === null) {
      sendApiError(res, 400, 'VALIDATION', 'limit must be a positive integer.')
      return
    }

    // Stable key + SWR: last-good survives watermark advances / TTL expiry.
    const normalized = normalizeAddress(address)
    const watermarkIso = getIndexerWatermarkIso(database)
    const cacheKey = buildPublicCacheStableKey(
      `/api/validators/${normalized}/observations`,
      {
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : '',
        limit: String(limit),
      },
    )
    const lookup = lookupPublicResponse(cacheKey)
    if (lookup.kind === 'fresh') {
      res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
      res.setHeader('X-Cache', 'HIT')
      res.status(lookup.status).json(lookup.body)
      return
    }
    if (lookup.kind === 'stale') {
      res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
      res.setHeader('X-Cache', 'STALE')
      res.status(lookup.status).json(markEnvelopeStaleForServe(lookup.body))
      schedulePublicRevalidate(
        cacheKey,
        () =>
          buildObservationsForValidator(database, row, {
            cursorOffset: offset,
            limit,
          }),
        { watermark: watermarkIso },
      )
      return
    }

    const envelope = buildObservationsForValidator(database, row, {
      cursorOffset: offset,
      limit,
    })
    setCachedPublicResponse(cacheKey, envelope, { watermark: watermarkIso })
    res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL)
    res.setHeader('X-Cache', 'MISS')
    res.json(envelope)
  })

  app.get('/api/network/summary', (_req: Request, res: Response) => {
    const { envelope } = buildNetworkSummary(database)
    res.json(envelope)
  })

  app.get('/api/explorer/transaction/:hash', (req: Request, res: Response) => {
    const param = req.params.hash
    const raw = (Array.isArray(param) ? param[0] : param) ?? ''
    const hash = decodeURIComponent(raw).trim()
    if (!isPlausibleTxHash(hash)) {
      sendApiError(
        res,
        400,
        'VALIDATION',
        'A 64-character hex transaction hash is required.',
      )
      return
    }

    const network = resolveExplorerNetwork()
    const url = buildNimiqExplorerUrl(hash, network)
    const format = typeof req.query.format === 'string'
      ? req.query.format.trim().toLowerCase()
      : ''

    if (format === 'json') {
      res.json({ url, network })
      return
    }

    res.redirect(302, url)
  })
}
