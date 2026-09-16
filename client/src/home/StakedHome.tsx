/**
 * Home — connected with a staked position (SPEC §6.1, P3-01 retire/remove).
 */

import { useEffect, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { fetchPersonalContinuity, type PersonalContinuityEnvelope } from '../api/continuity'
import Amount from '../components/Amount'
import EnvelopeStatusBanner from '../components/EnvelopeStatusBanner'
import FreshnessTag from '../components/FreshnessTag'
import PositionStateBadge from '../components/PositionStateBadge'
import type { PositionState, StakingPositionEnvelope } from '../api/position'
import { buildNimiqExplorerUrl } from '../explorer'
import StakeFlow, { type StakeFlowMode } from '../staking/StakeFlow'
import {
  RETIRE_PROGRESS_NO_TIMESTAMP,
  RETIRE_PROGRESS_RETIRING,
  RETIRE_PROGRESS_WITHDRAWABLE,
} from '../staking/copy'
import { maxRemoveLuna, maxRetireLuna } from '../staking/amounts'
import DisconnectButton from './DisconnectButton'
import TestnetFaucetButton from './TestnetFaucetButton'
import WalletBalance from './WalletBalance'
import RestakeGrowthPanel from './RestakeGrowthPanel'
import { humanizeFetchError } from '../components/humanizeError'

export interface StakedHomeProps {
  address: string
  envelope: StakingPositionEnvelope
  /** Pay provider for lifecycle txs (optional until connect). */
  nimiq?: NimiqProvider | null
  onRetry: () => void
  onDisconnect: () => void
  onPositionChanged?: () => void
}

export default function StakedHome({
  address,
  envelope,
  nimiq,
  onRetry,
  onDisconnect,
  onPositionChanged,
}: StakedHomeProps) {
  const { data, updatedAt, dataFreshness, status: envelopeStatus } = envelope
  const { staker, state, lastRewardObservation, retire } = data
  const shortAddress = shortenAddress(address)
  const actions = positionActions(state, staker)
  const monitoring = monitoringCopy(envelopeStatus, lastRewardObservation)

  const [flowMode, setFlowMode] = useState<StakeFlowMode | null>(null)
  const [continuity, setContinuity] = useState<PersonalContinuityEnvelope | null>(null)
  const [continuityLoading, setContinuityLoading] = useState(true)
  const [continuityError, setContinuityError] = useState<string | null>(null)
  const [continuityRetryToken, setContinuityRetryToken] = useState(0)

  useEffect(() => {
    let mounted = true
    setContinuityLoading(true)
    setContinuityError(null)
    void fetchPersonalContinuity()
      .then((next) => {
        if (!mounted) return
        setContinuity(next)
      })
      .catch((error: unknown) => {
        if (!mounted) return
        setContinuityError(
          humanizeFetchError(error, 'Position history is temporarily unavailable.'),
        )
      })
      .finally(() => {
        if (mounted) setContinuityLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [address, envelope.updatedAt, continuityRetryToken])

  const retirableLuna = maxRetireLuna(staker)
  const removableLuna = maxRemoveLuna(staker.retiredLuna)

  return (
    <>
      <header className="shell-header page-header">
        <div className="home-title-row home-title-row--spread">
          <div className="home-title-row">
            <h1 className="page-title">Staked</h1>
            <PositionStateBadge state={state} />
          </div>
          <DisconnectButton onDisconnect={onDisconnect} />
        </div>
        <p className="page-lede home-address" title={address}>
          {shortAddress}
        </p>
      </header>

      <EnvelopeStatusBanner
        status={envelopeStatus}
        onRetry={onRetry}
        message={
          envelopeStatus === 'partial'
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

        {(state === 'Retiring' || state === 'Withdrawable') && (
          <div className="home-retire-progress" role="region" aria-label="Retire progression">
            <p className="nq-label">Retire / remove status</p>
            <p className="home-copy">
              {state === 'Retiring'
                ? RETIRE_PROGRESS_RETIRING
                : RETIRE_PROGRESS_WITHDRAWABLE}
            </p>
            <p className="home-copy home-copy--muted">
              {retire.withdrawableAt ? (
                <>
                  Protocol release time (when reported):{' '}
                  <time className="mono" dateTime={retire.withdrawableAt}>
                    {formatWhen(retire.withdrawableAt)}
                  </time>
                </>
              ) : (
                RETIRE_PROGRESS_NO_TIMESTAMP
              )}
            </p>
            <p className="home-copy home-copy--muted">
              Observed at{' '}
              <time className="mono" dateTime={updatedAt}>
                {formatWhen(updatedAt)}
              </time>
              {dataFreshness.ageSeconds != null
                ? ` · snapshot age ${Math.max(0, Math.floor(dataFreshness.ageSeconds))}s`
                : null}
            </p>
          </div>
        )}

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

        {continuity?.data.mode === 'restake' ? (
          <RestakeGrowthPanel
            growth={continuity.data.observedPositionGrowth}
            loading={continuityLoading}
            error={continuityError}
            onRetry={() => setContinuityRetryToken((token) => token + 1)}
          />
        ) : continuityError ? (
          <section className="home-continuity-error" role="alert" aria-label="Personal continuity error">
            <p className="nq-label">Personal monitoring</p>
            <p className="home-copy home-copy--muted">{continuityError}</p>
            <button
              type="button"
              className="nq-ghost-btn"
              onClick={() => setContinuityRetryToken((token) => token + 1)}
            >
              Retry personal monitoring
            </button>
          </section>
        ) : null}

        <div className="home-actions">
          {actions.primary.kind === 'link' ? (
            <a className="nq-pill-blue nq-pill-lg home-cta" href={actions.primary.href}>
              {actions.primary.label}
            </a>
          ) : (
            <button
              type="button"
              className={
                actions.primary.destructive
                  ? 'nq-pill-red nq-pill-lg home-cta'
                  : 'nq-pill-blue nq-pill-lg home-cta'
              }
              onClick={() => {
                if (actions.primary.kind === 'flow') setFlowMode(actions.primary.mode)
              }}
            >
              {actions.primary.label}
            </button>
          )}

          {actions.secondary.map((action) =>
            action.kind === 'link' ? (
              <a
                key={action.label}
                className="nq-pill-secondary home-cta"
                href={action.href}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                className={
                  action.destructive
                    ? 'nq-pill-secondary home-cta home-cta--careful'
                    : 'nq-pill-secondary home-cta'
                }
                onClick={() => setFlowMode(action.mode)}
              >
                {action.label}
              </button>
            ),
          )}

          <TestnetFaucetButton address={address} onFunded={onRetry} />
        </div>

        <div className="home-liquid-wallet" aria-labelledby="home-liquid-title">
          <h3 id="home-liquid-title" className="visually-hidden">
            Unstaked wallet balance
          </h3>
          <WalletBalance
            accountBalanceLuna={data.accountBalanceLuna}
            htlcBalanceLuna={data.htlcBalanceLuna ?? 0}
            walletBalanceLuna={data.walletBalanceLuna ?? data.accountBalanceLuna}
            htlcCount={data.htlcCount ?? 0}
            updatedAt={updatedAt}
            ageSeconds={dataFreshness.ageSeconds}
          />
        </div>

        {retirableLuna > 0 && state !== 'Withdrawable' && state !== 'Pending' ? (
          <p className="home-copy home-copy--muted home-lifecycle-hint">
            Retire moves active/inactive stake into a waiting period. It does not return NIM
            immediately.
          </p>
        ) : null}
        {removableLuna > 0 && state === 'Withdrawable' ? (
          <p className="home-copy home-copy--muted home-lifecycle-hint">
            Remove returns retired stake only. Active stake must be retired first.
          </p>
        ) : null}
      </section>

      {flowMode ? (
        <StakeFlow
          mode={flowMode}
          validatorAddress={staker.delegation ?? ''}
          validatorName={staker.validatorName}
          walletAddress={address}
          nimiq={nimiq}
          positionState={state}
          availableLuna={
            data.walletBalanceLuna ?? data.accountBalanceLuna
          }
          freeBalanceLuna={data.accountBalanceLuna}
          htlcBalanceLuna={data.htlcBalanceLuna ?? 0}
          currentDelegation={staker.delegation}
          stakerBalances={{
            activeLuna: staker.activeLuna,
            inactiveLuna: staker.inactiveLuna,
            retiredLuna: staker.retiredLuna,
          }}
          onClose={() => setFlowMode(null)}
          onSuccess={() => {
            setFlowMode(null)
            onPositionChanged?.()
          }}
        />
      ) : null}
    </>
  )
}

type FlowAction = {
  kind: 'flow'
  label: string
  mode: StakeFlowMode
  destructive?: boolean
}

type LinkAction = {
  kind: 'link'
  label: string
  href: string
}

type Action = FlowAction | LinkAction

function positionActions(
  state: PositionState,
  staker: StakingPositionEnvelope['data']['staker'],
): { primary: Action; secondary: Action[] } {
  const changeHref = '#/validators'
  const stakeMoreHref = staker.delegation?.trim()
    ? `#/validators/${encodeURIComponent(staker.delegation)}?stake=1`
    : '#/validators'
  const canRetire =
    (state === 'Active' || state === 'Inactive' || state === 'Retiring') &&
    maxRetireLuna(staker) > 0
  const canRemove = state === 'Withdrawable' && maxRemoveLuna(staker.retiredLuna) > 0

  switch (state) {
    case 'Pending':
      return {
        primary: { kind: 'link', label: 'View activity', href: '#/activity' },
        secondary: [{ kind: 'link', label: 'Explore validators', href: '#/validators' }],
      }
    case 'Inactive':
      return {
        primary: {
          kind: 'link',
          label: 'Stake more',
          href: stakeMoreHref,
        },
        secondary: [
          { kind: 'link', label: 'Change validator', href: changeHref },
          ...(canRetire
            ? [
                {
                  kind: 'flow' as const,
                  label: 'Retire stake',
                  mode: 'retire' as const,
                  destructive: true,
                },
              ]
            : []),
        ],
      }
    case 'Retiring':
      return {
        primary: { kind: 'link', label: 'View activity', href: '#/activity' },
        secondary: [
          ...(canRetire
            ? [
                {
                  kind: 'flow' as const,
                  label: 'Retire more',
                  mode: 'retire' as const,
                  destructive: true,
                },
              ]
            : []),
          { kind: 'link', label: 'Explore validators', href: '#/validators' },
        ],
      }
    case 'Withdrawable':
      return {
        primary: canRemove
          ? {
              kind: 'flow',
              label: 'Remove stake',
              mode: 'remove',
              destructive: true,
            }
          : { kind: 'link', label: 'View activity', href: '#/activity' },
        secondary: [
          { kind: 'link', label: 'Explore validators', href: '#/validators' },
        ],
      }
    case 'Active':
    default:
      return {
        primary: {
          kind: 'link',
          label: 'Stake more',
          href: stakeMoreHref,
        },
        secondary: [
          { kind: 'link', label: 'Change validator', href: changeHref },
          ...(canRetire
            ? [
                {
                  kind: 'flow' as const,
                  label: 'Retire stake',
                  mode: 'retire' as const,
                  destructive: true,
                },
              ]
            : []),
        ],
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
