# Steakout anti-slop checklist (agents)

Ported from VeriLock `docs/journey-anti-slop.md` and rewritten for Steakout’s
product surface, tokens, and honesty rules. Load this **before any UI /
redesign / visual polish work**, together with:

| Doc | Why |
|-----|-----|
| **`docs/SPEC.md`** | Product law (non-custodial, review-before-confirm, honest metrics) |
| **`docs/STYLING.md`** | Binding design system (nimiq-css + `--so-*` tokens) |
| **`docs/METHODOLOGY.md`** | Observation language dictionary (neutral wording) |
| **`AGENTS.md`** | Team scope + product invariants |
| **This file** | Positive system, ban list, pre-ship self-check, ugly states |

**Surface:** `client/src/App.tsx`, `home/`, `validators/`, `activity/`, `learn/`,
`components/`, tokens in `client/src/styles/{tokens,base,nimiq}.css`.  
**Not the surface:** `/spike*` routes (throwaway harnesses; may look rough).

---

## 1. Workflow (do this order)

Do **not** jump to “make it pretty.” Use a critique loop:

```
intent → constraints → tokens/reference → one surface → visual review → reject/revise → systemize
```

1. **Intent** — Which screen? (Home state, Directory, Profile/Evidence, Activity, Learn, ReviewSheet.)
2. **Constraints** — Non-custodial; official Trust Score never replaced; no banned metrics (SPEC §4 / AGENTS §4).
3. **Positive reference** — Existing `--so-*` tokens + nimiq-css utilities (section 2). Do not invent a second palette.
4. **Negative reference** — Ban list (section 3) before coding decorative chrome.
5. **One surface** — One screen or component family; not a whole redesign pass in one shot.
6. **Review** — Section 5 self-check. Prefer scoped passes (“spacing only”, “contrast only”, “mono numerals only”).
7. **Ugly states** — Section 6 before calling it done.
8. **Systemize** — If a new pattern is good, encode it in `tokens.css` / co-located CSS, not a one-off.

**Context rule:** short prompt → long visual output is almost always slop. Prefer: paste the relevant component CSS, token block, and the ban list into the task rather than “restyle the home hero.”

---

## 2. Positive reference (what Steakout already is)

### Personality

Calm. Technical. **Instrument, not campaign.** Trust-first staking cockpit and
validator accountability layer — not a yield product, not crypto-casino chrome.

### Tokens (source of truth: `client/src/styles/tokens.css` + `STYLING.md`)

| Role | Tokens / values |
|------|-----------------|
| Fonts | UI: **Mulish**; numerals/hashes: **Fira Mono** (`--mono` / Fira faces in `base.css`) |
| Surfaces | Warm light: `--so-surface`, `--so-card`, soft `--so-rule` |
| Text | `--so-ink` / `--so-muted` (charcoal, not pure gray soup) |
| Accents | **Ember** brand sparingly (`--so-accent` / red scale); **blue** for links/info; **green** only for verified / on-schedule; **gold** for incomplete/irregular; **neutral** for insufficient/unavailable |
| Radius / space | `--so-space-*`, `--so-radius-*`, `--so-touch` (≥ 44px) |
| Shadows | Soft card depth only; no glow stacks |

Components consume **`--so-*` only** outside `tokens.css`. No raw palette vars in component CSS.

### IA (do not invent a fifth primary tab)

- Bottom nav: **Home · Validators · Activity · Learn**
- Validator path: Directory → Profile (summary + evidence) → (later) stake ReviewSheet
- Home states: Disconnected / Not staked / Staked
- Official Nimiq Validator Trust Score always captioned separately from Steakout observations

### Patterns that already work

- **One primary action** per screen; secondary stays secondary
- **Less is more** — clean display beats info overload (`STYLING.md` §8)
- **Minimum jargon** on primary surfaces; technical detail secondary or in Learn
- **Assist, don't decorate with data** — hide strictly informational fields that do not help the user act or understand their position
- **Status chips + definitions** (StatusChip + one-sentence affordance)
- **Honest empty / insufficient data** — never invent 0%, never “missed payment”
- **Mono for amounts, hashes, blocks, timestamps**
- **nimiq-css** cards/pills/labels — do not reimplement with ad-hoc chrome

