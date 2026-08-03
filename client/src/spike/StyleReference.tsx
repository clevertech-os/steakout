/**
 * Hidden style reference for P1-08 (pathname `/spike-style`).
 * Renders one of each confirmed nimiq-css component utility + Steakout
 * status chips built only from `--so-*` tokens. Not a product screen.
 */
import './StyleReference.css'

const PILL_VARIANTS = [
  'nq-pill-blue',
  'nq-pill-white',
  'nq-pill-gold',
  'nq-pill-green',
  'nq-pill-orange',
  'nq-pill-red',
  'nq-pill-secondary',
  'nq-pill-tertiary',
] as const

const STATUS_CHIPS: { label: string; className: string }[] = [
  { label: 'On schedule', className: 'so-chip so-chip--verified' },
  { label: 'Mostly on schedule', className: 'so-chip so-chip--warn' },
  { label: 'Needs review', className: 'so-chip so-chip--not-observed' },
  { label: 'Verified observation', className: 'so-chip so-chip--info' },
  { label: 'Insufficient data', className: 'so-chip so-chip--disabled' },
]

export default function StyleReference() {
  return (
    <main className="shell style-ref-shell">
      <header className="shell-header">
        <p className="eyebrow">P1-08 style reference</p>
        <h1>Tokens + utilities</h1>
      </header>

      <section className="nq-card style-ref-section" aria-labelledby="ref-pills">
        <h2 id="ref-pills" className="nq-label">
          Pills
        </h2>
        <p className="nq-subline">Confirmed `nq-pill-*` variants (utilities layer).</p>
        <div className="style-ref-row">
          {PILL_VARIANTS.map((cls) => (
            <button key={cls} type="button" className={cls}>
              {cls.replace('nq-pill-', '')}
            </button>
          ))}
          <button type="button" className="nq-pill-blue nq-pill-lg">
            large
          </button>
          <button type="button" className="nq-pill-blue nq-pill-xl">
            xl
          </button>
          <button type="button" className="nq-ghost-btn">
            ghost
          </button>
        </div>
      </section>

      <section className="nq-card style-ref-section" aria-labelledby="ref-cards">
        <h2 id="ref-cards" className="nq-label">
          Cards
        </h2>
        <div className="style-ref-cards">
          <article className="nq-card nq-hoverable style-ref-nested-card">
            <p className="nq-label">nq-card</p>
            <p className="nq-subline">Hoverable card for directory rows.</p>
          </article>
          <article className="nq-card nq-card-lg style-ref-nested-card">
            <p className="nq-label">nq-card-lg</p>
            <p className="nq-subline">Larger surface for feature blocks.</p>
          </article>
        </div>
      </section>

      <section className="nq-card style-ref-section" aria-labelledby="ref-type">
        <h2 id="ref-type" className="nq-label">
          Labels & type
        </h2>
        <p className="nq-label">nq-label — field labels / table headers</p>
        <p className="nq-subline">nq-subline — section subheadings and explainer lines</p>
        <p className="style-ref-mono">
          Fira Mono sample: 1,250.00 NIM · NQXX…ABCD · block 1234567
        </p>
        <p className="style-ref-sans">Mulish sample: The validator paid on schedule in the observed window.</p>
      </section>

      <section className="nq-card style-ref-section" aria-labelledby="ref-input">
        <h2 id="ref-input" className="nq-label">
          Input
        </h2>
        <label className="style-ref-field">
          <span className="nq-label">Amount (NIM)</span>
          <input className="nq-input-box" type="text" inputMode="decimal" defaultValue="100" />
        </label>
      </section>

      <section className="nq-card style-ref-section" aria-labelledby="ref-chips">
        <h2 id="ref-chips" className="nq-label">
          Status chips (tokens only)
        </h2>
        <p className="nq-subline">Styled from `--so-*` only — no raw palette vars.</p>
        <div className="style-ref-row">
          {STATUS_CHIPS.map((chip) => (
            <span key={chip.label} className={chip.className}>
              {chip.label}
            </span>
          ))}
        </div>
      </section>

      <section className="nq-card style-ref-section" aria-labelledby="ref-swatches">
        <h2 id="ref-swatches" className="nq-label">
          Semantic swatches
        </h2>
        <ul className="style-ref-swatches">
          {(
            [
              ['surface', 'var(--so-surface)'],
              ['card', 'var(--so-card)'],
              ['ink', 'var(--so-ink)'],
              ['muted', 'var(--so-muted)'],
              ['accent', 'var(--so-accent)'],
              ['verified', 'var(--so-verified)'],
              ['warn', 'var(--so-warn)'],
              ['not-observed', 'var(--so-not-observed)'],
              ['info', 'var(--so-info)'],
              ['rule', 'var(--so-rule)'],
              ['disabled', 'var(--so-disabled)'],
            ] as const
          ).map(([name, color]) => (
            <li key={name} className="style-ref-swatch">
              <span className="style-ref-swatch-chip" style={{ background: color }} />
              <span className="style-ref-mono">--so-{name}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
