/**
 * Validator directory card (P1-10 / P2-09).
 * Official score captioned distinctly from Steakout observation StatusChip.
 * Clickable → `#/validators/:address`.
 */
import { normalizeAddress, shortAddress } from '../addresses'
import StatusChip from '../components/StatusChip'
import type { ValidatorListItem } from './api'
import {
  formatDeclaredFee,
  formatDominance,
  formatOfficialScore,
  formatPayoutType,
  formatStakeNim,
  formatStakersCount,
  validatorInitials,
} from './format'
import './ValidatorCard.css'

export interface ValidatorCardProps {
  validator: ValidatorListItem
}

export default function ValidatorCard({ validator }: ValidatorCardProps) {
  const compact = normalizeAddress(validator.address)
  const profileHref = `#/validators/${compact}`
  const displayName = validator.name?.trim() || shortAddress(validator.address)
  const scoreLabel = formatOfficialScore(validator.officialScore)
  const stakeLabel = formatStakeNim(validator.stakeLuna)
  const dominanceLabel = formatDominance(validator.dominanceRatio)
  const stakersLabel = formatStakersCount(validator.stakersCount)
  const feeLabel = formatDeclaredFee(validator.declared.fee)
  const payoutLabel = formatPayoutType(validator.declared.payoutType)
  const scheduleLabel = validator.declared.payoutSchedule?.trim() || null
  const initials = validatorInitials(validator.name, validator.address)
  const scoreIsPresent = scoreLabel !== 'Insufficient data'

  return (
    <a
      className="validator-card nq-card shell-card nq-hoverable nq-hoverable-cta nq-focusable"
      href={profileHref}
      aria-label={`View record for ${displayName}`}
    >
      <div className="validator-card-top">
        <div className="validator-card-identity">
          {validator.logoUrl ? (
            <img
              className="validator-card-logo"
              src={validator.logoUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                // Hide broken logos so the initials fallback can show.
                e.currentTarget.style.display = 'none'
                const fallback = e.currentTarget.nextElementSibling
                if (fallback instanceof HTMLElement) fallback.hidden = false
              }}
            />
          ) : null}
          <span
            className="validator-card-initials"
            aria-hidden="true"
            hidden={Boolean(validator.logoUrl)}
          >
            {initials}
          </span>
          <div className="validator-card-titles">
            <h2 className="validator-card-name">{displayName}</h2>
            <p className="validator-card-address">{shortAddress(validator.address)}</p>
          </div>
        </div>
        <div className="validator-card-badges">
          {!validator.isListed ? (
            <span className="validator-chip validator-chip--unlisted">Unlisted</span>
          ) : (
            <span className="validator-chip validator-chip--listed">Listed</span>
          )}
        </div>
      </div>

      <dl className="validator-card-metrics">
        <div className="validator-card-metric validator-card-metric--official">
          <dt className="nq-label">Nimiq Validator Trust Score</dt>
          <dd
            className={
              scoreIsPresent
                ? 'validator-card-value'
                : 'validator-card-value validator-card-value--muted'
            }
            title="Official Nimiq Validator Trust Score from the public registry. Steakout never replaces or blends it with observation status."
          >
            {scoreLabel}
          </dd>
        </div>
        <div className="validator-card-metric">
          <dt className="nq-label">Stake</dt>
          <dd
            className={
              stakeLabel === 'Insufficient data'
                ? 'validator-card-value validator-card-value--muted'
                : 'validator-card-value validator-card-value--mono'
            }
          >
            {stakeLabel}
          </dd>
        </div>
        <div className="validator-card-metric">
          <dt className="nq-label">Dominance</dt>
          <dd
            className={
              dominanceLabel === 'Insufficient data'
                ? 'validator-card-value validator-card-value--muted'
                : 'validator-card-value validator-card-value--mono'
            }
          >
            {dominanceLabel}
          </dd>
        </div>
        <div className="validator-card-metric">
          <dt className="nq-label">Stakers</dt>
          <dd
            className={
              stakersLabel === 'Insufficient data'
                ? 'validator-card-value validator-card-value--muted'
                : 'validator-card-value validator-card-value--mono'
            }
          >
            {stakersLabel}
          </dd>
        </div>
      </dl>

      <div className="validator-card-declared">
        <p className="nq-label">Registry declaration</p>
        <p className="validator-card-declared-line">
          <span>{payoutLabel}</span>
          <span className="validator-card-sep" aria-hidden="true">
            ·
          </span>
          <span>Fee {feeLabel}</span>
        </p>
        {scheduleLabel ? (
          <p className="validator-card-schedule">{scheduleLabel}</p>
        ) : (
          <p className="validator-card-schedule validator-card-value--muted">
            Schedule: Insufficient data
          </p>
        )}
      </div>

      <div className="validator-card-footer">
        <div className="validator-card-observation">
          <span className="nq-label validator-card-observation-caption">
            Steakout observation
          </span>
          {/* Live status from list API (schedule-adherence when indexed; else insufficient-data). */}
          <StatusChip status={validator.observation.status} />
          {validator.observation.historyDepthDays > 0 ? (
            <span className="validator-card-depth">
              {Math.floor(validator.observation.historyDepthDays)}d history
            </span>
          ) : null}
        </div>
        <span className="validator-card-cta nq-arrow">View record</span>
      </div>
    </a>
  )
}
