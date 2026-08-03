import { getValidatorByAddress } from './nimiq-rpc.js'
import { normalizeSchedule } from './payoutClassifier.js'

export type ValidatorMode = 'known-only' | 'all-observable'
export type NormalizedPayoutType = 'direct' | 'restake' | 'unknown'

export interface NormalizedValidator {
  address: string
  name: string | null
  website: string | null
  description: string | null
  fee: string | null
  payoutType: NormalizedPayoutType
  /** Raw registry declaration; never replaced by a normalized form. */
  payoutSchedule: string | null
  /**
   * METHODOLOGY.md §4.2 interval when `payoutSchedule` is unambiguous;
   * null when missing or not normalizable. Maps to `validators.schedule_every_hours`
   * when P1-04 `validatorSync` upserts rows.
   */
  scheduleEveryHours: number | null
  officialScore: number | null
  dominanceRatio: number | null
  stakeLuna: number | null
  stakersCount: number | null
  rewardAddress: string | null
  isListed: boolean | null
  sourceTimestamp: string
}

export interface RewardAddressResolution {
  attempted: number
  resolved: number
  unavailable: number
}

export interface ValidatorSnapshot {
  mode: ValidatorMode
  source: string
  sourceTimestamp: string
  validators: NormalizedValidator[]
  rewardAddressResolution: RewardAddressResolution
}

export type RewardAddressResolver = (validatorAddress: string) => Promise<string | null>
export type ValidatorsFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface FetchValidatorsOptions {
  apiUrl?: string
  rpcUrl?: string
  fetcher?: ValidatorsFetch
  resolveRewardAddresses?: boolean
  resolveRewardAddress?: RewardAddressResolver
  now?: () => string
}

interface RegistryRecord {
  [key: string]: unknown
}

const DEFAULT_API_URL = 'https://validators-api-main.je-cf9.workers.dev/api/v1/validators'

function isRecord(value: unknown): value is RegistryRecord {
  return typeof value === 'object' && value !== null
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? value : null
}

function nullableNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === -1) return null
  return value
}

export function normalizePayoutType(value: unknown): NormalizedPayoutType {
  if (typeof value !== 'string') return 'unknown'
  const payoutType = value.trim().toLowerCase()
  if (payoutType === 'direct') return 'direct'
  if (payoutType === 'restake') return 'restake'
  return 'unknown'
}

export function normalizeOfficialScore(value: unknown): number | null {
  if (typeof value === 'number') return nullableNumber(value)
  if (!isRecord(value)) return null
  return nullableNumber(value.total)
}

export function normalizeValidator(
  value: unknown,
  sourceTimestamp: string,
  rewardAddress: string | null = null,
): NormalizedValidator {
  if (!isRecord(value) || typeof value.address !== 'string' || value.address.trim() === '') {
    throw new Error('Validator registry record has no address')
  }

  const score = isRecord(value.score) ? value.score : null
  const fee = typeof value.fee === 'number' && Number.isFinite(value.fee)
    ? String(value.fee)
    : nullableString(value.fee)
  const payoutSchedule = nullableString(value.payoutSchedule)

  return {
    address: value.address,
    name: nullableString(value.name),
    website: nullableString(value.website),
    description: nullableString(value.description),
    fee: fee === '-1' ? null : fee,
    payoutType: normalizePayoutType(value.payoutType),
    payoutSchedule,
    scheduleEveryHours: normalizeSchedule(payoutSchedule).everyHours,
    officialScore: normalizeOfficialScore(score ?? value.score),
    dominanceRatio: nullableNumber(value.dominanceRatio),
    stakeLuna: nullableNumber(value.balance),
    stakersCount: nullableNumber(value.stakers),
    rewardAddress: nullableString(rewardAddress),
    isListed: typeof value.isListed === 'boolean' ? value.isListed : null,
    sourceTimestamp,
  }
}

function registryRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.validators)) return value.validators
  throw new Error('Validators API response is not a validator list')
}

function defaultRewardAddressResolver(rpcUrl?: string): RewardAddressResolver {
  return async (validatorAddress) => {
    const validator = await getValidatorByAddress(validatorAddress, rpcUrl)
    return validator.rewardAddress
  }
}

export async function fetchValidators(
  mode: ValidatorMode,
  options: FetchValidatorsOptions = {},
): Promise<ValidatorSnapshot> {
  const apiUrl = options.apiUrl ?? process.env.VALIDATORS_API_URL ?? DEFAULT_API_URL
  const sourceTimestamp = options.now?.() ?? new Date().toISOString()
  const endpoint = new URL(apiUrl)
  endpoint.searchParams.set('only-known', mode === 'known-only' ? 'true' : 'false')
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(endpoint, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Validators API HTTP status ${response.status}`)
  }

  const records = registryRecords(await response.json())
  const resolveRewardAddresses = options.resolveRewardAddresses ?? true
  const resolver = options.resolveRewardAddress ?? defaultRewardAddressResolver(options.rpcUrl)
  let resolved = 0
  let unavailable = 0
  const validators: NormalizedValidator[] = []

  for (const record of records) {
    let rewardAddress: string | null = null
    if (resolveRewardAddresses) {
      if (!isRecord(record) || typeof record.address !== 'string') {
        throw new Error('Validator registry record has no address')
      }
      let resolutionFailed = false
      try {
        rewardAddress = await resolver(record.address)
      } catch {
        resolutionFailed = true
        unavailable += 1
      }
      if (rewardAddress) {
        resolved += 1
      } else if (!resolutionFailed) {
        unavailable += 1
      }
    }
    validators.push(normalizeValidator(record, sourceTimestamp, rewardAddress))
  }

  return {
    mode,
    source: endpoint.origin + endpoint.pathname,
    sourceTimestamp,
    validators,
    rewardAddressResolution: {
      attempted: resolveRewardAddresses ? validators.length : 0,
      resolved,
      unavailable: resolveRewardAddresses ? unavailable : 0,
    },
  }
}

export async function fetchValidatorModes(
  options: FetchValidatorsOptions = {},
): Promise<{ knownOnly: ValidatorSnapshot; allObservable: ValidatorSnapshot }> {
  return {
    knownOnly: await fetchValidators('known-only', options),
    allObservable: await fetchValidators('all-observable', options),
  }
}
