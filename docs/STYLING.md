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

`client/src/styles/nimiq.css`:

```css
/* Full framework: */
@import 'nimiq-css/css/index.css';

/* — or, if we want explicit layer control, the documented per-layer form:
@import 'nimiq-css/css/preflights.css' @layer nq-preflights;
@import 'nimiq-css/css/colors.css'    @layer nq-colors;
@import 'nimiq-css/css/fonts.css'     @layer nq-fonts;
@import 'nimiq-css/css/utilities.css' @layer nq-utilities;
*/

@import './tokens.css';
@import './base.css';
```

Import order matters: nimiq-css layers first, Steakout overrides last. `main.tsx` imports `styles/nimiq.css` once; no other global CSS entry points.

**Fonts (Vite):** place the nimiq-css font files in `client/public/assets/fonts/` (the documented default path): Mulish (variable weight) for UI text, Fira Mono for numbers/hashes. If `fonts.css` paths don't resolve, copy the documented `@font-face` blocks into `base.css` with corrected paths.

**Verify at install time (record results in this file):**
- Exact CSS custom property names exposed by the colors layer (`node_modules/nimiq-css/css/colors.css`)
- The typography class inventory (`nq-text-*` from the getting-started example is **unconfirmed** — check before use)
- The prose escape-hatch class (`nq-not-prose` vs `not-prose` — docs show both)
- Whether `index.css` includes typography/prose or only the four core layers

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

`tokens.css` defines Steakout semantic tokens (`--so-surface`, `--so-ink`, `--so-accent`, `--so-verified`, `--so-warn`, `--so-info`, …) referencing the nimiq-css palette variables. **Components consume `--so-*` tokens, never raw palette variables** — one mapping layer, one place to re-theme.

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

## 9. Review gate

Polishing reviews any new screen against this file and SPEC §10 before it can be marked `done`. If a needed pattern isn't covered here, extend this document first, then build.
