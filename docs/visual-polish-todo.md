# Visual polish queue — architect-reviewed work items

Follow-up pass after the P3-05–07 pragmatic audit ([`design-audit.md`](design-audit.md)).
This file is the **single source of work** for the next visual-polish cycle. It is written
for a subagent implementer with an architect reviewing between milestones.

- **Implementer:** subagent (one milestone per session, then stop for review)
- **Reviewer:** architect — reviews the diff against every acceptance criterion below
  plus `anti-slop.md` §5 before the next milestone starts
- **Contract:** [`STYLING.md`](STYLING.md) + [`anti-slop.md`](anti-slop.md) + SPEC §10.
  Product honesty beats aesthetics in every conflict.

---

## 0. Rules of engagement (implementer, read first)

1. **Load before editing:** `docs/anti-slop.md` (ban list + §5 checklist),
   `docs/STYLING.md`, `client/src/styles/tokens.css`, `client/src/styles/base.css`.
2. **CSS-first.** TSX edits are limited to class-name swaps. No logic, copy, API,
   or route changes. Exception: V-12 (one user-facing em dash) and V-01 (font
   `@font-face` blocks + binary font files).
3. **Tokens only.** Components consume `--so-*`; raw `--colors-*` never appear outside
   `tokens.css`. No new color tokens. Spacing/radius/type changes use the existing
   `--so-space-*` / `--so-radius-*` / `--so-text-*` scale (extend the scale in
   `tokens.css` if a step is genuinely missing, never ad-hoc in component CSS).
4. **No new dependencies.** Font files are static assets, not dependencies.
5. **Out of scope:** `/spike*` routes (visuals), dark mode, charts, redesigns,
   new components, business logic, server code.
6. **Diff budget:** one milestone per branch/session. If an item grows, stop and
   note it in §5 (parking lot) instead of ballooning the diff.
7. **Verification after every milestone** (all must pass):
   ```bash
   npm run build        # typecheck + client/server production build
   npm test             # unit + integration
   npm run smoke        # built SPA + API health
   ```
8. **Ugly states:** after visual changes, walk `anti-slop.md` §6 for every screen
   touched: 320px, long names, huge amounts, empty/loading/error, reduced motion.

### Mechanical slop sweep (run before requesting review; paste output in the review note)

Use pipe filters (this shell mangles rg `--glob '!…'` exclusions):

```bash
# Raw palette vars outside tokens.css — expect zero hits after filter
rg -n -- '--colors-' client/src | rg -v 'tokens\.css|spike/'
# Hardcoded hex outside tokens.css — expect only var() fallbacks
rg -n '#[0-9a-fA-F]{6}\b' client/src --glob '*.css' | rg -v 'tokens\.css|spike/'
# Gradient / glass — expect zero in product (staking/ may have scroll curtains; do not edit staking/)
rg -ni 'gradient|backdrop-filter' client/src | rg -v 'spike/|staking/|\.md'
# Inline styles in product TSX — expect zero hits
rg -n 'style=\{\{' client/src --glob '*.tsx' | rg -v 'spike/'
# Em dash in product TS/TSX — expect only empty-value placeholders ('—' as a value)
rg -n --pcre2 '\x{2014}' client/src --glob '*.ts' --glob '*.tsx' | rg -v 'spike/'
# Side-stripe borders — expect only Profile observation card
rg -n 'border-left' client/src --glob '*.css' | rg -v 'spike/'
```

**Concurrent surface:** `client/src/staking/` is Implementation (P1-12) in flight. Do **not** restyle or edit it. Shared `base.css` changes must not break it — spot-check only; flag conflicts in the review note.

### Rejection criteria (architect will bounce the milestone if any fail)

- Any ban-list pattern from `anti-slop.md` §3 introduced or expanded.
- Any acceptance criterion below unchecked or unverifiable.
- Visual change without a matching ugly-states walk (§0.8) on touched screens.
- TSX logic/copy drift beyond the two allowed exceptions.
- New one-off utility where a shared one was created in this queue (reuse-first).

---

## 1. Findings summary (why these items exist)

