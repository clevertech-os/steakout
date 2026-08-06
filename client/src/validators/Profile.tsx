/**
 * Validator profile — summary + progressive disclosure (SPEC §6.3 declutter).
 * Public, no wallet required. Stake CTA opens StakeFlow when connected.
 *
 * Official Nimiq Trust Score is always shown as the official score,
 * never blended with Steakout observation status (invariant #6).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  formatDisplayAddress,
  isValidNimiqAddress,
  shortAddress,
} from '../addresses'
import { walletAuthApi } from '../api/walletAuth'
import type { PositionState } from '../api/position'
import DataStatusTag from '../components/DataStatusTag'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import {
  formatAgeLabel,
  resolveAgeSeconds,
} from '../components/FreshnessTag'
import { humanizeFetchError } from '../components/humanizeError'
import {
  OBSERVATION_STATUS_LABELS,
  type ObservationStatus,
} from '../components/StatusChip'
import { buildNimiqAddressExplorerUrl } from '../explorer'
import { hashWantsChange, hashWantsStake } from '../routes'
import StakeFlow, {
  loadAvailableLunaForStake,
  type StakeFlowMode,
} from '../staking/StakeFlow'
import { STAKE_CONNECT_FIRST } from '../staking/copy'
import { useWallet } from '../wallet/useWallet'
import Evidence, { type EvidenceSummaryMeta } from './Evidence'
import ObservationHeroPanel from './ObservationHeroPanel'
import {
  fetchValidatorProfile,
  peekValidatorProfile,
  ValidatorsApiError,
  type ValidatorProfileEnvelope,
} from './api'
import {
  formatDeclaredFee,
  formatDeclaredMinPayout,
  formatDominance,
  formatObservedPaymentFloor,
  formatPayoutType,
  INSUFFICIENT_DATA,
} from './format'
import {
  applyDocumentMeta,
  buildProfilePageMeta,
  buildProfileShareUrl,
  restoreDefaultDocumentMeta,
} from './profileShare'
import './Profile.css'

const LUNA_PER_NIM = 100_000

export interface ProfileProps {
  /** Route param from `#/validators/:address` (spaced or compact). */
  address: string
}

type DeclaredPayoutType = 'direct' | 'restake' | 'unknown'

interface ValidatorProfileData {
  address: string
  name: string | null
  isListed: boolean
  logoUrl: string | null
  officialScore: number | null
  stakeLuna: number | null
  dominanceRatio: number | null
  stakersCount: number | null
  declared: {
    fee: string | null
    payoutType: DeclaredPayoutType
    payoutSchedule: string | null
    scheduleNormalized: { everyHours: number } | null
  }
  observation: {
    status: ObservationStatus
    lastObservedAt: string | null
    historyDepthDays: number
    observedWindows?: number | null
    expectedWindows?: number | null
  }
  registryUpdatedAt: string
  website: string | null
  description: string | null
  rewardAddress: string | null
  rewardExplorerUrl: string | null
  scoreComponents: null
  canaryConfigured?: boolean
  canaryProbe?: {
    configured: boolean
    status: 'not-configured' | 'pending' | 'active'
    statusLabel: string
    probeId: string | null
    probeAddress: string | null
    probeExplorerUrl: string | null
    stakeAmountLuna: number | null
    stakedAt: string | null
    stakeTxHash: string | null
    stakeExplorerUrl: string | null
    payoutType: DeclaredPayoutType | null
    lastPaymentAt: string | null
    lastPaymentLuna: number | null
    lastPaymentTxHash: string | null
    lastPaymentExplorerUrl: string | null
    lastStakerBalanceLuna: number | null
    lastStakerBalanceAt: string | null
    note: string
    dataStatus: 'insufficient' | 'verified' | 'unavailable'
  }
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'not-found'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; envelope: ValidatorProfileEnvelope }

function formatNimFromLuna(luna: number | null): string {
  if (luna == null || !Number.isFinite(luna)) return 'Unavailable'
  const nim = luna / LUNA_PER_NIM
  return `${nim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`
}

/** Profile hero score: keep honest null handling; display as numeric score. */
function formatOfficialScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return 'Insufficient data'
  return score.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/**
 * Stakeout Findings (canary probe): claim verification only when the indexer
 * has observed a reward path (status active / dataStatus verified).
 */
