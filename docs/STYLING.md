# Styling — nimiq-css design system

Steakout styles with **[nimiq-css](https://onmax.github.io/nimiq-ui/nimiq-css/getting-started.html)**, the Nimiq design-system CSS framework, via the **native CSS integration**. This file is the binding styling contract for Implementation and Polishing. It applies the visual direction of [SPEC.md §10](SPEC.md) on top of nimiq-css tokens.

## 1. Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Integration | **Native CSS** (`@import 'nimiq-css/css/index.css'`) | Zero build plugins, works with plain Vite + React, matches VeriLock's plain-CSS component style |
| Utility framework | None (no Tailwind/UnoCSS in v1) | Keep the dependency surface minimal; nimiq-css utilities cover our needs |
| Component CSS | Co-located `Component.css` files using nimiq-css utilities + Steakout tokens | VeriLock convention |
| Theme | **Light theme default**; dark mode via nimiq-css built-in support only after v1 polish | Spec calls for a light, calm instrument feel |
| Icons | `lucide-react` (as in VeriLock) + identicons for addresses | Already proven in the ecosystem |

## 2. Setup (P1-08 owns)

```bash
npm install nimiq-css --prefix client
```

Installed: **nimiq-css@1.0.0-beta.162** (workspace-hoisted under root `node_modules/`).

`client/src/styles/nimiq.css`:

```css
/* Chosen strategy: full framework index (see verification below). */
@import 'nimiq-css/css/index.css';

/*
  Per-layer alternative (package names as of beta.162 — not the older docs names):
  @import 'nimiq-css/css/colors.css' layer(nq-colors);
  @import 'nimiq-css/css/preflight.css' layer(nq-preflight);
  @import 'nimiq-css/css/typography.css' layer(nq-typography);
  @import 'nimiq-css/css/spacing.css' layer(nq-spacing);
  @import 'nimiq-css/css/utilities.css' layer(nq-utilities);
  @import 'nimiq-css/css/animations.css' layer(nq-animations);
  @import 'nimiq-css/css/atomic.css' layer(nq-atomic);
  fonts.css and static-content.css are never in index — import separately if needed.
*/

@import './tokens.css';
@import './base.css';
```

**Chosen import strategy: full `index.css`.** Reasons: one import, matches package README primary path, already pulls typography/prose/utilities. Per-layer form is reserved if we need to drop animations/atomic or add `static-content.css`. Fonts are handled in `base.css` (see below), not via `fonts.css`.

Import order matters: nimiq-css layers first, Steakout overrides last. `main.tsx` imports `styles/nimiq.css` once; no other global CSS entry points.

**Fonts (Vite):** self-hosted in `client/public/assets/fonts/` (weights shipped in V-01; real faces so `font-synthesis: none` in `base.css` never falls back to faux-bold):
- `Mulish-VariableFont_wght.ttf` → family `Mulish` weights 100–1000 (variable)
- `FiraMono-Regular.ttf` → family `Fira Mono` weight 400
- `FiraMono-Medium.ttf` → family `Fira Mono` weight 500
- `FiraMono-Bold.ttf` → family `Fira Mono` weight 700

Fira Mono has no 600 face; CSS weight 600 requests for mono resolve to 700 per the font-matching algorithm. Package `fonts.css` expects different Fira filenames (`FiraMono-400.ttf`) and is **not** imported; the Mulish variable file already uses the exact name it expects, so a future switch is trivial. Corrected `@font-face` blocks live in `base.css`. `--nq-font-mono` is overridden to prefer Fira Mono (preflight defaults to Fira Code).

**Hidden style reference:** pathname `/spike-style` (`client/src/spike/StyleReference.tsx`). Enabled in DEV or when `VITE_ENABLE_STYLE_SPIKE=true`.

### Verify-at-install results (2026-08-03, nimiq-css@1.0.0-beta.162)

Inspected: `node_modules/nimiq-css/dist/css/` (package exports map `./css/*` → `./dist/css/*`).

| Check | Result |
|---|---|
| Color custom properties | Named `--colors-{scale}-{step}` and bare `--colors-{scale}`. Scales: Neutral (0, 50–900, 1100 + bare), Blue / Green / Red / Orange / Gold / Purple (400, 500, 600, 1100 + bare). Plus gradient tokens. Values use `light-dark(oklch(...), oklch(...))`. Example: `--colors-neutral-50`, `--colors-red`, `--colors-green-1100`. |
| Typography classes `nq-text-*` | **Not present** in modern layers. Only legacy `dist/css/legacy/typography.css` has `.nq-text-s`. **Do not use `nq-text-*` until/unless we adopt legacy or they reappear.** Use `nq-label`, `nq-subline`, `nq-heading` / `nq-heading-lg`, and prose instead. |
| Prose escape hatch | **`.nq-not-prose`** (also respected as a descendant selector). Plain `not-prose` is **not** defined. Prose classes: `.nq-prose`, `.nq-prose-compact` (attribute forms `[nq-prose]`, `[nq-prose-compact]` also work). |
| What `index.css` includes | `colors` → `preflight` → `typography` → `spacing` → `utilities` → `animations` → `atomic`. **Includes typography/prose.** Does **not** include `fonts.css` or `static-content.css` (static-content is commented out with a note to import yourself). |
| Layer names (actual) | `nq-colors`, `nq-preflight` (singular), `nq-typography`, `nq-spacing`, `nq-utilities`, `nq-animations`, `nq-atomic`. Older docs that say `preflights` / four-layer-only are outdated. |
| Confirmed utility samples | `nq-card`, `nq-card-lg`, `nq-pill-*` (blue/white/gold/green/orange/red/secondary/tertiary + `nq-pill-lg`/`xl`), `nq-ghost-btn`, `nq-close-btn`, `nq-label`, `nq-subline`, `nq-arrow`, `nq-arrow-back`, `nq-input-box`, `nq-switch`, `nq-focusable`, `nq-hoverable`, `nq-hoverable-cta`, `nq-curtain-y`, scrollbar utils. |

## 3. Palette mapping

nimiq-css ships scales (50–1100) for: **Neutral, Blue, Green, Red, Orange, Gold, Purple**, in light and dark themes. Steakout semantic intent maps to them as follows:

| Steakout semantic | nimiq-css scale | Usage |
|---|---|---|
| Surface / background | Neutral 50–100 | Warm light background; cards on white |
| Primary text | Neutral 900–1100 | Charcoal, high contrast |
| Secondary text | Neutral 500–700 | Timestamps, source labels, sublines |
| **Ember accent** (brand) | **Red** 400–600 | Active states, primary CTA moments, brand marks — used sparingly |
| Verified / on-schedule | Green 400–600 | `On schedule`, verified observations only |
| Incomplete / irregular | **Gold** or **Orange** 400–600 | `Mostly on schedule`, `Irregular`, stale data |
| Not observed / needs review | Red 400–500, muted | Sparingly; never full-screen alarm |
| Links / neutral info | Blue 400–600 | All links, explorer references, info notices |
| Disabled / unknown | Neutral 200–400 | `Insufficient data`, `Unavailable` states |

`tokens.css` defines Steakout semantic tokens referencing the nimiq-css palette variables (with hex fallbacks). **Components consume `--so-*` tokens, never raw palette variables** — one mapping layer, one place to re-theme.

| Token | Maps to (palette) | Role |
|---|---|---|
| `--so-surface` | `--colors-neutral-50` | Page background |
| `--so-card` | `--colors-white` | Card / elevated surface |
| `--so-ink` | `--colors-neutral` | Primary text |
| `--so-muted` | `--colors-neutral-700` | Secondary text, timestamps |
| `--so-accent` / `--so-ember` | `--colors-red` | Brand ember (sparing) |
| `--so-accent-soft` / `--so-accent-strong` | red-400 / red-1100 | Soft fill / strong accent text |
| `--so-verified` (+ soft/strong) | green / green-400 / green-1100 | On-schedule, verified only |
| `--so-warn` (+ soft/strong/alt) | gold / gold-400 / gold-1100 / orange | Incomplete, irregular, stale |
| `--so-not-observed` (+ soft) | red-1100 / red-500 | Needs review (muted, not alarm) |
| `--so-info` (+ soft/strong) | blue / blue-400 / blue-1100 | Links, explorer, info notices |
| `--so-rule` | `--colors-neutral-300` | Dividers, borders |
| `--so-disabled` (+ soft/ink) | neutral-500 / 200 / 600 | Insufficient / unavailable |
| `--so-focus` | `--colors-blue` | Focus ring |
| `--so-shadow` | `--nq-shadow` (preflight) | Soft elevation |

## 4. Component mapping (nimiq-css utilities)

Confirmed utility classes (from nimiq-css docs, 2026-08): `nq-card`, `nq-card-lg`, `nq-pill-*` (blue/white/gold/green/orange/red/secondary/tertiary + large/xl), `nq-ghost-btn`, `nq-close-btn`, `nq-label`, `nq-subline`, `nq-arrow`, `nq-arrow-back`, `nq-input-box`, `nq-switch`, `nq-focusable`, `nq-hoverable`, `nq-hoverable-cta`, `nq-curtain-y`, `nq-prose`, `nq-prose-compact`, scrollbar utilities, `bg-gradient-*` + `nq-hoverable-*` gradient helpers.

| Steakout UI | Classes |
|---|---|
| Primary CTA (e.g. `Choose a validator`) | `nq-pill-blue` (or ember override via tokens) |
| Destructive-careful CTA (retire/remove) | `nq-pill-red` |
| Secondary actions | `nq-pill-secondary` / `nq-ghost-btn` |
| Cards (validator, position, stat) | `nq-card` / `nq-card-lg` |
| Clickable cards | `nq-card nq-hoverable` (+ `nq-hoverable-cta` for directory items) |
| Field labels, table headers | `nq-label` |
| Section subheadings, explainer lines | `nq-subline` |
| Amount input | `nq-input-box` |
| Links with affordance | `nq-arrow` / `nq-arrow-back` |
| Learn / methodology / limitations articles | `nq-prose` (compact cards: `nq-prose-compact`) |
| Scrollable evidence lists | `nq-curtain-y` + small-scrollbar utility |
| Focus states | `nq-focusable` on custom interactive elements |

Do **not** use `bg-gradient-*` for decoration — spec bans crypto-gradient aesthetics. Gradients are reserved for nimiq-css hover states if Polishing chooses them.

## 5. Steakout-specific components (build on tokens)

These don't exist in nimiq-css; build them in `client/src/components/` with co-located CSS:

| Component | Purpose | Notes |
|---|---|---|
| `StatusChip` | Observation status label (§3 of METHODOLOGY) | Color from semantic tokens; text always paired with an info affordance |
| `DataStatusTag` | `Verified` / `Registry` / `Inferred` / `Insufficient` / `Unavailable` | Neutral small tag; icon + text |
| `FreshnessTag` | `Updated 12 min ago` / history depth | Fira Mono, neutral-600 |
| `EvidenceRow` | One payout run: window, recipients, tx links | Thin rules, mono numerals, explorer arrows |
| `Identicon` | Address visual confirmation | Port approach from VeriLock usage |
| `Amount` | NIM amounts | Fira Mono; NIM primary, Luna secondary tooltips; never wrap mid-number |
| `PositionStateBadge` | `Active` / `Pending` / `Inactive` / `Retiring` / `Withdrawable` | Distinct from validator status colors |
| `BottomNav` | Home / Validators / Activity / Learn | ≥ 44px targets, safe-area insets |
| `ReviewSheet` | Pre-confirmation transaction review | Bottom sheet; amount + validator + transition summary; CTA never below fold |
| `LimitationsNote` | Inline methodology caveat | Blue info style, links to Learn |

## 6. Typography

- **UI font:** Mulish (nimiq-css default). Headings use weight contrast, not size inflation.
- **Numeric/mono:** Fira Mono for amounts, hashes, block numbers, timestamps.
- **Long-form:** `nq-prose` for Learn content.
- Numeric displays stay compact (spec: no fake precision — e.g. show `27/28 windows`, not `96.428571%`).

## 7. Layout & mobile rules (binding)

- Mobile-first; **works at 320px**; sweep 320 / 375 / 430.
- Single dominant action per screen; bottom nav or compact top nav.
- Touch targets ≥ 44px; no hover-only explanations (`nq-hoverable` is enhancement, never the only path).
- Evidence lists legible without charts; charts optional extras only.
- Full loading / empty / offline / stale states for every screen (skeletons in Polishing pass P3-08).
- Respect `prefers-reduced-motion`; safe-area insets on iOS.

## 8. Do / Don't (from SPEC §10, binding)

**Do:** warm light neutrals, charcoal text, ember accent sparingly, mint only for verified positives, amber for incomplete, blue reserved for links, strong type hierarchy, thin evidence lines, source labels, identicons.

**Don't:** neon crypto gradients, dense exchange tables on mobile, fake precision (`99.83% trust`), guarantee-implying badges, dark-glass-everywhere, aggressive red alarms for ordinary uncertainty.

## 9. Anti-slop (agents — mandatory for UI work)

Before restyling or adding chrome, load **[`anti-slop.md`](anti-slop.md)** (ported from VeriLock `journey-anti-slop.md`).

- Workflow: intent → constraints → tokens → one surface → checklist → ugly states  
- Ban list: purple SaaS gradients, Inter-as-brand, glass-everywhere, three-card marketing grids, vague “Get started”, crypto-neon, nested decorative cards, APY/best-validator copy, em dashes  
- Pre-ship: section 5 of `anti-slop.md`  
- Pragmatic audit notes: [`design-audit.md`](design-audit.md)

## 10. Design audit index

Per-screen do/don’t and a11y notes from the pragmatic polish pass: [`design-audit.md`](design-audit.md).

## 9. Review gate

Polishing reviews any new screen against this file and SPEC §10 before it can be marked `done`. If a needed pattern isn't covered here, extend this document first, then build.

**Audit trail:** Phase 3 design / responsive / a11y checklist results live in [`docs/design-audit.md`](design-audit.md) (P3-05–07).