### When you need external taste

Prefer real shipped product patterns over AI galleries:

1. Existing Steakout screens + `docs/design-audit.md`
2. VeriLock plain CSS component craft (structure only; not navy/mint brand)
3. Nimiq product UI / nimiq-css examples as structure inspiration

Do **not** free-range “best crypto staking dashboard 2026” prompts into product chrome.

---

## 3. Negative reference (ban list)

If a change would make someone say “AI made this SaaS / crypto site,” reject it.

### Absolute bans (do not introduce)

| Ban | Why |
|-----|-----|
| Purple / violet → blue **hero gradients** as default chrome | Generic AI SaaS tell; Steakout is warm light + ember sparingly |
| **Inter** / generic system-only “startup sans” as the design system | We self-host Mulish + Fira Mono |
| Sparkle ✨ / 🚀 / “AI-powered” decorative emoji in product chrome | Noise; not trust |
| Fake testimonials or “trusted by” logos | Not our product model |
| Three identical icon + title + blurb **feature cards** as home IA | Home is position / connect state, not a marketing grid |
| Vague **“Get started”** as the only primary CTA | Name the real step: Connect, Choose a validator, View record, Review stake |
| Glassmorphism **everywhere** (blur stacks on every panel) | Mobile GPU flash; wrong register |
| Gradient **text** on body copy / every heading | Never |
| Side-stripe accent borders (`border-left: 3px+` color bars) on **every** card | Saturated AI scaffold — reserved only for intentional observation/official separation, not decoration |
| Tiny uppercase tracked **eyebrow on every section** | AI grammar; use sparingly for real product kickers |
| Numbered `01 / 02 / 03` eyebrows on every section | Only when order is a real product sequence |
| Crypto-neon, glass hexagons, “web3 yield” gimmick, confetti, dark cyber grids | Wrong positioning (SPEC §10) |
| Cream/sand/parchment **full-app** “for warmth” re-theme without token system | Use `--so-surface` only; no second theme |
| New font families without an explicit brand request | Token drift |
| Nested cards inside cards for decoration | Lazy hierarchy |
| **Guaranteed APY**, “best validator”, fraud scores, “paid everyone” | Product invariant + METHODOLOGY ban |
| Em dashes (U+2014) in user-facing copy | Prefer commas or periods (VeriLock house rule; keep here) |

### Allowed only when already intentional (do not expand)

- Soft card shadow on `nq-card` — depth, not glow
- Ember on **active nav** and rare brand kickers only
- Left-border tone on profile observation section (status separation, not every list card)
- nimiq-css hover utilities on directory cards — enhancement, never the only affordance

### Copy bans

- Accusatory payout language (“missed”, “withheld”, “scam”, “fraud”)
- Precision theater (`96.428571%` when data is `27/28 windows`)
- Absolute security or legal claims
- Site-name CTAs as empty product copy

---

## 4. Rejection criteria (write these before generating)

Before a visual pass, answer:

1. **What must stay recognizable** as Steakout (warm instrument, ember sparingly, official score ≠ observation)?
2. **What would make this feel generic AI SaaS / crypto dashboard?** (list 3 tells to ban for this task)
3. **What is the one primary action** on this screen?
4. **Does this still obey** SPEC invariants + METHODOLOGY language?
5. **Would a staker on a 320px phone trust this** in 10 seconds, or pause at weird chrome?

If you cannot answer (1)–(3), do not generate UI.

---

## 5. Pre-ship self-check (agent taste checklist)

Run before marking UI work done. Prefer scoped iterations if something fails.

### Identity

- [ ] Uses `--so-*` tokens; no one-off hex rainbow outside `tokens.css`
- [ ] Mulish for UI; Fira Mono for amounts / hashes / blocks / timestamps
- [ ] Ember only on primary moments and active nav — not decorative fills everywhere
- [ ] Still reads as **staking instrument**, not purple SaaS or neon crypto

### Hierarchy & layout

