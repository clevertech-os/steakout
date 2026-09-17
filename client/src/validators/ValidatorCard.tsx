/**
 * Validator directory card (P1-10 / P2-09).
 * Official score captioned distinctly from Steakout observation StatusChip.
 * Clickable → `#/validators/:address`.
 * Directory only shows listed validators; unlisted are never rendered here.
 */
import type { KeyboardEvent, MouseEvent } from 'react'
import { normalizeAddress, shortAddress } from '../addresses'
import StatusChip from '../components/StatusChip'
import { prefetchValidatorProfile, type ValidatorListItem } from './api'
import {
  formatDeclaredFee,
  formatDeclaredMinPayout,
  formatDominance,
  formatMinPayoutTooltip,
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

/** http(s) only — reject javascript: / relative junk from registry. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

/** Use the validator website's conventional favicon as a logo fallback. */
function faviconUrlFromWebsite(website: string | null | undefined): string | null {
  const safeWebsite = safeHttpUrl(website)
  if (!safeWebsite) return null
  return new URL('/favicon.ico', safeWebsite).href
}

function ExternalLinkIcon() {
  return (
    <svg
      className="validator-card-website-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6.5 3.5H3.5A1.5 1.5 0 0 0 2 5v7.5A1.5 1.5 0 0 0 3.5 14H11a1.5 1.5 0 0 0 1.5-1.5V9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2H14v4.5M14 2 7.5 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function ValidatorCard({ validator }: ValidatorCardProps) {
  const compact = normalizeAddress(validator.address)
  const profileHref = `#/validators/${compact}`
  const displayName = validator.name?.trim() || shortAddress(validator.address)
  const websiteUrl = safeHttpUrl(validator.website)
  const logoUrl = validator.logoUrl || faviconUrlFromWebsite(validator.website)
  const scoreLabel = formatOfficialScore(validator.officialScore)
  const stakeLabel = formatStakeNim(validator.stakeLuna)
  const dominanceLabel = formatDominance(validator.dominanceRatio)
  const stakersLabel = formatStakersCount(validator.stakersCount)
  const feeLabel = formatDeclaredFee(validator.declared.fee)
  const minPayoutLabel = formatDeclaredMinPayout(validator.declared.minPayout)
  const minPayoutTitle = formatMinPayoutTooltip(
    validator.declared.minPayout,
    validator.observedPaymentFloor,
  )
  const payoutLabel = formatPayoutType(validator.declared.payoutType)
  const scheduleLabel = validator.declared.payoutSchedule?.trim() || null
  const initials = validatorInitials(validator.name, validator.address)
  const scoreIsPresent = scoreLabel !== 'Insufficient data'
  const minPayoutMuted = minPayoutLabel === 'Insufficient data'

  const openWebsite = (e: MouseEvent | KeyboardEvent) => {
    if (!websiteUrl) return
    e.preventDefault()
    e.stopPropagation()
    window.open(websiteUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <a
      className="validator-card nq-card shell-card nq-hoverable nq-hoverable-cta nq-focusable"
      href={profileHref}
      aria-label={`View record for ${displayName}`}
      onPointerEnter={() => prefetchValidatorProfile(validator.address)}
      onFocus={() => prefetchValidatorProfile(validator.address)}
    >
      <div className="validator-card-top">
        <div className="validator-card-identity">
          {logoUrl ? (
            <img
              className="validator-card-logo"
              src={logoUrl}
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
            hidden={Boolean(logoUrl)}
          >
            {initials}
          </span>
          <div className="validator-card-titles">
            <div className="validator-card-name-row">
              <h2 className="validator-card-name">{displayName}</h2>
              {websiteUrl ? (
                <span
                  className="validator-card-website"
                  role="link"
                  tabIndex={0}
                  title={websiteUrl}
                  aria-label={`Open ${displayName} website in a new tab`}
                  onClick={openWebsite}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openWebsite(e)
                  }}
                >
                  <ExternalLinkIcon />
                </span>
              ) : null}
            </div>
            <p className="validator-card-address">{shortAddress(validator.address)}</p>
          </div>
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
          <span className="validator-card-sep" aria-hidden="true">
            ·
          </span>
          <span
            className={
              minPayoutMuted ? 'validator-card-value--muted' : undefined
            }
            title={minPayoutTitle}
          >
            Min payout {minPayoutLabel}
          </span>
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
          <StatusChip
            status={validator.observation.status}
            definition={
              validator.observation.status === 'insufficient-data' &&
              validator.observation.historyDepthDays >= 7
                ? 'Declared schedule cannot be normalized for adherence grading, or not enough expected windows; raw observations may still be available.'
                : undefined
            }
          />
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