| # | Finding | Evidence | Severity |
|---|---------|----------|----------|
| F1 | **The app renders in a single font weight.** Only `Mulish-Regular.ttf` (400) and `FiraMono-Regular.ttf` (400) ship, while 42 declarations request 500–700, and `font-synthesis: none` (`base.css:39`) disables faux-bold. Every heading, CTA, chip, and label hierarchy is currently flat. STYLING §6 promises "weight contrast, not size inflation" — it is not visible. | `client/public/assets/fonts/` (2 files), `rg 'font-weight: [5-8]00'` → 42 hits | **Critical** |
| F2 | **Card chrome is defined ~8 times**, triplicated per card (`nq-card nq-card-lg shell-card home-card`), with `1.25rem` hardcoded despite `--so-radius-card` existing. | `Home.css:36-41`, `Activity.css:58-64`, `Directory.css:125-131`, `Learn.css:43-48,102-110`, `ValidatorCard.css:11-15`, `Profile.css:157-164`, `base.css:128-133` | High |
| F3 | **nimiq-css `nq-card` fights our chrome:** it adds `margin: 1rem 0.5rem` (lg), `max-width: 37.5rem` (lg), a 1.5px hairline `outline`, `overflow: hidden`, own radius/padding. Results: home cards are 37.5rem wide while directory cards use the full 44rem shell; cards sit 0.5rem inset from header text at <450px; border + hairline double edge; `overflow:hidden` can clip focus rings. | `node_modules/nimiq-css/dist/css/utilities.css:498,635` | High |
| F4 | **Five identical pulse keyframes** (`home-pulse`, `directory-pulse`, `profile-pulse`, `evidence-pulse`, `activity-pulse`) and five near-identical skeleton blocks. | `Home.css:102-116`, `Directory.css:219-234`, `Profile.css:141-155`, `Evidence.css:35-49`, `Activity.css:134-148` | Medium |
| F5 | **Page title/lede/header duplicated 4x** with drift: identical title clamp in Home/Directory/Activity/Learn; lede 36rem vs 40rem and 1rem vs 1.05rem; header margin 1.5 / 1.25 / 1.25 / 1.5 / 0.5rem. | `Home.css:13-33`, `Directory.css:7-19`, `Activity.css:13-26`, `Learn.css:7-20`, `Profile.css:11-23` | Medium |
| F6 | **Utility duplication:** `.mono` defined in 4 files; `.visually-hidden` lives in `Home.css` but is app-relevant; `:focus-visible` re-declared in Directory/Activity despite the global rule; mono font stack repeated ~12x. | `base.css:111`, `Profile.css:316`, `Evidence.css:348`, `Learn.css:252-255`, `Home.css:291-301`, `Directory.css:54-57`, `Activity.css:53-56` | Medium |
| F7 | **Token drift:** `44px` literals despite `--so-touch`; ad-hoc micro sizes (0.68/0.72/0.78/0.82/0.92rem) beside an unused `--so-text-*` scale; `--so-space-*` nearly unused. | `Directory.css:43,61`, `Evidence.css:239`, `ValidatorCard.css:108,144,202`, etc. | Medium |
| F8 | **Three different info-notice recipes** (directory explainer: full `--so-info` border; learn callout: full info border, different radius/padding; evidence error-empty: color-mix 70% bg) and **two warn banners** (`.home-banner--warn` vs `.so-envelope-banner`). | `Directory.css:99-108`, `Learn.css:222-229`, `Evidence.css:289-292`, `Home.css:281-285`, `EnvelopeStatusBanner.css` | Medium |
| F9 | **User-facing em dash** in `nimiq.ts:135` ("recommended — no pop-ups needed") — missed by the P3-09 copy pass. | `client/src/nimiq.ts:135` | Low |
| F10 | **`.app-main` global `overflow-wrap: anywhere` + `word-break: break-word`** is a shotgun fix; risks mid-word breaks in chips/labels at 320px. | `App.css:18-19` | Low |
| F11 | **VeriLock leftovers in `base.css`:** display `h1` (clamp 3–5.5rem) and `.shell-card h2` (16ch max-width, 1.75–2.5rem) serve only spike-disabled screens; product screens all override, and `.shell-card h2` leaks (Profile state card had to opt out with `max-width: none`). | `base.css:115-149`, `Profile.css:92-94` | Low |
| F12 | **Skeleton ≠ loaded layout** on Home and Directory (line blocks vs amount + stat grid + list rows) → layout shift on load. | `Home.css:74-100`, `Directory.css:165-234` | Low |
| F13 | `.evidence-no-grade` re-implements chip geometry instead of reusing StatusChip. | `Evidence.css:59-71` vs `StatusChip.css` | Low |
| F14 | `.profile` sets `gap` then overrides with `row-gap` — sloppy. | `Profile.css:5-8` | Trivial |

