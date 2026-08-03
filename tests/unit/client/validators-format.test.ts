import { describe, expect, it } from 'vitest'
import {
  DATA_STATUS_DEFINITIONS,
  DATA_STATUS_LABELS,
} from '../../../client/src/components/DataStatusTag.tsx'
import {
  OBSERVATION_STATUS_DEFINITIONS,
  OBSERVATION_STATUS_LABELS,
  type ObservationStatus,
} from '../../../client/src/components/StatusChip.tsx'
import {
  formatDeclaredFee,
  formatDominance,
  formatOfficialScore,
  formatObservationStatus,
  formatStakeNim,
  formatStakersCount,
  INSUFFICIENT_DATA,
  validatorInitials,
} from '../../../client/src/validators/format.ts'

describe('formatOfficialScore', () => {
  it('maps null and negative to Insufficient data', () => {
    expect(formatOfficialScore(null)).toBe(INSUFFICIENT_DATA)
    expect(formatOfficialScore(undefined)).toBe(INSUFFICIENT_DATA)
    expect(formatOfficialScore(-1)).toBe(INSUFFICIENT_DATA)
  })

  it('formats a 0–1 trust score as percent', () => {
    expect(formatOfficialScore(0.9999)).toMatch(/%$/)
    expect(formatOfficialScore(0)).toBe('0.00%')
  })
})

describe('formatDominance / formatStakeNim / formatStakersCount', () => {
  it('never invents zeros for missing fields', () => {
    expect(formatDominance(null)).toBe(INSUFFICIENT_DATA)
    expect(formatStakeNim(null)).toBe(INSUFFICIENT_DATA)
    expect(formatStakersCount(null)).toBe(INSUFFICIENT_DATA)
  })

  it('formats stake Luna into compact NIM', () => {
    // 100_000 Luna = 1 NIM
    expect(formatStakeNim(100_000)).toBe('1 NIM')
    expect(formatStakeNim(155_935_888_886_63)).toMatch(/NIM$/)
  })

  it('formats dominance as a percent', () => {
    expect(formatDominance(0.017)).toBe('1.70%')
  })
})

describe('formatDeclaredFee', () => {
  it('treats empty as insufficient and fractions as percent', () => {
    expect(formatDeclaredFee(null)).toBe(INSUFFICIENT_DATA)
    expect(formatDeclaredFee('0.05')).toBe('5%')
    expect(formatDeclaredFee('0')).toBe('0%')
  })
})

describe('validatorInitials', () => {
  it('uses name words or address fallback', () => {
    expect(validatorInitials('Keyring Staking', 'NQ96X97C94M16MV3KJ0GJA5U6VB46Y63EUH4')).toBe('KS')
    expect(validatorInitials(null, 'NQ96X97C94M16MV3KJ0GJA5U6VB46Y63EUH4')).toBe('96')
  })
})

describe('P2-09 status labels (StatusChip / DataStatusTag)', () => {
  const observationStatuses: ObservationStatus[] = [
    'on-schedule',
    'mostly-on-schedule',
    'irregular',
    'insufficient-data',
    'unavailable',
  ]

  it('defines one-sentence definitions for every observation status', () => {
    for (const status of observationStatuses) {
      const def = OBSERVATION_STATUS_DEFINITIONS[status]
      expect(def.length).toBeGreaterThan(20)
      expect(def.endsWith('.')).toBe(true)
      expect(OBSERVATION_STATUS_LABELS[status].length).toBeGreaterThan(0)
      expect(formatObservationStatus(status)).toBe(OBSERVATION_STATUS_LABELS[status])
    }
  })

  it('captions Registry declaration vs Verified observation distinctly', () => {
    expect(DATA_STATUS_LABELS.registry).toBe('Registry declaration')
    expect(DATA_STATUS_LABELS.verified).toBe('Verified observation')
    expect(DATA_STATUS_DEFINITIONS.registry.toLowerCase()).toMatch(/registry/)
    expect(DATA_STATUS_DEFINITIONS.verified.toLowerCase()).toMatch(/on-chain|chain/)
    // Every data status has a definition sentence.
    for (const status of Object.keys(DATA_STATUS_DEFINITIONS) as Array<
      keyof typeof DATA_STATUS_DEFINITIONS
    >) {
      expect(DATA_STATUS_DEFINITIONS[status].endsWith('.')).toBe(true)
    }
  })
})
