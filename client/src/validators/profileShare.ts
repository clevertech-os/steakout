/**
 * Shareable validator profile URLs + document meta (P2-16).
 *
 * Canonical public URLs are path-based (`/validators/:address`) so crawlers
 * can unfurl them. The SPA still uses hash routing; App.tsx rewrites path
 * opens into `#/validators/:address` after the server has served meta HTML.
 */

import { normalizeAddress, shortAddress } from '../addresses'
import {
  OBSERVATION_STATUS_LABELS,
  type ObservationStatus,
} from '../components/StatusChip'

export interface ProfileMetaInput {
  /** Registry name when known. */
  name: string | null
  /** Validator address (spaced or compact). */
  address: string
  /** Official Nimiq Trust Score, or null when unavailable. */
  officialScore: number | null
  observationStatus: ObservationStatus
  historyDepthDays: number
  /** false when address invalid or not in registry. */
  found: boolean
}

export interface ProfilePageMeta {
  title: string
  description: string
}

/** Canonical path for sharing / unfurl (compact address, no hash). */
export function buildProfileSharePath(address: string): string {
  return `/validators/${normalizeAddress(address)}`
}

/** Absolute share URL for the current origin. */
export function buildProfileShareUrl(address: string, origin = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}${buildProfileSharePath(address)}`
}

function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return 'Unavailable'
  return score.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/**
 * Honest title + description from displayed fields only.
 * No APY, fee effectiveness, or quality claims (product invariants).
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

const DEFAULT_TITLE = 'Steakout'
const DEFAULT_DESCRIPTION =
  'Stake in. Know who is paying you. Non-custodial Nimiq staking cockpit and validator accountability.'

/** Apply document title + description (and matching OG/Twitter tags). */
export function applyDocumentMeta(meta: ProfilePageMeta): void {
  if (typeof document === 'undefined') return
  document.title = meta.title
  setMetaContent('description', meta.description, 'name')
  setMetaContent('og:title', meta.title, 'property')
  setMetaContent('og:description', meta.description, 'property')
  setMetaContent('twitter:title', meta.title, 'name')
  setMetaContent('twitter:description', meta.description, 'name')
}

/** Restore default shell meta when leaving a profile. */
export function restoreDefaultDocumentMeta(): void {
  applyDocumentMeta({
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  })
}

function setMetaContent(
  key: string,
  content: string,
  attr: 'name' | 'property',
): void {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}