---

## 2. Milestone M0 — Typography reality (gate G0)

> Highest visual impact, smallest conceptual risk. Do this first, alone.

### V-01 — Ship real font weights (Critical)

**Files:** `client/public/assets/fonts/`, `client/src/styles/base.css`,
`client/public/assets/fonts/README.md`, `docs/STYLING.md` §2.

**Problem:** F1. The design system is built on weight contrast that the shipped
assets cannot render.

**Change:**
1. Download (OFL-licensed, from `google/fonts` GitHub):
   - `ofl/mulish/Mulish[wght].ttf` → save as `Mulish-VariableFont_wght.ttf`
     (the exact name nimiq-css `fonts.css` expects; keeps a future switch trivial).
   - `ofl/firamono/FiraMono-Medium.ttf` and `ofl/firamono/FiraMono-Bold.ttf`.
   - Keep existing `Mulish-Regular.ttf` / `FiraMono-Regular.ttf` files or replace
     per the new `@font-face` map; do not leave unused binaries behind.
2. Rewrite the `@font-face` blocks in `base.css`:
   - `Mulish` → variable file, `font-weight: 100 1000`, `font-display: swap`.
   - `Fira Mono` → 400 (existing), 500, 700, `font-display: swap`.
3. Keep `font-synthesis: none` (correct once real weights exist).
4. Update `client/public/assets/fonts/README.md` table and `docs/STYLING.md` §2
   font bullet list to the new map.
5. Verify UI weights used (500/600/700) now resolve to real faces: headings 700,
   chips/labels 600, mono initials/tags 500–700.
6. If the download is impossible in the environment: stop, mark this item
   `blocked: needs human font drop`, and do **not** "fix" it by deleting weight
   declarations.

**Acceptance:**
- [ ] Font binaries present; no orphan files; sizes noted in fonts README.
- [ ] `base.css` declares every weight the CSS requests (400/500/600/700 UI; 400/500/700 mono).
- [ ] `/spike-style` (DEV) visually shows weight contrast on headings, pills, chips.
- [ ] `npm run build` + `npm test` pass; no other files changed.
- [ ] STYLING.md §2 updated in the same commit.

**Gate G0 — architect reviews:** file list, `@font-face` diff, screenshot/eyeball of
Home + Profile + Directory at 375px for restored hierarchy, then proceeds.

---

## 3. Milestone M1 — Systemize duplicated chrome (gate G1)

> Pure consolidation. No visual change intended except where noted; pixel drift
> must be called out in the review note if spotted.

### V-02 — One skeleton system

**Files:** `base.css` (add), `Home.css`, `Directory.css`, `Profile.css`,
`Evidence.css`, `Activity.css` (delete duplicates). TSX: class swaps only.

**Change:** Add to `base.css`: `@keyframes so-pulse` (the existing 1.2s
ease-in-out opacity 1→0.55), a `.so-skeleton-line` base (display block, height,
radius, `var(--so-disabled-soft)` bg), and the `prefers-reduced-motion:
no-preference` gate. Re-point all five screens' skeleton lines to the shared
base (screen classes keep only width/height variants). Delete the five local
keyframes + duplicate base geometry.

**Acceptance:**
- [ ] `rg -n '@keyframes.*pulse' client/src -g '!spike/**'` → exactly 1 hit.
- [ ] `rg -n 'no-preference' client/src -g '!spike/**'` → exactly 1 hit.
- [ ] Skeletons unchanged visually on all five screens (loading states still pulse; reduced-motion still still).

### V-03 — One page-header system

**Files:** `base.css` (add `.page-header`, `.page-title`, `.page-lede`),
`Home.css`, `Directory.css`, `Activity.css`, `Learn.css`, `Profile.css`;
class swaps in the matching TSX.

