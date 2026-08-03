/**
 * P2-16 — Shareable validator profile URLs + server-injected OG/Twitter meta.
 *
 * Path-based GET /validators/:address serves the SPA HTML with title/description
 * filled from the registry + observation summary when available. Crawlers never
 * see hash routes; clients rewrite path opens into `#/validators/:address`.
 */

import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { Express, Request, Response } from 'express'
import { isValidNimiqAddress, normalizeAddress, shortAddress } from './addresses.js'
import { loadObservationSummaries } from './observationScoring.js'
import {
  getValidatorRowByAddress,
  type ObservationStatus,
} from './validatorSync.js'

/** Neutral observation labels (mirror client StatusChip / METHODOLOGY §3). */
const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  'on-schedule': 'On schedule',
  'mostly-on-schedule': 'Mostly on schedule',
  irregular: 'Irregular',
  'insufficient-data': 'Not enough observed data',
  unavailable: 'Observation unavailable',
}

export interface ProfileMetaInput {
  name: string | null
  address: string
  officialScore: number | null
  observationStatus: ObservationStatus
  historyDepthDays: number
  found: boolean
}

export interface ProfilePageMeta {
  title: string
  description: string
}

function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return 'Unavailable'
  return String(score)
}

/**
 * Honest title + description from displayed fields only.
 * No APY, fee effectiveness, or quality claims.
 */
export function buildProfilePageMeta(input: ProfileMetaInput): ProfilePageMeta {
  if (!input.found) {
    return {
      title: 'Validator profile · Steakout',
      description:
        'No registry record for this validator address on Steakout, or the address is not valid.',
    }
  }

  const displayName = input.name?.trim() || shortAddress(input.address)
  const statusLabel =
    OBSERVATION_STATUS_LABELS[input.observationStatus] ??
    OBSERVATION_STATUS_LABELS['insufficient-data']
  const depth =
    Number.isFinite(input.historyDepthDays) && input.historyDepthDays > 0
      ? Math.floor(input.historyDepthDays)
      : 0

  const parts = [
    `Observation: ${statusLabel}.`,
    `Official Nimiq Validator Trust Score: ${formatScore(input.officialScore)}.`,
    depth > 0
      ? `Indexed history depth: ${depth} day${depth === 1 ? '' : 's'}.`
      : 'Indexed history depth: insufficient data.',
  ]

  return {
    title: `${displayName} · Steakout`,
    description: parts.join(' '),
  }
}

/** Escape text for use inside HTML attribute values and title text. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Inject title + description + OG/Twitter tags into built SPA HTML.
 * Safe for unknown validators (caller supplies graceful meta).
 */
export function injectProfileMeta(
  html: string,
  meta: ProfilePageMeta,
  options: { canonicalUrl?: string } = {},
): string {
  const title = escapeHtml(meta.title)
  const description = escapeHtml(meta.description)
  const canonical = options.canonicalUrl
    ? escapeHtml(options.canonicalUrl)
    : undefined

  let out = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${title}</title>`,
  )

  // Drop existing description / social tags so we do not double up.
  out = out.replace(
    /<meta\s+(?:name|property)=["'](?:description|og:title|og:description|og:url|twitter:title|twitter:description)["'][^>]*>\s*/gi,
    '',
  )

  const tags = [
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  ]
  if (canonical) {
    tags.push(`<meta property="og:url" content="${canonical}" />`)
    tags.push(`<link rel="canonical" href="${canonical}" />`)
  }

  if (out.includes('</head>')) {
    out = out.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
  } else {
    out = `${tags.join('\n')}\n${out}`
  }

  return out
}

export function resolveProfileMetaFromDb(
  database: Database.Database,
  rawAddress: string,
): ProfilePageMeta {
  if (!isValidNimiqAddress(rawAddress)) {
    return buildProfilePageMeta({
      name: null,
      address: rawAddress,
      officialScore: null,
      observationStatus: 'insufficient-data',
      historyDepthDays: 0,
      found: false,
    })
  }

  const row = getValidatorRowByAddress(database, rawAddress)
  if (!row) {
    return buildProfilePageMeta({
      name: null,
      address: normalizeAddress(rawAddress),
      officialScore: null,
      observationStatus: 'insufficient-data',
      historyDepthDays: 0,
      found: false,
    })
  }

  const summaries = loadObservationSummaries(database)
  const key = normalizeAddress(row.address)
  const observation = summaries.get(key)

  return buildProfilePageMeta({
    name: row.name,
    address: row.address,
    officialScore: row.official_score,
    observationStatus: observation?.status ?? 'insufficient-data',
    historyDepthDays: observation?.historyDepthDays ?? 0,
    found: true,
  })
}

export interface ProfileShareMountOptions {
  database: Database.Database
  /** Absolute path to built `client/dist/index.html`. */
  indexHtmlPath: string
  /**
   * Public origin for og:url / canonical (optional).
   * Falls back to request Host when unset.
   */
  publicOrigin?: string
}

/**
 * Mount path-based profile share route that serves SPA HTML with injected meta.
 * Must be registered before or instead of a bare static 404 for this path.
 */
export function mountProfileShareRoutes(
  app: Express,
  options: ProfileShareMountOptions,
): void {
  let cachedHtml: string | null = null

  const readHtml = (): string => {
    if (cachedHtml != null) return cachedHtml
    cachedHtml = readFileSync(options.indexHtmlPath, 'utf8')
    return cachedHtml
  }

  const handler = (req: Request, res: Response) => {
    const param = req.params.address
    const raw = (Array.isArray(param) ? param[0] : param) ?? ''
    let address = raw
    try {
      address = decodeURIComponent(raw)
    } catch {
      address = raw
    }

    let meta: ProfilePageMeta
    try {
      meta = resolveProfileMetaFromDb(options.database, address)
    } catch {
      meta = buildProfilePageMeta({
        name: null,
        address,
        officialScore: null,
        observationStatus: 'insufficient-data',
        historyDepthDays: 0,
        found: false,
      })
    }

    const origin =
      options.publicOrigin?.replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host') ?? 'localhost'}`
    const compact = isValidNimiqAddress(address)
      ? normalizeAddress(address)
      : address.trim()
    const canonicalUrl = `${origin}/validators/${encodeURIComponent(compact)}`

    let html: string
    try {
      html = readHtml()
    } catch {
      res.status(503).type('text/plain').send('SPA not built')
      return
    }

    const body = injectProfileMeta(html, meta, { canonicalUrl })
    res.status(200).type('html').setHeader('Cache-Control', 'public, max-age=60').send(body)
  }

  app.get('/validators/:address', handler)
}
