# Design audit — P3-05 / P3-06 / P3-07

Pragmatic combined pass (2026-08-03). Scope: shipped product screens only (not `/spike*`).  
Contract: [`STYLING.md`](STYLING.md) + SPEC §10 + **[`anti-slop.md`](anti-slop.md)**. No business-logic or API changes.

Any further visual work must load `anti-slop.md` first (ban list + section 5 self-check).

**Residual:** owner walkthrough sign-off (P3-05 AC); full keyboard stake flow (blocked until P1-12 ReviewSheet ships); automated contrast tooling in CI not wired.

---

## Anti-slop pass

Scoped visual cleanup (2026-08-03, Polishing). Loaded `anti-slop.md` + STYLING §8–10. No API/business logic, no new fonts/gradients.

### Fixed this pass

1. **Eyebrow / card-kicker scaffold** — global styles no longer ember mono uppercase on every section. Muted UI weight; optional `.eyebrow--brand` only on disconnected home identity.
2. **Side-stripes** — removed declared-card left bar and Learn callout stripe; observation profile accent kept thin (2px) for official-vs-observation separation only.
3. **Nested card chrome** — home position stat tiles flattened (no mini-cards inside the main card).
4. **Mono scope** — kickers/def-status/meta prose use UI sans; mono reserved for amounts, hashes, timestamps, version ids (global `.mono` utility).
5. **Em dashes** — user-facing product copy (Home, Activity, Directory, Evidence, Profile share, Learn) rewritten with commas/periods/colons. Empty-value `—` placeholders kept.
6. **Redundant kickers** — dropped page-level “Steakout” / “Your wallet” eyebrows and duplicate Timeline/error kickers where the heading already names the state.
7. **Vague CTA** — removed “Get started” kicker on disconnected home; primary remains Connect wallet / Explore validators.

### Residual findings (next pass)

| Finding | Where | Severity | Note |
|---|---|---|---|
| Still many section `card-kicker`s on Profile/Evidence | Profile official / declared / on-chain; Evidence observation | Low | Now muted; could collapse into h2 captions if still noisy |
| Equal-ish vertical rhythm on multi-card Profile | Profile stack | Low | `row-gap` increased; not a full density redesign |
| Learn index is four similar cards | Learn hub | Low | Content IA, not marketing feature grid; leave unless copy redesign |
| nq-label letter-spacing may still track slightly | nimiq-css defaults | Low | Local overrides reduced; framework defaults untouched |
| Stake CTA still disabled stub | Profile | Expected | P1-12 ReviewSheet |
| Spike routes still use old ember mono kickers | `/spike*` | Out of scope | Harness only |
| Real-device 320 walkthrough | All | Owner residual | Unchanged |
| Em dashes in code comments | Various | Ignore | Not user-facing |

### Self-check (anti-slop §5)

- [x] `--so-*` only; no purple gradients / new fonts
- [x] Mulish UI; Fira Mono for amounts / hashes / timestamps / calc version
- [x] Ember on active nav + rare brand kicker only
- [x] One primary CTA look (blue pill) per screen state
- [x] Official Trust Score still info-tinted vs observation
- [x] No nested decorative cards on home stats
- [x] No em dashes in product copy strings
- [ ] Owner visual sign-off still open

---

## Banned-pattern sweep (P3-05)

| Pattern | Result |
|---|---|
| Neon / decorative `gradient` / `bg-gradient-*` | **None** in product CSS/TSX |
| `backdrop-filter` / glassmorphism | **None** |
| Fake multi-decimal precision on trust metrics | Formatters cap compact % (`formatOfficialScore`); no `99.83%`-style labels |
| Guarantee / “best validator” UI badges | Copy only in Learn disclaimers; directory sort explainer denies ranking |

---

## Shared components

| Component | Do/don't | Responsive 320 | A11y | Notes |
|---|---|---|---|---|
| **StatusChip** | Pass — green only for on-schedule; gold incomplete; neutral insufficient | Label wraps; max-width 100% | `aria-label` + definition; info glyph decorative | Warn text uses `--so-warn-ink` for AA on soft gold |
| **DataStatusTag** | Pass — provenance labels only | Small mono tag wraps | `aria-label` + definition | Inferred/insufficient ink contrast tightened |
| **PositionStateBadge** | Pass — distinct from observation chips | Ellipsis if cramped | `aria-label` added | Warn states use `--so-warn-ink` |
| **Amount** | Pass — Fira Mono, compact NIM | Horizontal scroll inside card for ≥9 digits; smaller clamp &lt;360px | Optional `label` → `aria-label` | Never mid-number wrap |
| **BottomNav** | Pass — ember only for active + bar indicator (not color-only) | 44px targets; label ellipsis; denser &lt;360px | `aria-label="Primary"`, per-link `aria-label`, `aria-current` | Focus ring inset so not clipped |
| **FreshnessTag** | Pass — mono timestamps | N/A | Text readable | Unchanged this pass |
| **EnvelopeStatusBanner** | Pass — amber/gold, never alarm-red | Flex wrap + retry 44px | Retry is real button | Kicker ink contrast improved |
| **OfflineBanner** | Pass — muted/info calm | Wraps | `role="status"` | Unchanged |
| **Cards (`nq-card` + shell)** | Pass — soft shadow only, no glass | `min-width: 0`, overflow-wrap | Sections use `aria-labelledby` where present | Token radii/spacing documented |