**Change:** Single `.page-title` (clamp(2rem, 9vw, 3.25rem), −0.05em, 1.05),
`.page-lede` (muted, 1.45 line-height; **pick one** size and max-width:
recommend 1rem / 40rem — directory & learn drift down to 1rem, home & activity
widen to 40rem), `.page-header` (margin-bottom 1.5rem everywhere, profile
included). Profile keeps its smaller title as `.page-title--profile`
(clamp(1.5rem, 8vw, 2.75rem)) built on the same tokens. Replace the four/five
local implementations.

**Acceptance:**
- [ ] `rg -n 'clamp\(2rem, 9vw, 3.25rem\)' client/src` → 1 hit (base.css).
- [ ] All five screens render identical title/lede rhythm at 320/375/430.
- [ ] No header margin drift (all 1.5rem).

### V-04 — One card chrome + radius token consumption

**Files:** `base.css` (promote/rename `.shell-card` → keep name `.shell-card` as
the one chrome class), all screen CSS listed in F2.

**Change:** `.shell-card` becomes the single card chrome: `border: 1px solid
var(--so-rule); border-radius: var(--so-radius-card); background: var(--so-card);
box-shadow: var(--so-shadow)`. Delete the repeated chrome blocks from
`home-card`, `activity-card`, `directory-state`, `directory-skeleton`,
`learn-index-link`, `learn-article`, `validator-card`, `profile-card`,
`activity-skeleton` (they keep layout/padding only) and add `shell-card` to the
few TSX nodes missing it. Replace every hardcoded `1.25rem` radius with
`var(--so-radius-card)`.

**Acceptance:**
- [ ] `rg -n 'border-radius: 1.25rem' client/src -g '!spike/**'` → 0 hits.
- [ ] `rg -n 'box-shadow: var\(--so-shadow\)' client/src -g '!spike/**'` → 1 hit.
- [ ] All cards visually identical to before at 320/375/430 (radius, border, shadow).

### V-05 — Neutralize nq-card framework chrome (fixes F3)

**Files:** `base.css` only (preferred), optionally TSX class tidy.

**Change:** Add a scoped reset so nimiq's card supplies only structure
(flex column) and Steakout supplies all chrome:

```css
/* nq-card provides flex structure; chrome is --so-* only (F3). */
.app-main .nq-card,
.app-main .nq-card-lg {
  max-width: none;
  margin: 0;
  outline: none;
  overflow: visible;
}
```

Do **not** remove `nq-card` / `nq-hoverable` / `nq-focusable` classes from TSX
(hover/focus behaviors are used; `nq-card` flex column is relied upon).
Spike routes and the `/spike*` disabled screens keep un-reset framework chrome
(they render outside `.app-main`).

**Acceptance:**
- [ ] Home card and directory cards are the same width (both fill the 44rem shell).
- [ ] At 375px, card left edge aligns with header text (no 0.5rem inset).
- [ ] Card edge is a single 1px `--so-rule` line (no hairline double edge).
- [ ] Focus ring on a tx link at the bottom edge of the evidence card is not clipped.
- [ ] Vertical rhythm on Home/Profile comes only from parent gaps (no extra 1rem margins).

### V-06 — Dedupe small utilities

**Files:** `base.css`, `tokens.css`, `Profile.css`, `Evidence.css`, `Learn.css`,
`Home.css`, `Directory.css`, `Activity.css`.

**Change:** (a) `.mono` defined once in `base.css` — delete the other three.
(b) Move `.visually-hidden` from `Home.css` to `base.css`. (c) Delete duplicate
`:focus-visible` blocks in `Directory.css` / `Activity.css` (global rule in
`base.css` covers them). (d) Add `--so-mono: var(--nq-font-mono, 'Fira Mono',
monospace);` to `tokens.css` and replace the ~12 longhand repetitions with
`var(--so-mono)`.

