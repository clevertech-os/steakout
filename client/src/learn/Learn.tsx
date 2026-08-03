/**
 * Learn destination (P2-12): hub + articles for staking, methodology,
 * limitations, and privacy. Copy follows METHODOLOGY.md language dictionary.
 */
import type { LearnArticleId } from '../routes'
import { CALC_VERSION, CALC_VERSION_DATE } from './calcVersion'
import './Learn.css'

export interface LearnProps {
  /** Subpath under `#/learn/:article`; omit for hub index. */
  article?: string
}

const ARTICLES: {
  id: LearnArticleId
  kicker: string
  title: string
  blurb: string
}[] = [
  {
    id: 'staking',
    kicker: 'Basics',
    title: 'How staking works',
    blurb: 'Non-custodial delegation on Nimiq — what you approve, what stays in your wallet.',
  },
  {
    id: 'methodology',
    kicker: 'How we measure',
    title: 'Methodology',
    blurb: 'Declared policy vs observed chain behavior, status labels, and payout runs.',
  },
  {
    id: 'limitations',
    kicker: 'What we cannot claim',
    title: 'Limitations',
    blurb: 'History depth, missing data, and the hard bans that keep language honest.',
  },
  {
    id: 'privacy',
    kicker: 'Your data',
    title: 'Privacy',
    blurb: 'What Steakout sends to the server, and what we do not collect.',
  },
]

function isArticle(id: string | undefined): id is LearnArticleId {
  return ARTICLES.some((a) => a.id === id)
}

function BackToLearn() {
  return (
    <a className="learn-back nq-arrow-back" href="#/learn">
      All Learn topics
    </a>
  )
}

function ArticleFooter({ current }: { current: LearnArticleId }) {
  const others = ARTICLES.filter((a) => a.id !== current)
  return (
    <ul className="learn-footer-nav nq-not-prose">
      {others.map((a) => (
        <li key={a.id}>
          <a className="nq-arrow" href={`#/learn/${a.id}`}>
            {a.title}
          </a>
        </li>
      ))}
    </ul>
  )
}