function canaryVerificationCopy(probe: {
  status: 'not-configured' | 'pending' | 'active'
  dataStatus: 'insufficient' | 'verified' | 'unavailable'
}): {
  /** Optional summary meta next to “Stakeout Findings”; empty when still waiting. */
  summaryLabel: string
  headline: string
  body: string
  verified: boolean
} {
  const verified =
    probe.status === 'active' && probe.dataStatus === 'verified'
  if (verified) {
    return {
      summaryLabel: 'Verified',
      headline: 'Rewards reached our stake',
      body: 'Steakout has observed that rewards reach our own stake on this validator as expected.',
      verified: true,
    }
  }
  return {
    summaryLabel: '',
    headline: 'Waiting for first reward observation',
    body: 'Steakout has a small stake on this validator and is watching for the first reward to reach that address.',
    verified: false,
  }
}

function formatFreshness(ageSeconds: number, updatedAt: string): string {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return updatedAt ? `Updated ${updatedAt}` : 'Freshness unavailable'
  }
  if (ageSeconds < 60) return 'Updated just now'
  const minutes = Math.floor(ageSeconds / 60)
  if (minutes < 60) return `Updated ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `Updated ${hours} h ago`
  const days = Math.floor(hours / 24)
  return `Updated ${days} d ago`
}

function historyDepthCaption(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return 'Insufficient history'
  const n = Math.floor(days)
  if (n < 1) return '< 1 day indexed'
  return n === 1 ? '1 day indexed' : `${n} days indexed`
}

/** Compact windows line for hero / evidence summary. */
function windowsCaption(
  observed: number | null | undefined,
  expected: number | null | undefined,
): string | null {
  if (
    observed == null ||
    expected == null ||
    !Number.isFinite(observed) ||
    !Number.isFinite(expected) ||
    expected <= 0
  ) {
    return null
  }
  return `${observed.toLocaleString()} of ${expected.toLocaleString()} windows`
}

function dominanceStripLabel(ratio: number | null): string {
  const formatted = formatDominance(ratio)
  if (formatted === INSUFFICIENT_DATA) return formatted
  return `${formatted} of network`
}

function MetricRow({
  label,
  definition,
  value,
  status,
  freshness,
}: {
  label: string
  definition: string
  value: ReactNode
  status: 'verified' | 'registry' | 'inferred' | 'insufficient' | 'unavailable'
  freshness: string
}) {
  return (
    <div className="profile-metric">
      <div className="profile-metric-head">
        <dt className="nq-label profile-metric-label" title={definition}>
          {label}
        </dt>
        <DataStatusTag status={status} />
      </div>
      <dd className="profile-metric-value">{value}</dd>
      <p className="profile-metric-meta">
        <span className="profile-metric-def">{definition}</span>
        <span className="profile-freshness" aria-label={freshness}>
          {freshness}
        </span>
      </p>
    </div>
  )
}

export default function Profile({ address: rawAddress }: ProfileProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [stakeOpen, setStakeOpen] = useState(false)
  const [stakeFlowMode, setStakeFlowMode] = useState<StakeFlowMode>('stake')
  const [stakeBalance, setStakeBalance] = useState<{
    availableLuna: number | null
    freeBalanceLuna: number | null
    htlcBalanceLuna: number
    positionState: PositionState | null
    currentDelegation: string | null
  }>({
    availableLuna: null,
    freeBalanceLuna: null,
    htlcBalanceLuna: 0,
    positionState: null,
    currentDelegation: null,
  })
  const [evidenceMeta, setEvidenceMeta] = useState<EvidenceSummaryMeta | null>(
    null,
  )
  /** Defer heavy observations fetch until the user opens evidence. */
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const evidenceDetailsRef = useRef<HTMLDetailsElement | null>(null)

  const wallet = useWallet({ auth: walletAuthApi })

  const openFullEvidence = useCallback(() => {
    setEvidenceOpen(true)
    const el = evidenceDetailsRef.current
    if (el && !el.open) {
      el.open = true
    }
    // Next frame so disclosure body mounts before scroll.
    requestAnimationFrame(() => {
      evidenceDetailsRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  }, [])

  const retry = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  const openStakeFlow = useCallback((mode: StakeFlowMode = 'stake') => {
    setStakeFlowMode(mode)
    setStakeOpen(true)
  }, [])

  const onEvidenceMeta = useCallback((meta: EvidenceSummaryMeta) => {
    setEvidenceMeta(meta)
  }, [])

  // Deep-link `#/validators/:address?stake=1` or `?change=1` once profile is ok.
  useEffect(() => {
    if (state.kind !== 'ok') return
    const hash = window.location.hash
    if (hashWantsChange(hash)) {
      setStakeFlowMode('update')
      setStakeOpen(true)
    } else if (hashWantsStake(hash)) {
      setStakeFlowMode('stake')
      setStakeOpen(true)
    } else {
      return
    }
    // Clear the query so reload does not re-open forever
    const path = hash.replace(/\?.*$/, '')
    if (path !== hash) {
      window.history.replaceState(null, '', path)
    }
  }, [state.kind])

  // Load position when connected so CTA can offer Change vs Stake (P2-11).
  useEffect(() => {
    if (wallet.status !== 'connected') return
    let cancelled = false
    void loadAvailableLunaForStake().then((bal) => {
      if (!cancelled) setStakeBalance(bal)
    })
    return () => {
      cancelled = true
    }
  }, [wallet.status, wallet.address])

  useEffect(() => {
    let cancelled = false

    if (!isValidNimiqAddress(rawAddress)) {
      setState({ kind: 'invalid' })
      return
    }

    setEvidenceMeta(null)

    // Instant paint from client cache (card hover / prior visit).
    const peek = peekValidatorProfile(rawAddress)
    if (peek) {
      setState({ kind: 'ok', envelope: peek.envelope as ValidatorProfileEnvelope })
      if (peek.fresh && reloadToken === 0) {
        return () => {
          cancelled = true
        }
      }
    } else {
      setState({ kind: 'loading' })
    }

    ;(async () => {
      try {
        const envelope = await fetchValidatorProfile(rawAddress, {
          force: true,
        })
        if (cancelled) return
        setState({ kind: 'ok', envelope })
      } catch (err) {
        if (cancelled) return
        if (err instanceof ValidatorsApiError) {
          if (
            err.httpStatus === 404 ||
            err.code === 'VALIDATOR_NOT_FOUND'
          ) {
            setState({ kind: 'not-found', message: err.message })
            return
          }
          // Keep cached profile if revalidate fails.
          if (peek) return
          setState({ kind: 'error', message: err.message })
          return
        }
        if (peek) return
        setState({
          kind: 'error',
          message: humanizeFetchError(
            err,
            'Could not load this validator profile. Try again later.',
          ),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rawAddress, reloadToken])

  // P2-16: document title + meta from loaded profile (client-side; server injects for crawlers).
  useEffect(() => {
    if (state.kind === 'ok') {
      const profile = state.envelope.data
      applyDocumentMeta(
        buildProfilePageMeta({
          name: profile.name,
          address: profile.address,
          officialScore: profile.officialScore,
          observationStatus: profile.observation.status,
          historyDepthDays: profile.observation.historyDepthDays,
          found: true,
        }),
      )
    } else if (
      state.kind === 'invalid' ||
      state.kind === 'not-found' ||
      state.kind === 'error'
    ) {
      applyDocumentMeta(
        buildProfilePageMeta({
          name: null,
          address: rawAddress,
          officialScore: null,
          observationStatus: 'insufficient-data',
          historyDepthDays: 0,
          found: false,
        }),
      )
    }

    return () => {
      restoreDefaultDocumentMeta()
    }
  }, [state, rawAddress])

  async function handleShare(profileAddress: string, displayName: string) {
    const url = buildProfileShareUrl(profileAddress)
    const shareData = {
      title: `${displayName} · Steakout`,
      text: `Validator profile on Steakout: ${displayName}`,
      url,
    }

    setShareFeedback(null)
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share(shareData)
        setShareFeedback('Shared')
        return
      }
    } catch (err) {
      // User cancelled system share — leave quietly.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Fall through to clipboard.
    }

    try {
      await navigator.clipboard.writeText(url)
      setShareFeedback('Link copied')
    } catch {
      setShareFeedback('Copy failed. Select the address bar URL')
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="profile">
        <header className="shell-header page-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="page-title page-title--profile">Validator</h1>
          <p className="profile-address mono" aria-hidden="true">
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--mid" />
          </p>
        </header>
        <p className="profile-status" id="profile-loading-status" role="status">
          Loading validator profile…
        </p>
        <div className="profile-hero" aria-busy="true" aria-labelledby="profile-loading-status">
          <section className="nq-card shell-card profile-card profile-card--official profile-hero-panel">
            <p className="profile-hero-label">Official Trust Score</p>
            <div className="profile-skeleton" aria-hidden="true">
              <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--narrow" />
              <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--mid" />
            </div>
          </section>
          <section className="nq-card shell-card profile-card profile-card--observation profile-hero-panel">
            <p className="profile-hero-label">Payout observation</p>
            <div className="profile-skeleton" aria-hidden="true">
              <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--mid" />
              <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--narrow" />
            </div>
          </section>
        </div>
        <ul className="profile-policy-strip" aria-hidden="true">
          <li className="profile-policy-item">
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--narrow" />
          </li>
          <li className="profile-policy-item">
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--narrow" />
          </li>
          <li className="profile-policy-item">
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--narrow" />
          </li>
          <li className="profile-policy-item">
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--narrow" />
          </li>
        </ul>
        <section className="nq-card shell-card profile-card profile-card--cta" aria-hidden="true">
          <div className="profile-skeleton">
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--wide" />
            <span className="so-skeleton-line profile-skeleton-line profile-skeleton-line--mid" />
          </div>
        </section>
      </div>
    )
  }

  if (state.kind === 'invalid') {
    return (
      <div className="profile">
        <header className="shell-header page-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="page-title page-title--profile">Invalid address</h1>
        </header>
        <section className="nq-card nq-card-lg shell-card profile-state-card" aria-labelledby="profile-invalid-title">
          <h2 id="profile-invalid-title">This is not a valid Nimiq address.</h2>
          <p>Check the URL and try again from the validators directory.</p>
          <div className="profile-state-actions">
            <a className="nq-pill-blue profile-state-cta" href="#/validators">
              Browse validators
            </a>
          </div>
        </section>
      </div>
    )
  }

  if (state.kind === 'not-found') {
    return (
      <div className="profile">
        <header className="shell-header page-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="page-title page-title--profile">Not found</h1>
        </header>
        <section className="nq-card nq-card-lg shell-card profile-state-card" aria-labelledby="profile-missing-title">
          <h2 id="profile-missing-title">No registry record for this address.</h2>
          <p>
            {state.message ||
              'Steakout has no registry entry for this address. It may be unlisted or not yet synced.'}
          </p>
          <div className="profile-state-actions">
            <a className="nq-pill-blue profile-state-cta" href="#/validators">
              Browse validators
            </a>
            <button type="button" className="nq-pill-secondary profile-state-cta" onClick={retry}>
              Try again
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="profile">
        <header className="shell-header page-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="page-title page-title--profile">Unavailable</h1>
        </header>
        <section className="nq-card nq-card-lg shell-card profile-state-card" aria-labelledby="profile-error-title">
          <h2 id="profile-error-title">Could not load this profile.</h2>
          <p>{state.message}</p>
          <div className="profile-state-actions">
            <button type="button" className="nq-pill-blue profile-state-cta" onClick={retry}>
              Try again
            </button>
            <a className="nq-pill-secondary profile-state-cta" href="#/validators">
              Browse validators
            </a>
          </div>
        </section>
      </div>
    )
  }

  const { envelope } = state
  const profile = envelope.data
  const registryFreshness = formatFreshness(
    envelope.dataFreshness.ageSeconds,
    envelope.updatedAt || profile.registryUpdatedAt || '',
  )
  const displayName = profile.name?.trim() || shortAddress(profile.address)
  const explorerForValidator = buildNimiqAddressExplorerUrl(profile.address)
  const rewardExplorer =
    profile.rewardExplorerUrl ??
    (profile.rewardAddress
      ? buildNimiqAddressExplorerUrl(profile.rewardAddress)
      : null)

  const scheduleDisplay =
    profile.declared.payoutSchedule ??
    (profile.declared.scheduleNormalized
      ? `Every ${profile.declared.scheduleNormalized.everyHours} hours`
      : 'Not declared')

  const obsStatus = evidenceMeta?.status ?? profile.observation.status
  const obsStatusLabel =
    OBSERVATION_STATUS_LABELS[obsStatus] ??
    OBSERVATION_STATUS_LABELS['insufficient-data']
  const obsHistoryDays =
    evidenceMeta?.historyDepthDays ?? profile.observation.historyDepthDays
  // Hero chip: deep history + insufficient-data is rarely "wait for more history"
  // (often non-normalizable schedule or too few expected windows).
  const heroStatusDefinition =
    obsStatus === 'insufficient-data'
      ? obsHistoryDays >= 7
        ? 'Declared schedule cannot be normalized for adherence grading, or not enough expected windows; raw observations may still be available.'
        : undefined
      : undefined
  const profileWindowsLabel = windowsCaption(
    profile.observation.observedWindows,
    profile.observation.expectedWindows,
  )
  const windowsLabel = evidenceMeta?.windowsLabel ?? profileWindowsLabel
  const evidenceSummaryParts = [
    'Payout evidence',
    obsStatusLabel,
    windowsLabel,
    historyDepthCaption(obsHistoryDays),
  ].filter(Boolean)
  const observationFacts = [
    windowsLabel,
    historyDepthCaption(obsHistoryDays),
  ]
    .filter(Boolean)
    .join(' · ')

  const canaryCopy = profile.canaryProbe?.configured
    ? canaryVerificationCopy(profile.canaryProbe)
    : null

  const ageSeconds = resolveAgeSeconds(
    envelope.dataFreshness.ageSeconds,
    envelope.updatedAt,
  )
  const lastUpdatedLabel =
    ageSeconds != null ? `Last updated ${formatAgeLabel(ageSeconds)}` : null

  return (
    <div className="profile">
      <EnvelopeStatusBanner status={envelope.status} onRetry={retry} />
      <header className="shell-header page-header">
        <div className="profile-topbar">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          {lastUpdatedLabel ? (
            <p className="profile-last-updated" role="status">
              {lastUpdatedLabel}
            </p>
          ) : null}
        </div>
        <p className="eyebrow">
          {profile.isListed ? 'Listed validator' : 'Observable validator'}
        </p>
        <div className="profile-title-row">
          <h1 className="page-title page-title--profile">{displayName}</h1>
          <div className="profile-share">
            <button
              type="button"
              className="nq-pill-secondary profile-share-btn"
              onClick={() => void handleShare(profile.address, displayName)}
            >
              Share
            </button>
            {shareFeedback ? (
              <span className="profile-share-feedback" role="status">
                {shareFeedback}
              </span>
            ) : null}
          </div>
        </div>
        <p className="profile-address mono">
          <a
            className="profile-external"
            href={explorerForValidator}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortAddress(profile.address)}
          </a>
        </p>
      </header>

      {/* Dual hero: official score | payout observation (never blended). */}
      <div
        className="profile-hero"
        data-observation-status={obsStatus}
      >
        <section
          className="nq-card shell-card profile-card profile-card--official profile-hero-panel"
          aria-labelledby="profile-official-score"
        >
          <h2 id="profile-official-score" className="profile-hero-label">
            Official Trust Score
          </h2>
          <p className="profile-score-value mono" data-testid="official-score">
            {formatOfficialScore(profile.officialScore)}
          </p>
          <p className="profile-hero-caption">
            Registry block-production score
          </p>
        </section>

        <ObservationHeroPanel
          address={profile.address}
          status={obsStatus}
          statusDefinition={heroStatusDefinition}
          observedWindows={
            profile.observation.observedWindows ?? null
          }
          expectedWindows={
            profile.observation.expectedWindows ?? null
          }
          historyDepthDays={obsHistoryDays}
          lastObservedAt={profile.observation.lastObservedAt}
          factsLine={observationFacts}
          onOpenFullEvidence={openFullEvidence}
          onTimelineMeta={(meta) => {
            onEvidenceMeta({
              status: meta.status,
              windowsLabel: windowsCaption(
                meta.observedWindows,
                meta.expectedWindows,
              ),
              historyDepthDays: meta.historyDepthDays,
            })
          }}
        />
      </div>
      <p className="profile-hero-freshness" aria-label={registryFreshness}>
        {registryFreshness}
        <span className="profile-hero-freshness-sep"> · </span>
        Server snapshot (not a live chain call)
      </p>

      {/* Policy strip — values only for quick compare. */}
      <ul className="profile-policy-strip" aria-label="Declared policy">
        <li className="profile-policy-item">
          <span className="profile-policy-label">Fee</span>
          <span className="profile-policy-value mono">
            {formatDeclaredFee(profile.declared.fee)}
          </span>
        </li>
        <li className="profile-policy-item">
          <span className="profile-policy-label">Min payout</span>
          <span className="profile-policy-value mono">
            {formatDeclaredMinPayout(profile.declared.minPayout)}
          </span>
        </li>
        <li className="profile-policy-item">
          <span className="profile-policy-label">Obs. floor</span>
          <span className="profile-policy-value mono">
            {formatObservedPaymentFloor(profile.observedPaymentFloor)}
          </span>
        </li>
        <li className="profile-policy-item">
          <span className="profile-policy-label">Type</span>
          <span className="profile-policy-value">
            {formatPayoutType(profile.declared.payoutType)}
          </span>
        </li>
        <li className="profile-policy-item">
          <span className="profile-policy-label">Schedule</span>
          <span className="profile-policy-value">{scheduleDisplay}</span>
        </li>
        <li className="profile-policy-item">
          <span className="profile-policy-label">Dominance</span>
          <span className="profile-policy-value mono">
            {dominanceStripLabel(profile.dominanceRatio)}
          </span>
        </li>
      </ul>

      {/* Stake CTA immediately under strip — same ProfileStakeCta behavior. */}
      <ProfileStakeCta
        profileAddress={profile.address}
        walletConnected={wallet.status === 'connected' && Boolean(wallet.address)}
        walletConnecting={wallet.connecting || wallet.status === 'connecting'}
        walletError={wallet.error}
        positionState={stakeBalance.positionState}
        currentDelegation={stakeBalance.currentDelegation}
        onOpenStake={() => openStakeFlow('stake')}
        onOpenChange={() => openStakeFlow('update')}
        onConnectStake={() => {
          void wallet.connect().then(() => openStakeFlow('stake'))
        }}
      />

      {/* Collapsed by default: evidence, canary, technical.
          Evidence API is large (run hashes); only fetch when opened. */}
      <details
        ref={evidenceDetailsRef}
        className="profile-disclosure nq-card shell-card profile-card profile-card--observation"
        onToggle={(e) => {
          if (e.currentTarget.open) setEvidenceOpen(true)
        }}
      >
        <summary className="profile-disclosure-summary">
          <span className="profile-disclosure-title">Payout evidence</span>
          <span className="profile-disclosure-meta">
            {evidenceSummaryParts.slice(1).join(' · ')}
          </span>
        </summary>
        <div className="profile-disclosure-body">
          {evidenceOpen ? (
            <Evidence
              address={profile.address}
              embedded
              profileStatus={profile.observation.status}
              profileHistoryDepthDays={profile.observation.historyDepthDays}
              profileLastObservedAt={profile.observation.lastObservedAt}
              onSummaryMeta={onEvidenceMeta}
            />
          ) : (
            <p className="nq-subline profile-section-note">
              Open to load indexed payout runs and explorer links.
            </p>
          )}
        </div>
      </details>

      {canaryCopy && profile.canaryProbe?.configured ? (
        <details
          className="profile-disclosure nq-card shell-card profile-card profile-card--canary"
          data-testid="canary-probe"
          data-canary-verified={canaryCopy.verified ? 'true' : 'false'}
        >
          <summary className="profile-disclosure-summary">
            <span className="profile-disclosure-title">Stakeout Findings</span>
            {canaryCopy.summaryLabel ? (
              <span
                className="profile-disclosure-meta"
                data-testid="canary-status"
              >
                {canaryCopy.summaryLabel}
              </span>
            ) : (
              <span className="visually-hidden" data-testid="canary-status">
                Pending observation
              </span>
            )}
          </summary>
          <div className="profile-disclosure-body">
            <div
              className="profile-canary-simple"
              data-verified={canaryCopy.verified ? 'true' : 'false'}
            >
              <p className="profile-canary-headline">{canaryCopy.headline}</p>
              <p className="profile-canary-body">{canaryCopy.body}</p>
              <details className="profile-canary-how">
                <summary className="profile-canary-how-summary">
                  How we check
                </summary>
                <p className="profile-canary-how-body">
                  Steakout stakes a small amount of our own NIM with this
                  validator and watches whether rewards reach that address. A
                  successful observation confirms payouts reached our position —
                  it is not a fee rating and not proof of how every staker is
                  treated.
                </p>
                <p className="profile-limitations-link">
                  <a className="nq-arrow" href="#/learn/methodology">
                    Methodology
                  </a>
                  {' · '}
                  <a className="nq-arrow" href="#/learn/limitations">
                    Limitations
                  </a>
                </p>
              </details>
            </div>
          </div>
        </details>
      ) : null}

      <details className="profile-disclosure nq-card shell-card profile-card">
        <summary className="profile-disclosure-summary">
          <span className="profile-disclosure-title">Technical details</span>
        </summary>
        <div className="profile-disclosure-body">
          <dl className="profile-metrics">
            <div className="profile-metric">
              <div className="profile-metric-head">
                <dt className="nq-label profile-metric-label">Full address</dt>
              </div>
              <dd className="profile-metric-value mono">
                <a
                  className="profile-external"
                  href={explorerForValidator}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {formatDisplayAddress(profile.address)}
                </a>
              </dd>
            </div>
            {profile.website ? (
              <div className="profile-metric">
                <div className="profile-metric-head">
                  <dt className="nq-label profile-metric-label">Website</dt>
                </div>
                <dd className="profile-metric-value">
                  <a
                    className="nq-arrow"
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {profile.website}
                  </a>
                </dd>
              </div>
            ) : null}
            {profile.description ? (
              <div className="profile-metric">
                <div className="profile-metric-head">
                  <dt className="nq-label profile-metric-label">Description</dt>
                </div>
                <dd className="profile-metric-value profile-description-inline">
                  {profile.description}
                </dd>
              </div>
            ) : null}
          </dl>

          <h3 className="profile-subheading">Registry declarations</h3>
          <p className="nq-subline profile-section-note">
            Supplied by the validators registry. Not independently verified on
            chain by Steakout.
          </p>
          <dl className="profile-metrics">
            <MetricRow
              label="Declared fee"
              definition="Fee string published in the registry for this validator; not an effective on-chain fee."
              value={formatDeclaredFee(profile.declared.fee)}
              status="registry"
              freshness={registryFreshness}
            />
            <MetricRow
              label="Min payout"
              definition="Operator-stated minimum accumulated reward before a payout is issued (Steakout research; not in the official validators API). Not a verified on-chain observation."
              value={formatDeclaredMinPayout(profile.declared.minPayout)}
              status="registry"
              freshness={registryFreshness}
            />
            <MetricRow
              label="Observed payment floor"
              definition="5th percentile of indexed outflows from the validator’s reward address (excludes self-transfers). Inferred upper bound on a fixed min threshold only if these are reward payouts—not an operator declaration. Prefer this over the absolute minimum, which can be dust."
              value={formatObservedPaymentFloor(profile.observedPaymentFloor)}
              status={
                profile.observedPaymentFloor?.status === 'inferred'
                  ? 'inferred'
                  : profile.observedPaymentFloor?.status === 'unavailable'
                    ? 'unavailable'
                    : 'insufficient'
              }
              freshness={
                profile.observedPaymentFloor?.computedAt
                  ? profile.observedPaymentFloor.computedAt
                  : registryFreshness
              }
            />
            <MetricRow
              label="Payout type"
              definition="How the registry says this validator distributes rewards (direct payout or restake)."
              value={formatPayoutType(profile.declared.payoutType)}
              status="registry"
              freshness={registryFreshness}
            />
            <MetricRow
              label="Payout schedule"
              definition="Declared cadence for reward distribution. Free-text schedules are shown raw and not graded."
              value={scheduleDisplay}
              status="registry"
              freshness={registryFreshness}
            />
            <MetricRow
              label="Stake dominance"
              definition="Share of network stake delegated to this validator, as reported by the registry."
              value={dominanceStripLabel(profile.dominanceRatio)}
              status={
                profile.dominanceRatio == null ? 'unavailable' : 'registry'
              }
              freshness={registryFreshness}
            />
            <MetricRow
              label="Total stake"
              definition="Stake amount attributed to this validator in the registry snapshot."
              value={formatNimFromLuna(profile.stakeLuna)}
              status={profile.stakeLuna == null ? 'unavailable' : 'registry'}
              freshness={registryFreshness}
            />
            <MetricRow
              label="Stakers"
              definition="Number of stakers reported for this validator when the registry provides it."
              value={
                profile.stakersCount == null
                  ? 'Unavailable'
                  : profile.stakersCount.toLocaleString()
              }
              status={profile.stakersCount == null ? 'unavailable' : 'registry'}
              freshness={registryFreshness}
            />
          </dl>

          <h3 className="profile-subheading">Reward address</h3>
          {profile.rewardAddress ? (
            <>
              <p className="profile-reward mono">
                {formatDisplayAddress(profile.rewardAddress)}
              </p>
              {rewardExplorer ? (
                <p>
                  <a
                    className="nq-arrow"
                    href={rewardExplorer}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in explorer
                  </a>
                </p>
              ) : null}
              <div className="profile-metric-foot">
                <DataStatusTag status="registry" />
                <span className="profile-freshness">{registryFreshness}</span>
              </div>
            </>
          ) : (
            <>
              <p className="nq-subline">No reward address in the registry snapshot.</p>
              <DataStatusTag status="unavailable" />
            </>
          )}

          <p className="profile-limitations-link">
            <a className="nq-arrow" href="#/learn/methodology">
              Methodology
            </a>
            {' · '}
            <a className="nq-arrow" href="#/learn/limitations">
              Limitations
            </a>
          </p>
        </div>
      </details>

      {stakeOpen ? (
        <StakeFlow
          mode={stakeFlowMode}
          validatorAddress={profile.address}
          validatorName={profile.name}
          walletAddress={wallet.address}
          nimiq={wallet.nimiq}
          positionState={stakeBalance.positionState}
          availableLuna={stakeBalance.availableLuna}
          freeBalanceLuna={stakeBalance.freeBalanceLuna}
          htlcBalanceLuna={stakeBalance.htlcBalanceLuna}
          currentDelegation={stakeBalance.currentDelegation}
          onClose={() => setStakeOpen(false)}
          onConnectedRequest={() => {
            void wallet.connect()
          }}
          onSuccess={() => {
            // Refresh local position snapshot after confirm; full position on Home.
            void loadAvailableLunaForStake().then(setStakeBalance)
          }}
        />
      ) : null}
    </div>
  )
}

function normalizeAddr(address: string | null | undefined): string {
  return (address ?? '').replace(/\s+/g, '').toUpperCase()
}

function ProfileStakeCta(props: {
  profileAddress: string
  walletConnected: boolean
  walletConnecting: boolean
  walletError: string | null
  positionState: PositionState | null
  currentDelegation: string | null
  onOpenStake: () => void
  onOpenChange: () => void
  onConnectStake: () => void
}) {
  const {
    profileAddress,
    walletConnected,
    walletConnecting,
    walletError,
    positionState,
    currentDelegation,
    onOpenStake,
    onOpenChange,
    onConnectStake,
  } = props

  const canChange =
    walletConnected &&
    (positionState === 'Active' || positionState === 'Inactive') &&
    Boolean(currentDelegation) &&
    normalizeAddr(currentDelegation) !== normalizeAddr(profileAddress)

  const sameValidator =
    Boolean(currentDelegation) &&
    normalizeAddr(currentDelegation) === normalizeAddr(profileAddress)

  return (
    <section
      className="nq-card shell-card profile-card profile-card--cta"
      aria-labelledby="profile-stake-cta"
    >
      <h2 id="profile-stake-cta" className="profile-section-title">
        {canChange ? 'Stake or change validator' : 'Stake with this validator'}
      </h2>
      <p className="nq-subline profile-section-note">
        {canChange
          ? 'Change moves your existing delegation to this validator after review. Stake more adds NIM to your current position. Steakout never holds keys.'
          : 'You will choose an amount, review the exact action and validator, then approve in your wallet. Steakout never holds keys.'}
      </p>
      {walletConnected ? (
        <div className="profile-cta-actions">
          {canChange ? (
            <button
              type="button"
              className="nq-pill-blue profile-stake-btn"
              onClick={onOpenChange}
            >
              Change to this validator
            </button>
          ) : null}
          <button
            type="button"
            className={
              canChange
                ? 'nq-pill-secondary profile-stake-btn'
                : 'nq-pill-blue profile-stake-btn'
            }
            onClick={onOpenStake}
          >
            {sameValidator ? 'Stake more' : 'Stake'}
          </button>
        </div>
      ) : (
        <>
          <p className="nq-subline profile-section-note">{STAKE_CONNECT_FIRST}</p>
          <button
            type="button"
            className="nq-pill-blue profile-stake-btn"
            disabled={walletConnecting}
            onClick={onConnectStake}
          >
            {walletConnecting ? 'Connecting…' : 'Connect to stake'}
          </button>
        </>
      )}
      {walletError ? (
        <p className="profile-stake-error" role="alert">
          {walletError}
        </p>
      ) : null}
    </section>
  )
}