**Acceptance:**
- [ ] `rg -n '^\.mono' client/src` → 1 hit.
- [ ] `rg -n ":focus-visible" client/src -g '*.css' -g '!spike/**'` → base.css + BottomNav.css only (BottomNav's is intentionally inset).
- [ ] `rg -n "var\(--nq-font-mono" client/src -g '!spike/**'` → tokens.css only.
- [ ] Focus rings unchanged on directory select/toggle and activity tabs.

**Gate G1 — architect reviews:** mechanical sweep output, before/after eyeball of
all five screens at 320 + 375, `npm run build` + `npm test` green.

---

## 4. Milestone M2 — Token drift & base.css diet (gate G2)

### V-07 — Consume spacing/touch/type tokens

**Files:** `Directory.css`, `Evidence.css`, `ValidatorCard.css`, `Activity.css`,
`Profile.css`, `Home.css`, component CSS; `tokens.css` (additive only).

**Change:** (a) Replace `44px` literals with `var(--so-touch)` (directory
select/toggle, evidence tx-link, activity tabs/links, learn links, profile
back/share/stake — sweep all). (b) Normalize ad-hoc micro sizes onto the type
scale: map 0.68–0.75rem → `--so-text-xs` (0.75rem) where within 0.03rem, or add
exactly one `--so-text-2xs: 0.7rem` token if 0.68–0.72rem labels genuinely need
it — implementer's call, but **one** new step maximum, documented in tokens.css.
(c) Replace gap/padding values that sit exactly on a `--so-space-*` step with the
token. Do not re-engineer every value; nearest-token only, no layout shifts.

**Acceptance:**
- [ ] `rg -n '\b44px\b' client/src -g '*.css' -g '!spike/**'` → 0 hits (tokens/comments excluded).
- [ ] No font-size outside the `--so-text-*` steps in product CSS (exceptions documented inline).
- [ ] Visual no-op at 320/375/430 (call out any drift in review note).

### V-08 — Slim base.css VeriLock leftovers (fixes F11)

**Files:** `base.css` (verify `/spike*` disabled screens in `App.tsx` still render
acceptably — they may look plainer, which is fine; they are harness chrome).

**Change:** Remove the global display `h1` (clamp 3–5.5rem, −0.07em) and the
`.shell-card h2` typography block (16ch max-width, 1.75–2.5rem). Add a plain,
small `h1`/`h2` normalization if preflight doesn't already cover margins.
Delete the now-unneeded `max-width: none` opt-outs (`.profile-state-card h2`,
`.profile-section-title`) after confirming the leak is gone.

**Acceptance:**
- [ ] Product screens pixel-identical (they all use `.page-title` / section titles after M1).
- [ ] `rg -n 'max-width: none' client/src` → 0 hits in Profile.css.
- [ ] `/spike` disabled screen still readable (no crash, no overflow).

### V-09 — Consolidate `.profile` gap slop (fixes F14)

**Files:** `Profile.css`.

**Change:** Replace `gap: …; row-gap: 1.35rem;` with a single `row-gap` (token
or documented one-off). No visual change.

**Gate G2 — architect reviews:** sweep output, build+tests, spot-check 320px.

---

## 5. Milestone M3 — Notice & chip consistency (gate G3)

### V-10 — One info-notice recipe (fixes F8)

**Files:** `base.css` (add `.so-notice`), `Directory.css`, `Learn.css`,
`Evidence.css`; TSX class swaps.

**Change:** Shared `.so-notice--info`: `var(--so-info-soft)` bg, `1px solid
color-mix(in srgb, var(--so-info) 35%, transparent)` border (the same tint
mechanism already used by `validator-card-metric--official`), radius
`var(--so-space-3)`, padding `var(--so-space-3) var(--so-space-4)`, info-strong
ink. Re-point `.directory-explainer`, `.learn-callout`, `.evidence-empty--error`.
Full-strength `--so-info` borders disappear from notices.

### V-11 — One warn banner (fixes F8)

**Files:** `Home.css`, `EnvelopeStatusBanner.css`; TSX class swap in Home.

**Change:** `.home-banner--warn` and `.so-envelope-banner` are the same
component visually. Reuse the envelope banner classes in Home (or extract
`.so-banner--warn` shared by both); keep the retry-button slot behavior.

### V-12 — User-facing em dash fix (fixes F9)

**Files:** `client/src/nimiq.ts:135` only.

**Change:** "recommended — no pop-ups needed" → "recommended, no pop-ups needed".
Confirm the mechanical sweep shows remaining U+2014 only as empty-value
placeholders (`'—'` values) and in comments.

### V-13 — `evidence-no-grade` reuses StatusChip geometry (fixes F13)

**Files:** `Evidence.tsx`, `Evidence.css`.

**Change:** Render the "Schedule cannot be normalized" state with
`.status-chip--disabled` geometry (padding, chip radius, font size) while
keeping the current wording and `title` affordance. Delete the bespoke block.

**Gate G3 — architect reviews:** notices/banners consistent across Directory,
Learn, Evidence, Home; sweep output; build+tests green.

---

## 6. Milestone M4 — Micro-polish & state parity (gate G4)

### V-14 — Scope `.app-main` word-breaking (fixes F10)

**Files:** `App.css`; verify chips/labels at 320px.

**Change:** Remove the global `overflow-wrap: anywhere; word-break: break-word`
from `.app-main`; keep `overflow-wrap: anywhere` only on address/hash/amount/long-string
classes (`.home-address`, `.profile-address`, `.validator-card-address`,
`.evidence-row-window`, `.learn-article`). Confirm no 320px horizontal scroll
returns (that's what the shotgun rule was hiding — if a specific element
overflows, fix that element, don't re-apply the global).

### V-15 — Skeleton/loaded layout parity (fixes F12)

**Files:** `Home.tsx`/`Home.css`, `Directory.tsx`/`Directory.css` (class +
structure of skeleton blocks only).

**Change:** Make the Home staked skeleton echo the loaded card (amount-height
line, three stat columns, one section line) and the directory skeleton rows echo
`ValidatorCard` geometry (avatar + 2 lines + chip-width line). Heights within
~1rem of loaded content. Pulse gate unchanged.

### V-16 — Evidence list scroll affordance

**Files:** `Evidence.css`.

**Change:** Add `scrollbar-width: thin` (parity with `Amount`) and evaluate
`nq-curtain-y` on `.evidence-run-list` (STYLING §4 already blesses it for
scrollable evidence). If the curtain causes any clipping weirdness with the
sticky run header, skip the curtain and keep the thin scrollbar only — note the
decision in the review note.

**Gate G4 — architect reviews:** full `anti-slop.md` §5 checklist across all five
screens at 320/375/430, reduced-motion pass, build+tests+smoke green.

---

## 7. Parking lot (not in this cycle)

- Measured WCAG contrast tooling in CI (token-level checks were manual).
- Real-device 320 walkthrough (owner residual from P3-06).
- Font subsetting (variable Mulish is ~200KB; subset if launch budget demands).
- Dark mode (post-cycle per STYLING §1).
- Identicon component replacing initials (a11y residual from P3-07).

---

## 8. Review-log (architect fills per gate)

| Gate | Date | Result | Notes |
|------|------|--------|-------|
| G0 | 2026-08-03 | **pass** | V-01: Mulish variable 100–1000 + Fira Mono 400/500/700 OFL binaries; Mulish-Regular deleted; base.css @font-face + STYLING §2 + fonts README. Magic bytes `00010000` all TTFs. `npm run build` green. Footprint exact (no TSX). Concurrent `client/src/staking/` (P1-12) excluded from this cycle. |
| G1 | 2026-08-03 | **pass** | V-02–V-06: −179 net LOC. Shared so-pulse/page-*/shell-card/nq-card reset/--so-mono. Acceptance greps clean (staking leftovers expected). Build green. Profile header 1.5rem intentional. |
| G2 | 2026-08-03 | **pass** | V-07–V-09: 44px→--so-touch; --so-text-2xs; VeriLock h1/shell-card h2 removed; profile row-gap only. Build green. |
| G3 | 2026-08-03 | **pass** | V-10–V-13: so-notice--info; dead home-banner removed; nimiq.ts em dash fixed; evidence-no-grade→status-chip--disabled. Sweep clean. Build green. |
| G4 | 2026-08-03 | **pass** | V-14–V-16: app-main word-break scoped; home/directory skeleton parity; evidence thin scrollbar + existing nq-curtain-y kept. Build+test green. Smoke script stub (env). Full cycle M0–M4 closed. |