---

## Per-screen checklist

Legend: **OK** = meets AC for shipped scope · **Partial** = residual · **N/A** = feature not shipped.

### Home (Disconnected / Not staked / Staked)

| Check | Result |
|---|---|
| Do/don't | **OK** — warm surface, ember kickers only, blue links, no gradients |
| Mono amounts / hashes | **OK** — `Amount`, address mono |
| 320px no horizontal scroll | **OK** — shell `overflow-x: hidden`; amount row scrolls internally |
| Long validator name | **OK** — 2-line clamp on staked validator name |
| Large balances | **OK** — mono + internal overflow |
| Touch ≥44px CTAs | **OK** — pills, disconnect, method links |
| Focus visible | **OK** — global `:focus-visible` + link underline |
| Keyboard primary actions | **OK** — connect / choose validator links & buttons |
| Reduced motion | **OK** — skeleton pulse gated; global reduce kill-switch |

### Validators directory

| Check | Result |
|---|---|
| Do/don't | **OK** — official score info-tinted, separate from StatusChip |
| Long names / missing logos | **OK** — 2-line name clamp; initials fallback |
| Mono stake / dominance | **OK** — `--mono` + ellipsis |
| Filters 44px | **OK** — select + listed toggle |
| A11y | **OK** — list controls `aria-label`; cards named “View record for …” |
| Empty / error | **OK** — retry CTAs 44px |

### Validator profile + evidence

| Check | Result |
|---|---|
| Do/don't | **OK** — official score card distinct; observation left border by tone |
| Score mono compact | **OK** — mono score value; no fake precision |
| Title stress | **OK** — 3-line clamp at narrow widths |
| Evidence rows | **OK** — no dense tables; mono windows; tx links 44px |
| A11y | **OK** — section labels, run list `aria-label`, tx focus underline |
| Stake CTA | **Partial** — button present; full review sheet is P1-12 |

### Activity (personal + network)

| Check | Result |
|---|---|
| Do/don't | **OK** — neutral copy; status pills muted |
| Timestamps mono | **OK** |
| Links 44px + labels | **OK** — explorer / validator `aria-label`s |
| Tabs keyboard | **OK** — `role="tablist"`, focus ring on tabs |
| Empty next actions | **OK** |

### Learn

| Check | Result |
|---|---|
| Do/don't | **OK** — prose, info callouts, status definition chips |
| 320px articles | **OK** — overflow-wrap; stacked def list |
| Nav links 44px | **OK** — index cards, back, footer |
| A11y | **OK** — articles `aria-labelledby` |

### App shell

| Check | Result |
|---|---|
| Safe-area | **OK** — nav padding + main clearance |
| Offline banner | **OK** |
| Network badge (non-mainnet) | **OK** — mono status |
| Landmarks | **OK** — `main` + primary `nav` |

---

## Contrast notes (status chips, light theme)

Approximate intent (hex fallbacks in `tokens.css`):

| Surface | Text token | Intent |
|---|---|---|
| verified soft | `--so-verified-strong` | AA for small bold |
| warn soft | **`--so-warn-ink`** (`#6b4f06`) | Darker than gold-1100 for small type AA |
| info soft | `--so-info-strong` | AA |
| disabled soft | **`--so-disabled-chip-ink`** | Darker than disabled-ink for chip labels |

Not a substitute for owner contrast tooling pass; residual if any chip fails measured AA after token load from nimiq-css `light-dark()`.

---

## Responsive stress matrix (CSS-level)

| Stress | Mitigation |
|---|---|
| Viewport 320 | Tighter `.app-main` margin; title clamps; card `min-width: 0` |
| Long validator name | Card 2-line / profile 3-line clamp |
| Missing logo | Initials block |
| Huge balance | `Amount` mono + `overflow-x: auto` |
| Long schedule string | Card schedule 2-line clamp |
| Bottom nav labels | Ellipsis + smaller type &lt;360px |

Device browser walkthrough (real 320/375/430 devices) remains owner residual.

---

## A11y residual (owner / later tasks)

1. **Full stake keyboard path** — complete only when ReviewSheet + P1-12 land.
2. **Identicons** — not yet a shared component; initials stand in on cards.
3. **Screen-reader live device check** — VoiceOver/TalkBack not run this pass.
4. **Contrast meter** — visual/token fix only; plug into Testing tooling if desired.

---

## Files touched this pass

- `client/src/styles/tokens.css`, `base.css`
- `client/src/App.css`
- Shared: `StatusChip.css`, `DataStatusTag.css`, `PositionStateBadge.{tsx,css}`, `Amount.css`, `BottomNav.{tsx,css}`, `NetworkBadge.css`, `EnvelopeStatusBanner.css`
- Screens: `Home.css`, `Activity.{tsx,css}`, `ValidatorCard.css`, `Profile.css`, `Learn.css`
- Docs: this file; STYLING.md §9 pointer
