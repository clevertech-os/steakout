import Amount from '../components/Amount'
import FreshnessTag from '../components/FreshnessTag'
import type { ObservedPositionGrowth } from '../api/continuity'
import './RestakeGrowthPanel.css'

interface RestakeGrowthPanelProps {
  growth: ObservedPositionGrowth | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

function formatWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms))
}

/** Restake observations only; deliberately contains no payout language. */
export default function RestakeGrowthPanel({
  growth,
  loading = false,
  error = null,
  onRetry,
}: RestakeGrowthPanelProps) {
  return (
    <section className="home-growth" aria-labelledby="home-growth-title">
      <div className="home-growth-head">
        <div>
          <p className="nq-label">Restake observations</p>
          <h2 id="home-growth-title">Observed position growth</h2>
        </div>
        {growth?.status === 'observed' ? (
          <span className="home-growth-status">Verified observation</span>
        ) : (
          <span className="home-growth-status home-growth-status--muted">
            Insufficient data
          </span>
        )}
      </div>

      <p className="home-copy home-growth-definition">
        Change in this staker position between indexed snapshots. This is an
        observation of position balances, not a guaranteed return.
      </p>

      {loading ? <p className="home-copy home-copy--muted">Loading position history…</p> : null}
      {error ? (
        <div className="home-growth-error" role="alert">
          <p className="home-copy home-copy--muted">{error}</p>
          {onRetry ? (
            <button type="button" className="nq-ghost-btn" onClick={onRetry}>
              Retry position history
            </button>
          ) : null}
        </div>
      ) : null}
      {!loading && !error && growth?.status === 'observed' && growth.window ? (
        <>
          <div className="home-growth-total">
            <p className="nq-label">Total observed change</p>
            <p className="home-growth-amount">
              <Amount luna={growth.totalDeltaLuna} label="Total observed change" />
            </p>
            <p className="home-copy home-copy--muted">
              {formatWhen(growth.window.from)} → {formatWhen(growth.window.to)} ·{' '}
              {growth.window.durationDays} day calendar span
            </p>
          </div>

          <div className="home-growth-range">
            <div className="home-growth-range-head">
              <p className="nq-label">Illustrative network estimate</p>
              <span className="home-growth-inferred">Inferred</span>
            </div>
            {growth.expectedRange ? (
              <p className="home-copy">
                <Amount luna={growth.expectedRange.lowerLuna} /> →{' '}
                <Amount luna={growth.expectedRange.upperLuna} /> over the usable intervals
              </p>
            ) : (
              <p className="home-copy home-copy--muted">Unavailable for this history.</p>
            )}
            <p className="home-copy home-copy--muted home-growth-assumption">
              {growth.expectedRange?.assumptions ??
                'Illustrative only; not validator-specific, predictive, or guaranteed.'}
            </p>
          </div>
        </>
      ) : null}

      {!loading && !error && growth && growth.intervals.length > 0 ? (
        <div className="home-growth-intervals">
          <p className="nq-label">Snapshot intervals</p>
          <ul>
            {growth.intervals.map((interval) => (
              <li key={`${interval.from.at}-${interval.to.at}`}>
                <span>
                  {formatWhen(interval.from.at)} → {formatWhen(interval.to.at)}
                </span>
                <Amount luna={interval.deltaLuna} />
                {interval.status === 'confounded' ? (
                  <small>
                    Excluded: {
                      interval.confoundedBy === 'delegation-change'
                        ? 'delegation changed'
                        : interval.confoundedBy === 'chain-history-unavailable'
                          ? 'chain history was not fully available'
                          : interval.confoundedBy === 'chain-staking-action'
                            ? 'staking activity was observed on chain'
                            : 'staking activity known to Steakout'
                    }
                  </small>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!loading && !error && growth?.status !== 'observed' ? (
        <p className="home-copy home-copy--muted">
          More independent snapshots are needed before a position change can
          be summarized. Known staking or delegation activity is kept separate.
        </p>
      ) : null}

      <a className="home-method-link" href="#/learn/methodology">
        Methodology and limitations →
      </a>

      {growth?.freshness ? (
        <p className="home-copy home-copy--muted home-growth-freshness">
          <FreshnessTag
            updatedAt={growth.freshness.at}
            ageSeconds={growth.freshness.ageSeconds}
          />
          {growth.freshness.sourceBlock != null
            ? ` · source block ${growth.freshness.sourceBlock}`
            : null}
        </p>
      ) : null}
    </section>
  )
}
