# Validator profile declutter — design

**Date:** 2026-08-04  
**Status:** Approved  
**Surface:** `client/src/validators/Profile.tsx` + `Evidence.tsx` (+ CSS)  
**Scope:** Client-only progressive disclosure. No API, wallet, or methodology changes.

## Goal

In ~3 seconds on a validator profile, the user should understand:

1. **Is this reliable?** — Official Nimiq Trust Score + Steakout payout observation status (co-equal).
2. **How do they compare (inline only)?** — Fee, payout type, schedule, stake dominance as plain facts (not ranks/percentiles).

Secondary detail remains available under collapsed sections.

## Approach

**Single-screen progressive disclosure** (not tabs). Default surface is sparse; Evidence, Canary, and Technical details use native `<details>` collapsed by default.

## Default layout (above the fold)

```
← Validators
[Listed] Name                              [Share]
short address (explorer link)

┌──────────────────────┬──────────────────────────┐
│ Official Trust Score │ Payout observation       │
│ large mono value     │ StatusChip               │
│ one-line caption     │ history depth caption    │
└──────────────────────┴──────────────────────────┘
one shared freshness / registry provenance for the hero

Fee · Type · Schedule · Dominance% of network   (policy strip)

[ Stake / Change CTA ]   ← moved up; same ProfileStakeCta logic

▸ Payout evidence        (collapsed; summary may show status · windows)
▸ Stakeout Findings      (if canary configured; summary = Verified when observed, else title only)
▸ Technical details      (collapsed)
```

## Hero rules

| Element | Behavior |
|---------|----------|
| Name | `h1` |
| Address | Short form + explorer; full spaced address in Technical details |
| Description / website | Technical details only |
| Share | Stay in header |
| Official score | Distinct info-tint styling (invariant #6). Caption: “Registry block-production score”. Value: existing profile formatter (honest insufficient if null). |
| Observation | StatusChip + “N days indexed” / insufficient history |
| Policy strip | Values only: fee (`formatDeclaredFee`), type, schedule, dominance (`X% of network`). No per-item status tags on the strip. |
| Stake CTA | Unchanged behavior; immediately under strip |

## Collapsed sections

### Payout evidence

- **Summary:** title + status · windows when known (e.g. `On schedule · 60/61 windows`) + optional history depth.
- **Expanded:** short lede; summary grid (history, windows, schedule, analysis window, last activity) with **one section-level freshness** (not per row); quieter run list (drop per-run definition + FreshnessTag; keep window, recipients, tx count, coverage, explorer links); methodology & limitations; load more.
- Keep loading observations on profile load so the closed summary can show windows without forcing open.

### Stakeout Findings / canary (only if configured)

- **Summary:** `Stakeout Findings` + `Verified` when a reward path has been observed; title only while still waiting (no “Watching” meta).
- **Expanded:** one headline + one sentence claim; nested “How we check” with methodology limits + Learn links.
- **Do not** surface probe address, stake amount, tx hashes, or payment amounts on this surface (ops detail only).
- Omit section if not configured.

### Technical details

- Full spaced address + explorer, website, description.
- Registry metrics (fee, type, schedule, dominance, total stake, stakers) with definition + DataStatusTag + section freshness.
- Reward address + explorer.
- Limitations / methodology links.

## Honesty / product invariants

- Official score never blended with observation.
- Neutral language only; no “best validator” / rankings / percentiles.
- When a metric is shown in expanded detail, keep definition + source/freshness (SPEC honest metrics). Hero strip may use titles/tooltips + Learn for definitions.
- SPEC §6.3 content remains on-page via progressive disclosure.

## Out of scope

- API/schema, directory redesign, peer comparison, deep-link `?evidence=1`, methodology changes.

## Files

- `client/src/validators/Profile.tsx` / `Profile.css`
- `client/src/validators/Evidence.tsx` / `Evidence.css`
- Prefer reusing `format.ts` for fee/dominance/type where display matches directory.

## Verification

- `npm run build`
- `npm run test:client` (or relevant unit tests)
- Manual: ~320px and desktop — hero answers reliability + compare + CTA without scrolling on typical phone
- Expand all three details; stake CTA still works
- anti-slop §5 self-check
