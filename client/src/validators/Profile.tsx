/**
 * Validator profile — summary + evidence layers (P1-11 / P2-08 / P2-16 / SPEC §6.3).
 * Public, no wallet required. Stake CTA opens P1-12 StakeFlow when connected.
 *
 * Official Nimiq Trust Score is always shown as the official score,
 * never blended with Steakout observation status (invariant #6).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  formatDisplayAddress,
  isValidNimiqAddress,
  shortAddress,
} from '../addresses'
import { walletAuthApi } from '../api/walletAuth'
import type { PositionState } from '../api/position'
import DataStatusTag from '../components/DataStatusTag'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import { humanizeFetchError } from '../components/humanizeError'
import type { ObservationStatus } from '../components/StatusChip'
import { buildNimiqAddressExplorerUrl } from '../explorer'
import { hashWantsChange, hashWantsStake } from '../routes'
import StakeFlow, {
  loadAvailableLunaForStake,
  type StakeFlowMode,
} from '../staking/StakeFlow'
import { STAKE_CONNECT_FIRST } from '../staking/copy'
import { useWallet } from '../wallet/useWallet'
import Evidence from './Evidence'
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
  }
  registryUpdatedAt: string
  website: string | null
  description: string | null
  rewardAddress: string | null
  rewardExplorerUrl: string | null
  scoreComponents: null
}

interface ApiOk {
  updatedAt: string
  source: string
  status: string
  dataFreshness: { ageSeconds: number; historyDepthDays?: number }
  data: ValidatorProfileData
}

interface ApiErr {
  error: { code: string; message: string }
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'not-found'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; envelope: ApiOk }

const PAYOUT_TYPE_LABEL: Record<DeclaredPayoutType, string> = {
  direct: 'Direct payout',
  restake: 'Restake',
  unknown: 'Not declared',
}

function formatNimFromLuna(luna: number | null): string {
  if (luna == null || !Number.isFinite(luna)) return 'Unavailable'
  const nim = luna / LUNA_PER_NIM
  return `${nim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`
}

function formatDominance(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return 'Unavailable'
  // Compact; no fake precision (STYLING §6).
  const pct = ratio * 100
  if (pct < 0.01 && pct > 0) return '< 0.01%'
  return `${pct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

function formatOfficialScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return 'Insufficient data'
  return score.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
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
    positionState: PositionState | null
    currentDelegation: string | null
  }>({ availableLuna: null, positionState: null, currentDelegation: null })

  const wallet = useWallet({ auth: walletAuthApi })

  const retry = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  const openStakeFlow = useCallback((mode: StakeFlowMode = 'stake') => {
    setStakeFlowMode(mode)
    setStakeOpen(true)
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

    setState({ kind: 'loading' })

    const path = `/api/validators/${encodeURIComponent(rawAddress.trim())}`

    ;(async () => {
      try {
        const res = await fetch(path)
        let body: ApiOk | ApiErr | null = null
        try {
          body = (await res.json()) as ApiOk | ApiErr
        } catch {
          body = null
        }

        if (cancelled) return

        if (!res.ok || !body || 'error' in body) {
          const err = body as ApiErr | null
          const code = err?.error?.code
          const message =
            err?.error?.message ?? 'Could not load this validator profile.'
          if (res.status === 404 || code === 'VALIDATOR_NOT_FOUND') {
            setState({ kind: 'not-found', message })
            return
          }
          setState({ kind: 'error', message })
          return
        }

        setState({ kind: 'ok', envelope: body as ApiOk })
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: humanizeFetchError(
              err,
              'Could not load this validator profile. Try again later.',
            ),
          })
        }
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
        <header className="shell-header profile-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="profile-title">Loading…</h1>
        </header>
        <section
          className="nq-card profile-card"
          aria-busy="true"
          aria-labelledby="profile-loading-status"
        >
          <p className="profile-status" id="profile-loading-status" role="status">
            Loading validator profile…
          </p>
          <div className="profile-skeleton" aria-hidden="true">
            <span className="profile-skeleton-line profile-skeleton-line--wide" />
            <span className="profile-skeleton-line" />
            <span className="profile-skeleton-line profile-skeleton-line--mid" />
            <span className="profile-skeleton-line profile-skeleton-line--narrow" />
          </div>
        </section>
      </div>
    )
  }

  if (state.kind === 'invalid') {
    return (
      <div className="profile">
        <header className="shell-header profile-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="profile-title">Invalid address</h1>
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
        <header className="shell-header profile-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="profile-title">Not found</h1>
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
        <header className="shell-header profile-header">
          <a className="profile-back nq-arrow-back" href="#/validators">
            Validators
          </a>
          <h1 className="profile-title">Unavailable</h1>
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
    envelope.updatedAt || profile.registryUpdatedAt,
  )
  const displayName = profile.name?.trim() || shortAddress(profile.address)
  const explorerForValidator = buildNimiqAddressExplorerUrl(profile.address)
  const rewardExplorer =
    profile.rewardExplorerUrl ??
    (profile.rewardAddress
      ? buildNimiqAddressExplorerUrl(profile.rewardAddress)
      : null)

  const scoreIsPresent =
    profile.officialScore != null && Number.isFinite(profile.officialScore)

  return (
    <div className="profile">
      <EnvelopeStatusBanner
        status={envelope.status}
        onRetry={retry}
        message={
          envelope.status === 'stale'
            ? 'Profile snapshot may be outdated. Registry and observation fields reflect the last successful sync.'
            : undefined
        }
      />
      <header className="shell-header profile-header">
        <a className="profile-back nq-arrow-back" href="#/validators">
          Validators
        </a>
        <p className="eyebrow">
          {profile.isListed ? 'Listed validator' : 'Observable validator'}
        </p>
        <h1 className="profile-title">{displayName}</h1>
        <p className="profile-address mono">
          <a
            className="profile-external"
            href={explorerForValidator}
            target="_blank"
            rel="noopener noreferrer"
          >
            {formatDisplayAddress(profile.address)}
          </a>
        </p>
        {profile.description ? (
          <p className="profile-description">{profile.description}</p>
        ) : null}
        {profile.website ? (
          <p className="profile-website">
            <a
              className="nq-arrow"
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
            >
              Website
            </a>
          </p>
        ) : null}
        <div className="profile-share">
          <button
            type="button"
            className="nq-pill-secondary profile-share-btn"
            onClick={() => void handleShare(profile.address, displayName)}
          >
            Share profile
          </button>
          {shareFeedback ? (
            <span className="profile-share-feedback" role="status">
              {shareFeedback}
            </span>
          ) : null}
        </div>
      </header>

      {/* Official score — always distinct from Steakout observations (P2-09). */}
      <section
        className="nq-card profile-card profile-card--official"
        aria-labelledby="profile-official-score"
      >
        <p className="card-kicker">Official score</p>
        <h2 id="profile-official-score" className="profile-section-title">
          Nimiq Validator Trust Score
        </h2>
        <p className="profile-score-value mono" data-testid="official-score">
          {formatOfficialScore(profile.officialScore)}
        </p>
        <p className="nq-subline profile-section-note">
          Official block-production score from the public Nimiq validators
          registry. Steakout never replaces or blends it with payout observation
          status.
        </p>
        <div className="profile-metric-foot">
          <DataStatusTag status={scoreIsPresent ? 'registry' : 'insufficient'} />
          <span className="profile-freshness">{registryFreshness}</span>
        </div>
        <p className="profile-limitations-link">
          <a className="nq-arrow" href="#/learn/limitations">
            Limitations
          </a>
        </p>
      </section>

      {/* Registry declarations — visually separated from observations */}
      <section
        className="nq-card profile-card profile-card--declared"
        aria-labelledby="profile-declared"
      >
        <p className="card-kicker">Registry declarations</p>
        <h2 id="profile-declared" className="profile-section-title">
          Declared policy
        </h2>
        <p className="nq-subline profile-section-note">
          Supplied by the validators registry. Not independently verified on
          chain by Steakout.
        </p>
        <dl className="profile-metrics">
          <MetricRow
            label="Declared fee"
            definition="Fee string published in the registry for this validator; not an effective on-chain fee."
            value={profile.declared.fee ?? 'Not declared'}
            status="registry"
            freshness={registryFreshness}
          />
          <MetricRow
            label="Payout type"
            definition="How the registry says this validator distributes rewards (direct payout or restake)."
            value={PAYOUT_TYPE_LABEL[profile.declared.payoutType] ?? 'Not declared'}
            status="registry"
            freshness={registryFreshness}
          />
          <MetricRow
            label="Payout schedule"
            definition="Declared cadence for reward distribution. Free-text schedules are shown raw and not graded."
            value={
              profile.declared.payoutSchedule ??
              (profile.declared.scheduleNormalized
                ? `Every ${profile.declared.scheduleNormalized.everyHours} hours`
                : 'Not declared')
            }
            status="registry"
            freshness={registryFreshness}
          />
          <MetricRow
            label="Stake dominance"
            definition="Share of network stake delegated to this validator, as reported by the registry."
            value={formatDominance(profile.dominanceRatio)}
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
      </section>

      {/* Steakout observation + payout-run evidence (P2-08); captioned apart from official score (P2-09). */}
      <Evidence
        address={profile.address}
        profileStatus={profile.observation.status}
        profileHistoryDepthDays={profile.observation.historyDepthDays}
        profileLastObservedAt={profile.observation.lastObservedAt}
      />

      {/* Reward address */}
      <section
        className="nq-card profile-card"
        aria-labelledby="profile-reward"
      >
        <p className="card-kicker">On-chain</p>
        <h2 id="profile-reward" className="profile-section-title">
          Reward address
        </h2>
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
      </section>

      {/* Stake / change-validator CTA — ReviewSheet before provider (P1-12 / P2-11). */}
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

      {stakeOpen ? (
        <StakeFlow
          mode={stakeFlowMode}
          validatorAddress={profile.address}
          validatorName={profile.name}
          walletAddress={wallet.address}
          nimiq={wallet.nimiq}
          positionState={stakeBalance.positionState}
          availableLuna={stakeBalance.availableLuna}
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
      className="nq-card profile-card profile-card--cta"
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