function Hub() {
  return (
    <>
      <header className="shell-header learn-header">
        <p className="eyebrow">Steakout</p>
        <h1>Learn</h1>
        <p className="learn-lede">
          Plain-language guides to staking in Nimiq Pay, how Steakout observes
          validators, and what this product cannot claim.
        </p>
      </header>

      <ul className="learn-index">
        {ARTICLES.map((a) => (
          <li key={a.id}>
            <a className="learn-index-link nq-focusable" href={`#/learn/${a.id}`}>
              <p className="learn-index-kicker">{a.kicker}</p>
              <p className="learn-index-title">{a.title}</p>
              <p className="learn-index-blurb">{a.blurb}</p>
              <span className="learn-index-arrow nq-arrow">Read</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}

function StakingArticle() {
  return (
    <article className="learn-article nq-prose" aria-labelledby="learn-staking-title">
      <h2 id="learn-staking-title">How staking works</h2>
      <p>
        Staking on Nimiq means you <strong>delegate</strong> NIM to a validator so that
        stake helps secure the network. Your funds stay in a protocol staker account
        controlled by <em>your</em> wallet — not by Steakout and not by the validator as a
        custodian.
      </p>

      <h3>Non-custodial by design</h3>
      <p>
        Steakout never asks for private keys or seed phrases. Every staking write —
        create staker, add stake, change validator, retire, or remove — goes through
        the Nimiq Pay provider. You review the action, then approve it in your wallet.
        If you decline, nothing is sent.
      </p>
      <div className="learn-callout nq-not-prose">
        <p>
          Before any confirmation, Steakout shows a review screen: action type, amount
          in NIM, validator name and address, and the resulting position state. No
          provider method runs without that step.
        </p>
      </div>

      <h3>What you choose</h3>
      <ul>
        <li>
          <strong>A validator</strong> — operators that produce blocks. The official{' '}
          <strong>Validator Trust Score</strong> describes block-production performance.
          Steakout shows that score alongside its own observations; it never replaces it.
        </li>
        <li>
          <strong>An amount</strong> — how much NIM to put into your staker position.
          Leave room for fees; avoid staking every last Luna by accident.
        </li>
      </ul>

      <h3>Position states (plain language)</h3>
      <ul className="learn-def-list nq-not-prose">
        <li className="learn-def-item">
          <span className="learn-def-term">Active</span>
          <p className="learn-def-body">
            Stake is delegated and counting toward the chosen validator.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Pending</span>
          <p className="learn-def-body">
            A change is in flight; the network has not finished applying it yet.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Inactive</span>
          <p className="learn-def-body">
            Stake is no longer actively delegated (for example after retiring).
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Retiring / Withdrawable</span>
          <p className="learn-def-body">
            Leaving stake can involve a protocol waiting period. Steakout surfaces those
            steps when available; timing is set by the protocol, not by this app.
          </p>
        </li>
      </ul>

      <h3>Rewards are not a promise</h3>
      <p>
        Validators may distribute rewards according to their own arrangements with
        stakers. Some send direct payments; some restake. Steakout may show an{' '}
        <strong>illustrative network estimate</strong> — never a guaranteed return or
        APY. Estimates always link back to{' '}
        <a href="#/learn/methodology">methodology</a> and{' '}
        <a href="#/learn/limitations">limitations</a>.
      </p>
      <p>
        After you delegate, the useful question becomes: what can we <em>observe</em> on
        chain about that validator relationship? That is the rest of Learn.
      </p>

      <ArticleFooter current="staking" />
    </article>
  )
}

function MethodologyArticle() {
  return (
    <article className="learn-article nq-prose" aria-labelledby="learn-methodology-title">
      <h2 id="learn-methodology-title">Methodology</h2>
      <p>
        Steakout separates what a validator <strong>declares</strong> (registry policy)
        from what we can <strong>observe</strong> on chain. When in doubt, we say less.
        We never treat a missing payment as proof of wrongdoing.
      </p>

      <h3>Data status labels</h3>
      <p>Every accountability metric carries exactly one of these:</p>
      <ul className="learn-def-list nq-not-prose">
        <li className="learn-def-item">
          <span className="learn-def-status learn-def-status--verified">Verified observation</span>
          <span className="learn-def-term">From confirmed chain data</span>
          <p className="learn-def-body">
            Derived from a confirmed on-chain transaction or account state.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-status">Registry declaration</span>
          <span className="learn-def-term">Supplied by the validators registry</span>
          <p className="learn-def-body">
            Fee, schedule, and payout type as published — not independently verified by
            Steakout.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-status learn-def-status--warn">Inferred</span>
          <span className="learn-def-term">Computed with stated assumptions</span>
          <p className="learn-def-body">
            Built from observable patterns; assumptions are disclosed next to the metric.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-status learn-def-status--disabled">Insufficient data</span>
          <span className="learn-def-term">Not enough history yet</span>
          <p className="learn-def-body">
            Too little indexed history, or a policy we cannot normalize. This is a valid
            result — not a negative score.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-status learn-def-status--disabled">Unavailable</span>
          <span className="learn-def-term">Source did not provide data</span>
          <p className="learn-def-body">
            RPC, indexer, or API gap — we could not obtain the required input.
          </p>
        </li>
      </ul>

      <h3>Observation status (validator-level)</h3>
      <p>
        For direct-payout validators with a normalizable schedule, Steakout maps
        observed payout windows to plain labels:
      </p>
      <ul className="learn-def-list nq-not-prose">
        <li className="learn-def-item">
          <span className="learn-def-term">On schedule</span>
          <p className="learn-def-body">
            At least 95% of expected payout windows were observed in the analysis window.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Mostly on schedule</span>
          <p className="learn-def-body">80–95% of expected windows observed.</p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Irregular</span>
          <p className="learn-def-body">
            Under 80% observed, with a normalizable schedule and at least 14 days of
            history. Still a description of windows — not an accusation.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Not enough observed data</span>
          <p className="learn-def-body">
            Fewer than 7 days of indexed history, or too few windows to judge.
          </p>
        </li>
        <li className="learn-def-item">
          <span className="learn-def-term">Observation unavailable</span>
          <p className="learn-def-body">
            No reward address, indexer gap, or schedule that cannot be normalized and no
            runs to show.
          </p>
        </li>
      </ul>

      <h3>How we observe direct payouts</h3>
      <p>
        For validators that pay out directly, the observation target is outbound
        transactions from the validator&apos;s authoritative on-chain reward address.
      </p>
      <ul>
        <li>
          <strong>Observed payout runs</strong> — outbound transactions within a
          60-minute sliding window are grouped as one run (window start/end, transaction
          count, distinct recipients, block range, transaction hashes).
        </li>
        <li>
          <strong>Schedule adherence</strong> — only unambiguous declared forms are
          normalized (for example hourly, every N hours, daily, twice daily). Free-text
          schedules are shown raw; we never grade a schedule we cannot normalize.
        </li>
        <li>
          <strong>Observed recipient coverage</strong> — distinct recipients per run, and
          when the registry lists known stakers, a covered/total pair. Consolidation,
          thresholds, and incomplete lists mean this is <em>not</em> proof that every
          staker was paid. We never say &quot;paid everyone.&quot;
        </li>
      </ul>

      <h3>Your position (when connected)</h3>
      <p>
        When you connect a wallet, Steakout may show personal continuity fields: last
        observed payment to your address, consecutive observed windows that include you,
        time since last observed payment, and whether your address appears in a known
        staker set. Each field can be empty on its own — empty means{' '}
        <span className="learn-term">not observed</span> or{' '}
        <span className="learn-term">insufficient data</span>, not wrongdoing.
      </p>

      <h3>Restake validators</h3>
      <p>
        Some validators restake rewards instead of sending direct payments. For those,
        Steakout tracks staker account state over time and may show{' '}
        <strong>observed position growth</strong> against an{' '}
        <strong>illustrative expected range</strong> — never &quot;validator payout
        verified.&quot; If growth data is unreliable, restake analytics stay limited and
        that limit is stated on the{' '}
        <a href="#/learn/limitations">limitations</a> page.
      </p>

      <h3>Official score stays official</h3>
      <p>
        The <strong>Validator Trust Score</strong> is always shown as Nimiq&apos;s
        official block-production score. Steakout observations sit beside it. They do
        not replace it, and they do not rank validators as &quot;best.&quot;
      </p>

      <h3>Language we use</h3>
      <p>When reading Steakout, expect neutral wording:</p>
      <ul>
        <li>
          <span className="learn-term">observed</span> /{' '}
          <span className="learn-term">not observed in this window</span>
        </li>
        <li>
          <span className="learn-term">insufficient data</span> /{' '}
          <span className="learn-term">needs review</span>
        </li>
        <li>
          <span className="learn-term">declared fee (registry)</span> — not
          &quot;actual fee&quot;
        </li>
        <li>
          <span className="learn-term">illustrative network estimate</span> — not
          guaranteed return
        </li>
      </ul>
      <p>
        Every metric should include a one-sentence definition, a status label, a
        freshness timestamp, and a path to evidence or this methodology.
      </p>

      <ArticleFooter current="methodology" />
    </article>
  )
}

function LimitationsArticle() {
  return (
    <article className="learn-article nq-prose" aria-labelledby="learn-limitations-title">
      <h2 id="learn-limitations-title">Limitations</h2>
      <p>
        Steakout is an observation and education product. It is not a guarantee of
        returns, not a court of intent, and not a complete view of every outbound
        movement a validator makes. This page lists the hard edges of v1.
      </p>

      <h3>What we never claim in v1</h3>
      <ul>
        <li>
          <strong>No effective validator fee</strong> — outflows mix principal returns,
          treasury transfers, and unrelated movements. Naive fee math is reputationally
          harmful and banned.
        </li>
        <li>
          <strong>No fraud or scam labels</strong> — missing or irregular observations
          are never treated as proof of wrongdoing.
        </li>
        <li>
          <strong>No guaranteed APY or guaranteed payout</strong> — estimates are
          illustrative only.
        </li>
        <li>
          <strong>No &quot;best validator&quot; ranking</strong> — we do not publish an
          objective financial ranking of operators.
        </li>
        <li>
          <strong>A missing payment does not prove intent</strong> — we report what was{' '}
          <span className="learn-term">observed</span> or{' '}
          <span className="learn-term">not observed in this window</span>.
        </li>
      </ul>

      <h3>What we cannot always see</h3>
      <ul>
        <li>
          <strong>History depth</strong> — observations only cover the period Steakout
          has indexed. Short history yields{' '}
          <span className="learn-term">insufficient data</span>, never a grade that
          pretends certainty.
        </li>
        <li>
          <strong>Indexer and RPC gaps</strong> — when sources fail, metrics show{' '}
          <span className="learn-term">unavailable</span> with freshness when known.
        </li>
        <li>
          <strong>Schedules we cannot normalize</strong> — free-text policies stay as
          declared text plus raw observed runs. We do not invent a numeric schedule.
        </li>
        <li>
          <strong>Recipient coverage caveats</strong> — consolidation addresses,
          minimum thresholds, and incomplete registry staker lists mean coverage is not
          a full-payout proof.
        </li>
        <li>
          <strong>Restake paths</strong> — rewards may not appear as direct payments.
          Position growth, when shown, is labeled illustrative and limited by how
          reliably staker state can be read.
        </li>
        <li>
          <strong>Off-chain arrangements</strong> — anything that never hits the public
          chain is outside Steakout&apos;s observation target.
        </li>
      </ul>

      <div className="learn-callout nq-not-prose">
        <p>
          Server confirmation never trusts a client claim that a transaction succeeded.
          Each confirmation is matched against chain data for the authenticated address
          and the intended operation, amount, and validator.
        </p>
      </div>

      <h3>Calculation version (audit trail)</h3>
      <p>
        When classifier logic changes, Steakout bumps a calculation version so older
        rows stay available and queries use the latest version. That version is the
        audit trail for how observations were computed.
      </p>
      <p className="learn-meta nq-not-prose">
        Current calc_version: {CALC_VERSION}
        <br />
        Effective date: {CALC_VERSION_DATE}
        <br />
        Source: observation classifier baseline (see methodology).
      </p>
      <p>
        For full metric rules and language, read{' '}
        <a href="#/learn/methodology">Methodology</a>. For staking safety basics, see{' '}
        <a href="#/learn/staking">How staking works</a>.
      </p>

      <ArticleFooter current="limitations" />
    </article>
  )
}

function PrivacyArticle() {
  return (
    <article className="learn-article nq-prose" aria-labelledby="learn-privacy-title">
      <h2 id="learn-privacy-title">Privacy</h2>
      <p>
        Steakout is built to need as little personal data as possible. Here is what
        happens when you use the app.
      </p>

      <h3>What we send to the server</h3>
      <ul>
        <li>
          When you connect, your <strong>wallet address</strong> is sent to the Steakout
          server so we can retrieve position and activity data for that address.
        </li>
        <li>
          <strong>Public chain activity</strong> associated with that address may be
          linked to your Steakout session (for example last observed payment or position
          state).
        </li>
      </ul>

      <h3>What we do not collect in v1</h3>
      <ul>
        <li>No private keys or seed phrases — ever.</li>
        <li>No name, email, or location required for core staking and observation.</li>
        <li>
          Product analytics are <strong>aggregate and minimal</strong>: server-side
          counters for disclosed product metrics only (for example distinct connected
          wallets as a count, profile views, share-page hits, and indexer history depth).
          The public metrics endpoint never includes wallet addresses. No third-party
          analytics, and raw pageviews are not treated as unique wallet usage.
        </li>
      </ul>

      <h3>Sessions and short-lived data</h3>
      <p>
        Authentication uses a signed-message challenge verified on the server. Session
        cookies are short-lived. Challenges and staking intents expire and are cleaned
        up. Stored application data is described in the open data model — no keys, no
        seeds, no unnecessary personal fields.
      </p>

      <div className="learn-callout nq-not-prose">
        <p>
          Non-custodial reminder: only you approve staking transactions in Nimiq Pay.
          Steakout cannot move funds without your wallet confirmation.
        </p>
      </div>

      <p>
        Related reading:{' '}
        <a href="#/learn/staking">How staking works</a> ·{' '}
        <a href="#/learn/limitations">Limitations</a>
      </p>

      <ArticleFooter current="privacy" />
    </article>
  )
}

function ArticleView({ id }: { id: LearnArticleId }) {
  const meta = ARTICLES.find((a) => a.id === id)!

  return (
    <>
      <header className="shell-header learn-header">
        <BackToLearn />
        <p className="eyebrow">{meta.kicker}</p>
        <h1>{meta.title}</h1>
      </header>
      {id === 'staking' && <StakingArticle />}
      {id === 'methodology' && <MethodologyArticle />}
      {id === 'limitations' && <LimitationsArticle />}
      {id === 'privacy' && <PrivacyArticle />}
    </>
  )
}

export default function Learn({ article }: LearnProps) {
  if (isArticle(article)) {
    return <ArticleView id={article} />
  }

  return <Hub />
}
