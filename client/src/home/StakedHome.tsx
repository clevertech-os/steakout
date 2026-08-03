/**
 * Home — connected with a staked position (SPEC §6.1).
 */

import Amount from '../components/Amount'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import FreshnessTag from '../components/FreshnessTag'
import PositionStateBadge from '../components/PositionStateBadge'
import type { PositionState, StakingPositionEnvelope } from '../api/position'
import { buildNimiqExplorerUrl } from '../explorer'

export interface StakedHomeProps {
  address: string
  envelope: StakingPositionEnvelope
  onRetry: () => void
  onDisconnect: () => void
}

export default function StakedHome({
  address,
  envelope,
  onRetry,
  onDisconnect,
}: StakedHomeProps) {
  const { data, updatedAt, dataFreshness, status: envelopeStatus } = envelope
  const { staker, state, lastRewardObservation } = data
  const shortAddress = shortenAddress(address)
  const primaryCta = primaryAction(state, staker.delegation)
  const monitoring = monitoringCopy(envelopeStatus, lastRewardObservation)

  return (
    <>
      <header className="shell-header home-header">
        <div className="home-title-row">
          <h1 className="home-title">Staked</h1>
          <PositionStateBadge state={state} />
        </div>
        <p className="home-lede home-address" title={address}>
          {shortAddress}
        </p>
      </header>

      <EnvelopeStatusBanner
        status={envelopeStatus}
        onRetry={onRetry}
        message={
          envelopeStatus === 'stale'
            ? 'Position snapshot may be outdated. Showing the last known on-chain read.'
            : envelopeStatus === 'partial'
              ? 'Position data is partial. Some fields may be incomplete.'
              : envelopeStatus === 'unavailable'
                ? 'Some position data is unavailable from the network right now.'
                : undefined
        }
      />

      <section className="nq-card nq-card-lg shell-card home-card" aria-labelledby="home-staked-title">
        <p className="card-kicker">Total staked</p>
        <h2 id="home-staked-title" className="visually-hidden">
          Staked totals
        </h2>
        <p className="home-amount-row">
          <Amount luna={staker.totalLuna} size="lg" label="Total staked" />
        </p>
        <FreshnessTag updatedAt={updatedAt} ageSeconds={dataFreshness.ageSeconds} />

        <dl className="home-stat-grid">
          <div className="home-stat">
            <dt className="nq-label">Active</dt>
            <dd>
              <Amount luna={staker.activeLuna} label="Active" />
            </dd>
          </div>
          <div className="home-stat">
            <dt className="nq-label">Inactive</dt>
            <dd>
              <Amount luna={staker.inactiveLuna} label="Inactive" />
            </dd>
          </div>
          <div className="home-stat">
            <dt className="nq-label">Retired</dt>
            <dd>
              <Amount luna={staker.retiredLuna} label="Retired" />
            </dd>
          </div>
        </dl>

        <div className="home-validator">
          <p className="nq-label">Delegated validator</p>
          {staker.delegation ? (
            <>
              <p className="home-validator-name">
                {staker.validatorName?.trim() || 'Unlisted validator'}
              </p>
              <p className="home-address home-validator-addr" title={staker.delegation}>
                {shortenAddress(staker.delegation)}
              </p>
              <a className="home-method-link" href={`#/validators/${encodeURIComponent(staker.delegation)}`}>
                View record →
              </a>
            </>
          ) : (
            <p className="nq-subline home-copy">No delegation observed on this position.</p>
          )}
        </div>

        <div className="home-reward">
          <p className="nq-label">Last reward observation</p>
          {lastRewardObservation ? (
            <>
              <p className="home-copy">
                {lastRewardObservation.type === 'direct-payout'
                  ? 'Direct payout observed'
                  : 'Balance change observed'}
                {' · '}
                <time dateTime={lastRewardObservation.at}>
                  {formatWhen(lastRewardObservation.at)}
                </time>
              </p>
              {lastRewardObservation.txHash ? (
                <a
                  className="home-method-link"
                  href={buildNimiqExplorerUrl(lastRewardObservation.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View transaction →
                </a>
              ) : null}
              <FreshnessTag updatedAt={lastRewardObservation.at} />
            </>
          ) : (
            <p className="nq-subline home-copy">
              Insufficient data. No personal reward observation yet.
            </p>
          )}
        </div>

        <div className="home-monitoring">
          <p className="nq-label">Personal monitoring</p>
          <p className="home-copy">{monitoring}</p>
        </div>

        <div className="home-actions">
          <a className="nq-pill-blue nq-pill-lg home-cta" href={primaryCta.href}>
            {primaryCta.label}
          </a>
          {primaryCta.secondary ? (
            <a className="nq-pill-secondary home-cta" href={primaryCta.secondary.href}>
              {primaryCta.secondary.label}
            </a>
          ) : null}
          <button type="button" className="nq-ghost-btn home-cta" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </section>
    </>
  )
}

function primaryAction(
  state: PositionState,
  delegation: string | null | undefined,
): {
  label: string
  href: string
  secondary?: { label: string; href: string }
} {
  switch (state) {
    case 'Pending':
      return {
        label: 'View activity',
        href: '#/activity',
        secondary: { label: 'Explore validators', href: '#/validators' },
      }
    case 'Inactive':
      return {
        label: 'View position',
        href: '#/activity',
        secondary: { label: 'Choose a validator', href: '#/validators' },
      }
    case 'Retiring':
      return {
        label: 'View position',
        href: '#/activity',
        secondary: { label: 'Explore validators', href: '#/validators' },
      }
    case 'Withdrawable':
      return {
        label: 'View position',
        href: '#/activity',
        secondary: { label: 'Explore validators', href: '#/validators' },
      }
    case 'Active':
    default:
      return {
        label: 'Stake more',
        href:
          delegation?.trim()
            ? `#/validators/${encodeURIComponent(delegation)}?stake=1`
            : '#/validators',
        secondary: { label: 'Change validator', href: '#/validators' },
      }
  }
}

function monitoringCopy(
  envelopeStatus: StakingPositionEnvelope['status'],
  lastReward: StakingPositionEnvelope['data']['lastRewardObservation'],
): string {
  if (envelopeStatus === 'unavailable') {
    return 'Monitoring status unavailable while chain data cannot be read.'
  }
  if (envelopeStatus === 'stale') {
    return 'Watching this position from a stale snapshot. Reconnect or refresh when the network is reachable.'
  }
  if (!lastReward) {
    return 'Watching this position. No personal reward events observed yet. Insufficient data for continuity claims.'
  }
  return 'Watching this position. Observations are limited to confirmed chain data; gaps never prove wrongdoing.'
}

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms))
}

function shortenAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 16) return compact
  return `${compact.slice(0, 8)}…${compact.slice(-6)}`
}
