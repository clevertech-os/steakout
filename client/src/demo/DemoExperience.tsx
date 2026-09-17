import { useEffect, useState } from 'react'
import DataStatusTag, { type DataStatus } from '../components/DataStatusTag'
import PositionStateBadge from '../components/PositionStateBadge'
import StatusChip from '../components/StatusChip'
import { normalizeAddress, shortAddress } from '../addresses'
import {
  fetchValidators,
  type ValidatorListItem,
} from '../validators/api'
import { validatorInitials } from '../validators/format'
import '../validators/Directory.css'
import '../validators/ValidatorCard.css'
import './DemoExperience.css'

type DemoTab = 'position' | 'validator' | 'activity'

interface DemoMetricProps {
  label: string
  value: string
  status: DataStatus
  definition: string
}

function DemoMetric({ label, value, status, definition }: DemoMetricProps) {
  return (
    <div className="demo-metric">
      <dt className="nq-label">{label}</dt>
      <dd>{value}</dd>
      <div className="demo-metric-meta">
        <DataStatusTag status={status} />
      </div>
      <p className="demo-metric-definition">{definition}</p>
    </div>
  )
}

function DemoTabs({ active, onChange }: { active: DemoTab; onChange: (tab: DemoTab) => void }) {
  const tabs: Array<{ id: DemoTab; label: string }> = [
    { id: 'position', label: 'Position' },
    { id: 'validator', label: 'Validator record' },
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <div className="demo-tabs" role="tablist" aria-label="Demo views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === active ? 'demo-tab is-active' : 'demo-tab'}
          id={`demo-tab-${tab.id}`}
          role="tab"
          aria-selected={tab.id === active}
          aria-controls={`demo-panel-${tab.id}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function PositionPanel({
  onReview,
  onViewValidator,
}: {
  onReview: () => void
  onViewValidator: () => void
}) {
  return (
    <section
      id="demo-panel-position"
      className="demo-panel"
      role="tabpanel"
      aria-labelledby="demo-tab-position"
    >
      <div className="demo-panel-heading">
        <div>
          <p className="card-kicker">Connected position</p>
          <h2>Staked</h2>
          <p className="demo-address">Demo wallet · NQ…4A91</p>
        </div>
        <PositionStateBadge state="Active" />
      </div>

      <div className="demo-total">
        <p className="nq-label">Total staked</p>
        <p className="demo-total-value">50,000.00 <span>NIM</span></p>
        <p className="demo-freshness">As of 17 Sep 2026</p>
      </div>

      <dl className="demo-stat-grid">
        <DemoMetric
          label="Active"
          value="50,000.00 NIM"
          status="verified"
          definition="Active balance reported by the position snapshot."
        />
        <DemoMetric
          label="Inactive"
          value="0.00 NIM"
          status="verified"
          definition="Inactive balance reported by the position snapshot."
        />
        <DemoMetric
          label="Retired"
          value="0.00 NIM"
          status="verified"
          definition="Retired balance reported by the position snapshot."
        />
      </dl>

      <div className="demo-detail-row">
        <div>
          <p className="nq-label">Delegated validator</p>
          <p className="demo-detail-value">Northstar Nimiq</p>
          <p className="demo-address">NQ…9F2C</p>
        </div>
        <button type="button" className="demo-inline-link demo-inline-button" onClick={onViewValidator}>
          View record
        </button>
      </div>

      <div className="demo-detail-row">
        <div>
          <p className="nq-label">Last reward observation</p>
          <p className="demo-detail-value">Direct payout observed</p>
          <p className="demo-muted">2 hours ago</p>
        </div>
        <StatusChip status="on-schedule" />
      </div>

      <div className="demo-actions">
        <button type="button" className="nq-pill-blue nq-pill-lg" onClick={onReview}>
          Preview stake review
        </button>
        <a className="nq-pill-secondary" href="/#/validators">
          Browse public records
        </a>
      </div>
    </section>
  )
}

function DemoDirectoryPreview() {
  const [items, setItems] = useState<ValidatorListItem[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchValidators({ listed: true, sort: 'recommended', signal: controller.signal })
      .then((envelope) => {
        setItems(envelope.data.validators.slice(0, 6))
      })
      .catch(() => {
        setItems([])
      })
    return () => controller.abort()
  }, [])

  if (!items || items.length === 0) return null

  return (
    <div className="demo-directory">
      <p className="nq-label">Live listed validators</p>
      <ul className="directory-list directory-list--rows shell-card">
        {items.map((validator) => {
          const compact = normalizeAddress(validator.address)
          const displayName = validator.name?.trim() || shortAddress(validator.address)
          const logoUrl = validator.logoUrl
          const initials = validatorInitials(validator.name, validator.address)
          return (
            <li key={compact}>
              <a
                className="validator-card validator-card--row nq-focusable"
                href={`/#/validators/${compact}`}
                aria-label={`View record for ${displayName}`}
              >
                <div className="validator-card-top">
                  <div className="validator-card-identity">
                    {logoUrl ? (
                      <img
                        className="validator-card-logo"
                        src={logoUrl}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
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
                        <h3 className="validator-card-name">{displayName}</h3>
                      </div>
                    </div>
                  </div>
                  <div className="validator-card-row-end">
                    <StatusChip status={validator.observation.status} compact />
                    <span className="validator-card-cta nq-arrow">
                      <span className="visually-hidden">View record</span>
                    </span>
                  </div>
                </div>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ValidatorPanel() {
  return (
    <section
      id="demo-panel-validator"
      className="demo-panel"
      role="tabpanel"
      aria-labelledby="demo-tab-validator"
    >
      <div className="demo-panel-heading">
        <div>
          <p className="card-kicker">Validator record</p>
          <h2>Northstar Nimiq</h2>
          <p className="demo-address">NQ…9F2C · Direct payout</p>
        </div>
        <StatusChip status="on-schedule" alwaysShowDefinition />
      </div>

      <p className="demo-panel-copy">
        The official score describes validator performance. Steakout observations describe what payout activity is visible on chain.
      </p>

      <div className="demo-metric-grid demo-metric-grid--two">
        <DemoMetric
          label="Nimiq Validator Trust Score"
          value="94 / 100"
          status="registry"
          definition="Official score supplied by the Nimiq validators registry, not independently calculated by Steakout."
        />
        <DemoMetric
          label="Observed payout windows"
          value="27 / 28 windows"
          status="verified"
          definition="Observed payout runs compared with the declared schedule during the analysis window."
        />
        <DemoMetric
          label="Declared schedule"
          value="Every 12 hours"
          status="registry"
          definition="Payout schedule published by the validator registry."
        />
        <DemoMetric
          label="Observed recipient coverage"
          value="54 / 57 recipients"
          status="verified"
          definition="Distinct recipients observed in payout runs; not proof of full payout to every staker."
        />
      </div>

      <div className="demo-observation-note">
        <p className="nq-label">What this means</p>
        <p>
          Steakout has observed evidence of payout activity that is mostly on schedule. It does not calculate an effective fee or infer intent from a missing transaction.
        </p>
        <a className="demo-inline-link" href="/#/learn/methodology">
          Read the methodology
        </a>
      </div>

      <DemoDirectoryPreview />
    </section>
  )
}

function ActivityPanel() {
  const events = [
    { title: 'Direct payout observed', detail: 'Northstar Nimiq · 2 hours ago', status: 'Observed' },
    { title: 'Position snapshot updated', detail: 'Active stake · 50,000.00 NIM · 1 day ago', status: 'Verified observation' },
    { title: 'Delegation recorded', detail: 'Northstar Nimiq · 11 days ago', status: 'Observed' },
  ]

  return (
    <section
      id="demo-panel-activity"
      className="demo-panel"
      role="tabpanel"
      aria-labelledby="demo-tab-activity"
    >
      <div className="demo-panel-heading">
        <div>
          <p className="card-kicker">Personal activity</p>
          <h2>What changed</h2>
        </div>
      </div>

      <ol className="demo-activity-list">
        {events.map((event) => (
          <li key={event.title} className="demo-activity-item">
            <span className="demo-activity-dot" aria-hidden="true" />
            <div>
              <p className="demo-activity-title">{event.title}</p>
              <p className="demo-muted">{event.detail}</p>
            </div>
            <span className="demo-activity-status">{event.status}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ReviewPreview({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="demo-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="demo-dialog nq-card nq-card-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-review-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="demo-dialog-heading">
          <div>
            <p className="card-kicker">Review before confirm</p>
            <h2 id="demo-review-title">Stake 5,000.00 NIM</h2>
          </div>
          <button type="button" className="nq-close-btn" aria-label="Close review preview" onClick={onClose}>
          </button>
        </div>

        <dl className="demo-review-list">
          <div>
            <dt>Action</dt>
            <dd>Create staker and delegate</dd>
          </div>
          <div>
            <dt>Validator</dt>
            <dd>Northstar Nimiq<br /><span className="demo-address">NQ…9F2C</span></dd>
          </div>
          <div>
            <dt>Resulting state</dt>
            <dd>No staker → Active delegation</dd>
          </div>
        </dl>

        <div className="demo-dialog-note">
          <strong>Demo only.</strong> In the real flow, this review is followed by native confirmation in Nimiq Pay. This preview cannot connect a wallet or send a transaction.
        </div>

        <button type="button" className="nq-pill-secondary nq-pill-lg" disabled>
          Wallet confirmation unavailable in demo
        </button>
      </section>
    </div>
  )
}

export default function DemoExperience() {
  const [activeTab, setActiveTab] = useState<DemoTab>('position')
  const [reviewOpen, setReviewOpen] = useState(false)

  return (
    <div className="demo-page-shell">
      <main className="demo-page">
        <div className="demo-topbar">
          <a className="demo-brand" href="/" aria-label="Return to Steakout home">
            <img src="/assets/logo-v1.png" alt="" />
            <span>Steakout</span>
          </a>
          <span className="demo-mode-pill">Demo mode</span>
        </div>

        <header className="demo-page-header">
          <p className="card-kicker">Product preview</p>
          <h1>See Steakout in use</h1>
          <p>
            Explore the connected staking cockpit, validator evidence, and review-before-confirm flow without a Nimiq account.
          </p>
        </header>

        <section className="demo-workspace nq-card nq-card-lg" aria-label="Steakout product preview">
          <DemoTabs active={activeTab} onChange={setActiveTab} />
          {activeTab === 'position' ? (
            <PositionPanel
              onReview={() => setReviewOpen(true)}
              onViewValidator={() => setActiveTab('validator')}
            />
          ) : null}
          {activeTab === 'validator' ? <ValidatorPanel /> : null}
          {activeTab === 'activity' ? <ActivityPanel /> : null}
        </section>

        <footer className="demo-footer">
          <a href="/#/validators">Explore live public records</a>
          <span>or</span>
          <a href="/">Return to Steakout</a>
        </footer>

        {reviewOpen ? <ReviewPreview onClose={() => setReviewOpen(false)} /> : null}
      </main>
    </div>
  )
}
