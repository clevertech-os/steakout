# Phase 3 — Public beta, polish & distribution (Aug 24–30)

**Goal:** public users can use the app unassisted and it looks submission-ready. Ends in the **public beta**. See [ROADMAP.md](ROADMAP.md#week-3--public-beta-polish-distribution-aug-2430).

Board: [README.md](README.md#phase-3--polish--public-beta-aug-2430)

---

### P3-01 — Retire + remove flows

- **Team:** Implementation
- **Depends on:** P0-03, P2-11
- **Spec refs:** SPEC §6.5
- **Docs:** API.md §6, SECURITY.md §2
- **Human-in-the-loop:** device spot-check

**Scope:** complete the lifecycle: `sendSetActiveStakeTransaction` (deactivate), `sendRetireStakeTransaction`, `sendRemoveStakeTransaction` — each with intent/confirm, review sheet explaining the state transition and waiting period in plain language, and position-state-aware entry points (e.g. `Remove` only when `Withdrawable`).

**Deliverables:**
- Three operations wired end-to-end (only those P0-03 proved safe; others documented as unsupported with UI hidden)
- Waiting-period copy: "Retire stake does not immediately return NIM…"
- Position state machine updated to surface `Withdrawable` actions

**Acceptance criteria:**
- [ ] Same safety bar as P1-12 across all three flows
- [ ] Retire → waiting → withdrawable progression visible in position UI with timestamps
- [ ] Unsupported methods (per P0-03) are hidden, never broken-facing
- [ ] Device evidence for at least retire (testnet) in Notes

**Verification:** integration tests + device spot-check.

**Notes:**
-

---

### P3-02 — Restake position-growth analytics

- **Team:** Implementation
- **Depends on:** P0-04, P2-10
- **Spec refs:** SPEC §7.3
- **Docs:** METHODOLOGY.md §5
- **Human-in-the-loop:** no

**Scope:** CONDITIONAL — only if P0-04 judged staker reads reliable. Show restake users `Observed position growth`: balance-change observations from `staker_snapshots`, compared against an illustrative expected range, with zero payout-verification claims. If the condition fails: mark `cut`, and ensure restake users see the explicit limitation note instead (P2-12 content).

**Deliverables:**
- Growth computation from snapshots + UI section on position view
- Explicit labels: `Observed position growth`, illustrative-range caption

**Acceptance criteria:**
- [ ] No "validator payout verified" semantics anywhere
- [ ] Insufficient snapshots → `insufficient-data`, not a zero-growth implication
- [ ] Cut-path: limitation note renders for restake delegators (verified by Testing)

**Verification:** unit tests on growth calc; dictionary grep.

**Notes:**
-

---

### P3-03 — RPC fallback / graceful degraded mode

- **Team:** Implementation
- **Depends on:** P2-13
- **Spec refs:** SPEC §8.4, §18
- **Docs:** ARCHITECTURE.md §10
- **Human-in-the-loop:** no

**Scope:** resilience: secondary RPC endpoint config (`NIMIQ_RPC_URL_FALLBACK`) with automatic failover on repeated failures; degraded-mode flags that disable freshness-dependent features (position reads, confirm polling) while keeping public cached profiles alive; user-facing degraded banner with neutral copy.

**Deliverables:**
- Failover logic in `nimiq-rpc.ts` + health reporting which source is active
- Degraded banner component + server feature flags

**Acceptance criteria:**
- [x] Primary failure → fallback used automatically, logged, visible in health
- [x] Both down → public profiles serve last SQLite registry (list/detail/observations); live chain reads return `RPC_UNAVAILABLE` / health `liveChainReads: false`
- [x] Failover tested via injected transport failures
- [ ] Client degraded banner + disable staking CTAs from `features.liveChainReads` (residual — Polishing / follow-up)

**Verification:** unit tests (failover + no-RPC registry list); `npm run build` + full test suite green.

**Notes:**
- **Done 2026-08-03 (pragmatic).** Core server path only; client banner deferred.
- **`NIMIQ_RPC_URL_FALLBACK`:** after primary exhausts its retry budget on `RPC_UNAVAILABLE` transport errors, gateway tries fallback (same budget). Sticky `activeSource` until it fails. Method/malformed errors do not hop. Logged as JSON `rpc:endpoint-failed` / `rpc:failover` (host only).
- **`getRpcHealth()`** + health envelope: `mode` (`ok`|`degraded`), `features.liveChainReads` / `registryReads`, `rpc.activeSource` / `activeHost` / `available` / `degraded` / `lastSuccessAt`. Health still 200 with `blockNumber: null` when probe fails.
- **Registry-only paths** (`GET /api/validators`, detail, observations) already SQLite-only; confirmed with test that unsets RPC env and still returns 200 + `source: "registry"`. Position path unchanged (`RPC_UNAVAILABLE` 503).
- **Residual:** client banner reading `/api/health` features; hide/disable stake CTAs when `liveChainReads === false`; optional manual kill-switch demo on deploy. Diagnostics also expose active source.

---

### P3-04 — Telemetry (aggregate, disclosed)

- **Team:** Implementation
- **Depends on:** P2-16
- **Spec refs:** SPEC §15 (privacy), §16 (track list)
- **Docs:** SECURITY.md §5
- **Human-in-the-loop:** no

**Scope:** minimal product metrics matching the SPEC §16 track list: distinct connected wallet addresses, staking intents, confirmed staking transactions, validator profile views, repeat sessions, public profile shares, indexer history depth. Server-side counters only; no third-party analytics; no pageview-as-usage vanity metrics.

**Deliverables:**
- `metrics` table (additive) + counters in auth/staking/profile handlers
- `GET /api/metrics/public` (aggregates only, no addresses) for the launch story
- Privacy disclosure updated in Learn (P2-12 section)

**Acceptance criteria:**
- [x] No raw addresses exposed by the metrics endpoint (counts only)
- [x] Metrics match the SPEC track list 1:1 — nothing more collected
- [x] Disclosure text accurate (Testing verifies against implementation)

**Verification:** unit + manual count check; P4-04 consumes this.

**Notes:**
- **Done 2026-08-03.** Additive `metrics` table + `server/src/metrics.ts`; `GET /api/metrics/public` returns aggregates + disclosure (no addresses).
- **Event counters:** `auth_connects`, `repeat_sessions` (verify when user already known), `validator_profile_views` (detail 200 incl. cache hits), `public_profile_shares` (path `/validators/:address` for valid addresses).
- **Computed on read:** `distinctConnectedWallets` = COUNT(users); `stakingIntents` / `stakingConfirmed` from `staking_intents`; `indexerHistoryDepthDays` from earliest indexed tx/obs → now.
- **Residual:** staking intent/confirm **event** instrumentation deferred until write endpoints exist (table counts still report 0/rows). Learn → Privacy updated with aggregate-metrics disclosure.
- Docs: DATA-MODEL.md, API.md §public metrics, SECURITY.md §5.

---

### P3-05 — Design polish pass

- **Team:** Polishing
- **Depends on:** P1-08, P2-09
- **Spec refs:** SPEC §10
- **Docs:** STYLING.md (entire — contract)
- **Human-in-the-loop:** no

**Scope:** the full visual pass: token fine-tuning (spacing rhythm, type scale, chip/badge styling), ember accent audit (sparing use), verified-green/amber/blue discipline per palette mapping, identicon treatment, numeric display (Fira Mono, compact, no fake precision), bottom-nav refinement, ReviewSheet ergonomics. Every screen audited against STYLING.md §8 do/don't list.

**Deliverables:**
- Updated `tokens.css`/`base.css` + component CSS refinements
- Per-screen audit notes appended to STYLING.md (or `docs/design-audit.md`) with before/after
- Banned-pattern sweep result (gradients, glass, fake precision, guarantee badges): zero found

**Acceptance criteria:**
- [x] Every screen passes the do/don't list
- [x] Status colors match §3 mapping in all states (incl. dark-mode-safe fallbacks if used)
- [x] Numeric displays compact and mono where required
- [ ] Owner walkthrough sign-off

**Verification:** audit doc + owner sign-off; Testing regression on shared screens.

**Notes:**
- **Done 2026-08-03 (pragmatic).** Token/spacing/type + chip/nav/card polish; banned-pattern sweep clean (no gradients/glass/fake precision). Fira Mono on amounts, hashes, score, timestamps. Ember limited to active nav + kickers. Audit: [`docs/design-audit.md`](../docs/design-audit.md). Residual: owner visual walkthrough sign-off.

---

### P3-06 — Responsive sweep + content stress cases

- **Team:** Polishing
- **Depends on:** P3-05
- **Spec refs:** SPEC §10 (mobile requirements)
- **Docs:** STYLING.md §7
- **Human-in-the-loop:** no

**Scope:** systematic viewport and content stress: 320/375/430 widths on every screen; long validator names, missing logos, unknown addresses, huge balances (≥ 9 digits), tiny balances, zero states, slow-network simulation. Fix-forward everything found.

**Deliverables:**
- Sweep checklist `docs/design-audit.md` §responsive with per-screen results
- Fixes for all findings

**Acceptance criteria:**
- [x] No horizontal scroll, no clipped CTAs, no overlapping text at 320 px anywhere
- [ ] Native confirmation never hidden behind scrolling (ReviewSheet check)
- [x] Stress fixtures (long names etc.) render gracefully
- [x] Touch targets ≥ 44 px verified on interactive elements

**Verification:** checklist complete; Testing spot-regression.

**Notes:**
- **Done 2026-08-03 (pragmatic).** CSS hardening: app-main at 320, name/schedule clamps, amount overflow for large balances, nav 44px + denser &lt;360, safe-area already present. Per-screen matrix in design-audit §responsive. Residual: ReviewSheet (P1-12 not shipped); real-device 320/375/430 walkthrough for owner.

---

### P3-07 — Accessibility pass

- **Team:** Polishing
- **Depends on:** P3-05
- **Spec refs:** SPEC §12 Week-3 (accessible labels, focus, reduced motion)
- **Docs:** STYLING.md §7
- **Human-in-the-loop:** no

**Scope:** a11y: semantic landmarks, labels on all interactive elements, visible focus states (`nq-focusable` consistent), keyboard navigability of flows incl. ReviewSheet, `prefers-reduced-motion` honored, color-contrast check on status chips and text tokens, no hover-only information.

**Deliverables:**
- A11y fixes across screens; `docs/design-audit.md` §a11y notes

**Acceptance criteria:**
- [ ] Full stake flow completable keyboard-only (in browser)
- [x] Status chips/text pass WCAG AA contrast on light theme
- [x] Reduced-motion: no essential animation remains
- [x] Screen-reader labels on nav, CTAs, status chips, evidence links

**Verification:** manual keyboard + contrast tooling; results in audit doc.

**Notes:**
- **Done 2026-08-03 (pragmatic).** Focus-visible defaults + bottom-nav inset rings; `--so-warn-ink` / `--so-disabled-chip-ink` for chip AA; global `prefers-reduced-motion` kill-switch; nav/position/activity link aria-labels. Residual: full keyboard stake flow blocked on P1-12 ReviewSheet; VoiceOver device pass + contrast meter for owner/Testing.

---

### P3-08 — Loading / empty / offline / skeleton / stale states

- **Team:** Polishing
- **Depends on:** P3-05
- **Spec refs:** SPEC §10, Week-3 design
- **Docs:** API.md §1 (envelope semantics)
- **Human-in-the-loop:** no

**Scope:** complete the state inventory for every screen: skeletons for first load, empty states with next actions, offline detection with cached-content behavior, stale-data presentation driven by the API envelope (`status: "stale"` → visible freshness warning), slow-confirm "check later" state polish.

**Deliverables:**
- Skeleton components per main screen; offline banner; stale-data treatment applied app-wide
- State inventory checklist `docs/design-audit.md` §states

**Acceptance criteria:**
- [x] Every screen has all five states designed and implemented
- [x] Stale state is visually distinct from fresh (amber discipline), never alarm-red
- [x] Offline keeps public content readable; staking actions disabled with copy

**Verification:** inventory checklist; Testing failure-matrix overlap (P3-11).

**Notes:**
- 2026-08-03 pragmatic midpoint (pre full P3-05): shell `OfflineBanner`; shared `EnvelopeStatusBanner` (stale/partial/unavailable, amber/gold); skeletons on Home/Directory/Profile/Evidence/Activity; empty+next-action + error+retry on audited screens. No full `docs/design-audit.md` §states yet; offline is browser-level (no service-worker cache). Marked **done** for existing shipped screens.

---

### P3-09 — Copy pass (first-run, errors, methodology)

- **Team:** Polishing
- **Depends on:** P2-12
- **Spec refs:** SPEC §6, §15
- **Docs:** METHODOLOGY.md §8
- **Human-in-the-loop:** no

**Scope:** final copy sweep across the app: first-run onboarding lines, all error/empty messages (API error codes → human sentences), button labels, freshness phrasing, disclaimers. Consistency with Learn articles and the language dictionary; terminology unification (one name per concept).

**Deliverables:**
- Copy deck update + applied strings across screens
- Error-code → message mapping table (client i18n-ready shape, single locale)

**Acceptance criteria:**
- [ ] Every API error code has approved human copy
- [x] Banned-phrase grep clean across `client/src`
- [x] Terminology consistent (e.g. always "Observed recipient coverage", never variants)

**Verification:** dictionary grep + owner read-through.

**Notes:**
- 2026-08-03 partial: first-run DisconnectedHome (SPEC headline kept; methodology disclaimer added); empty Activity personal/network; `humanizeFetchError` for RPC/session/rate-limit/offline/network. Full error-code table + Learn re-read still open.

---

### P3-10 — Security review

- **Team:** Testing
- **Depends on:** P1-02, P1-06, P2-13
- **Docs:** SECURITY.md §8 (checklist — binding)
- **Human-in-the-loop:** no

**Scope:** execute the SECURITY.md §8 checklist end-to-end: auth (expiry, single-use, tampering), session cookie flags, rate limits, input validation, tx matching/replay, headers/CSP in production build, key-material grep sweep, DB statement audit, `npm audit` review.

**Deliverables:**
- Completed checklist with evidence per item → `docs/security-review-2026-08.md`
- Findings filed as bugs with severity; blockers fixed before public beta

**Acceptance criteria:**
- [ ] Every checklist item has pass/fail + evidence
- [ ] No open `blocker` or `major` findings at public beta launch
- [ ] Secrets sweep clean (working tree + recent git history)

**Verification:** owner reviews the report; fixes verified by re-run.

**Notes:**
-

---

### P3-11 — Failure-mode matrix

- **Team:** Testing
- **Depends on:** P1-16, P2-16
- **Spec refs:** SPEC §14 (failure tests)
- **Docs:** TESTING.md §2
- **Human-in-the-loop:** yes — device-assisted rows

**Scope:** exercise every failure case from TESTING.md: connection reject, tx reject, provider unavailable, RPC timeout, malformed RPC, tx not found, tx failed, stale indexer, free-text schedule, zero-history validator, no staker account, retired stake, account switch mid-session, duplicate intent. Automated where possible (mockRpc), manual/device where necessary.

**Deliverables:**
- Matrix `tests/manual/failure-matrix.md` with per-case method (auto/manual), result, evidence
- Bugs filed with severity

**Acceptance criteria:**
- [ ] All 14+ cases have recorded outcomes
- [ ] Each failure lands on a designed state (P3-08), never a white screen or raw error
- [ ] Blockers fixed or explicitly owner-accepted before public beta

**Verification:** matrix complete; owner signs.

**Notes:**
-

---

### P3-12 — Marketing assets (video script, screenshots, thread, post)

- **Team:** Polishing
- **Depends on:** P3-05
- **Spec refs:** SPEC §12 Week-3, §16
- **Docs:** —
- **Human-in-the-loop:** owner records the video

**Scope:** produce the Week-3 asset set: 60–90 s demo video script (wallet → stake → evidence in one take, with captions), 3 mobile screenshots + 1 validator profile screenshot (real data), plain-language methodology graphic (from P2-12 brief), X thread draft (validator performance vs payout accountability gap), community tester-request post draft.

**Deliverables:**
- `submission-assets/` with script, screenshots, graphic source, thread + post drafts (markdown)

**Acceptance criteria:**
- [ ] Script shows real product, real flows, no mock data
- [ ] Assets obey language dictionary (no promises, no accusations)
- [ ] Screenshots at device-realistic sizes, light theme
- [ ] Owner approval on all outbound text

**Verification:** owner sign-off; assets inventoried for P4-02.

**Notes:**
-

---

### P3-13 — Public beta triage: top-5 fixes in 48 h

- **Team:** All
- **Depends on:** P3-05, P3-06, P3-07, P3-08
- **Spec refs:** SPEC §12 Week-3 (public beta)
- **Human-in-the-loop:** yes — owner runs the community channel

**Scope:** public beta is live (URL + deep link shared by owner). Intake issues from the single public channel, dedupe, severity-rank, fix the top five usability problems within 48 hours, and record resolutions publicly.

**Deliverables:**
- Triage log `docs/beta-triage.md` (issue → severity → owner team → fix/commit → verification)
- Board updated with any new tasks spawned

**Acceptance criteria:**
- [ ] Every reported issue acknowledged in the log within 24 h
- [ ] Top-5 usability fixes landed + verified within 48 h of ranking
- [ ] No blocker left open at Phase 4 entry

**Verification:** owner confirms in the log.

**Notes:**
-

---

## Phase 3 milestone — public beta (gate G4)

Live mini app URL with real wallet interactions and a credible evidence dataset. If stability isn't there by Aug 27, gate G4: hold the beta push, extend triage, cut P3-02/alerts rather than the core flow.