- [ ] One clear primary CTA; secondary actions look secondary
- [ ] Less is more: no strictly-informational clutter; clean display over info overload
- [ ] Jargon minimized on primary surfaces (technical detail progressive-disclosed or Learn)
- [ ] Bottom nav destinations intact (no fifth mystery tab)
- [ ] Official Trust Score visually distinct from Steakout observation
- [ ] Spacing has rhythm (not equal 16px soup and not random gaps)
- [ ] No identical three-card marketing grid replacing product states
- [ ] Long names, huge balances, narrow viewports do not overflow (320px)

### Product trust

- [ ] Non-custodial / review-before-confirm remains obvious where stake actions appear
- [ ] Every metric has definition + source + freshness or status label
- [ ] Error, loading, empty, stale, offline states exist for new controls
- [ ] Focus rings and keyboard paths work for nav, CTAs, filters, evidence links

### Motion & polish

- [ ] Motion is state feedback (150–250ms), not page-load choreography
- [ ] `prefers-reduced-motion` respected for anything new
- [ ] No new animated blur stacks

### The slop test

- [ ] Someone could **not** immediately tag this as “default AI landing”
- [ ] Someone fluent in good tools would **not** pause at every control as “off”

---

## 6. Ugly states (must test)

AI is good at the ideal screenshot. Product design is the rest:

| State | Check |
|-------|--------|
| Empty | No wallet; no validators (filter); no runs; no activity |
| Loading | Position, directory, evidence, activity |
| Error | RPC unavailable, rate limit, session expired, not found |
| Stale | Indexer watermark old — banner, not full-screen alarm |
| Long copy | Long validator names, long limitations keys, long errors |
| Huge / tiny amounts | ≥ 9 digit NIM; sub-1 NIM |
| Missing logo | Initials / placeholder, no broken image layout |
| Mobile 320 | Nav, cards, CTAs, evidence rows, Learn prose |
| Reduced motion | No required animation to understand state |
| Disconnected vs connected | Home states; Activity personal tab |

---

## 7. Redesign routing

| Task | Load |
|------|------|
| Any visual restyle | `STYLING.md` → this file → edit only the owned screen/components |
| Copy pass | `METHODOLOGY.md` language dictionary → this file §3 copy bans |
| Evidence / status UI | `METHODOLOGY.md` + official-vs-observed rule before chrome |

**Product honesty wins over aesthetics.** If a visual idea conflicts with SPEC/METHODOLOGY, drop the visual idea.

---

## 8. Minimal agent prompt block (copy into UI tasks)

```
You are editing Steakout production SPA only (client/src home/validators/activity/learn/components/styles).

Positive system:
- Light instrument UI: tokens in client/src/styles/tokens.css + nimiq-css
- Fonts: Mulish UI, Fira Mono amounts/hashes
- Accent: ember sparingly; green = verified/on-schedule only
- IA: Home / Validators / Activity / Learn; official Trust Score ≠ Steakout observation
- Personality: calm, technical, trust-first; task UI not campaign landing
- SPEC + METHODOLOGY are mandatory

Negative bans:
- No purple SaaS gradients, Inter-as-brand, sparkle/emoji chrome, fake testimonials
- No three-card generic feature grids, vague "Get started", glass everywhere
- No crypto-neon gimmick; no new fonts; no nested decorative cards
- No guaranteed APY / best validator / accusatory payout copy; no em dashes

Workflow:
- intent → constraints → tokens → one surface → review checklist → ugly states
- One primary action per screen; honest empty/insufficient-data states
- Scope changes (e.g. spacing only) when iterating

Done only when docs/anti-slop.md section 5 passes.
```

---

## Related

- Spec: [`SPEC.md`](SPEC.md)
- Styling contract: [`STYLING.md`](STYLING.md)
- Methodology / language: [`METHODOLOGY.md`](METHODOLOGY.md)
- Design audit (pragmatic pass notes): [`design-audit.md`](design-audit.md)
- Agents entry: [`../AGENTS.md`](../AGENTS.md)
- Provenance: adapted from VeriLock `docs/journey-anti-slop.md`
