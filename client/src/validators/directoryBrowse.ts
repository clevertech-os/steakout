/**
 * Client-only directory browse helpers: find, letter index, layout preference.
 * Does not change API sort order.
 */
import { normalizeAddress, shortAddress } from '../addresses'
import type { ValidatorListItem } from './api'

export type DirectoryLayout = 'list' | 'cards'

const LAYOUT_KEY = 'steakout.directoryLayout'

export function validatorDisplayName(validator: ValidatorListItem): string {
  const name = validator.name?.trim()
  return name || shortAddress(validator.address)
}

export function validatorListId(address: string): string {
  return `validator-${normalizeAddress(address)}`
}

export function matchesDirectoryQuery(
  validator: ValidatorListItem,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const name = validator.name?.trim().toLowerCase() ?? ''
  const compact = normalizeAddress(validator.address).toLowerCase()
  const compactQuery = q.replace(/\s+/g, '')
  return name.includes(q) || compact.includes(compactQuery)
}

/** First letter of the display name, or `#` for digits/symbols. */
export function directoryLetterKey(displayName: string): string {
  const ch = displayName.trim().charAt(0)
  if (!ch) return '#'
  const upper = ch.toUpperCase()
  return /[A-Z]/.test(upper) ? upper : '#'
}

export interface DirectoryLetterGroup {
  letter: string
  items: { validator: ValidatorListItem; listIndex: number }[]
}

export function groupValidatorsByLetter(
  validators: ValidatorListItem[],
): DirectoryLetterGroup[] {
  const buckets = new Map<string, DirectoryLetterGroup['items']>()
  validators.forEach((validator, listIndex) => {
    const letter = directoryLetterKey(validatorDisplayName(validator))
    const existing = buckets.get(letter)
    const entry = { validator, listIndex }
    if (existing) existing.push(entry)
    else buckets.set(letter, [entry])
  })
  const letters = [...buckets.keys()].sort((a, b) => {
    if (a === '#') return 1
    if (b === '#') return -1
    return a.localeCompare(b)
  })
  return letters.map((letter) => ({
    letter,
    items: buckets.get(letter) ?? [],
  }))
}

export function readDirectoryLayout(): DirectoryLayout {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY)
    if (stored === 'list' || stored === 'cards') return stored
  } catch {
    // Private mode / blocked storage: keep the mobile-first default.
  }
  return 'list'
}

export function writeDirectoryLayout(layout: DirectoryLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // Ignore quota / private-mode failures.
  }
}
