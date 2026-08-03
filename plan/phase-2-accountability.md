# Phase 2 — Accountability engine & private beta (Aug 17–23)

**Goal:** a real user understands both the staking action and the validator's observed payout behavior. Ends in the **private beta** milestone (internal hard deadline). See [ROADMAP.md](ROADMAP.md#week-2--accountability-engine--private-beta-aug-1723).

Board: [README.md](README.md#phase-2--accountability-engine-aug-1723)

---

### P2-01 — Payout-run grouping

- **Team:** Implementation
- **Depends on:** P0-06, P0-07
- **Spec refs:** SPEC §7.2
- **Docs:** METHODOLOGY.md §4.1, DATA-MODEL.md §2
- **Human-in-the-loop:** no

**Scope:** productionize the P0-07 prototype into `payoutClassifier.ts`: group outbound transactions from each validator reward address into payout runs (60-min sliding window default from the spike), persist runs as `validator_observations` rows (`payout-run` type) with current `calc_version`, idempotent re-runs.

**Deliverables:**
- Grouping module + persistence; classifier invoked by the indexer after each ingest cycle (DATA-MODEL.md §2 step 6)
- Run payload: window start/end, tx count, distinct recipients, block range, tx hashes

**Acceptance criteria:**
- [ ] Re-running classification over the same data produces no duplicate runs
- [ ] Edge cases handled: single-tx run, run spanning window boundary, gaps > window
- [ ] All run txs resolvable to `transactions` rows (FK-consistent)
- [ ] Old `calc_version` rows retained; queries use latest version

**Verification:** P2-14 unit suite; re-classification demo from raw_json logged in Notes.

**Notes:**
-

---

### P2-02 — Schedule normalization

- **Team:** Implementation
- **Depends on:** P0-05
- **Spec refs:** SPEC §7.2
- **Docs:** METHODOLOGY.md §4.2
- **Human-in-the-loop:** no

**Scope:** parser mapping declared schedule strings → `{ everyHours }` for the documented unambiguous forms only (`hourly`, `every N hours`, `daily`, `twice daily`; case/punctuation tolerant). Everything else → `normalizable: false` with the raw string preserved. Uses the real-world schedule inventory from the P0-05 report.

**Deliverables:**
- `normalizeSchedule()` in `payoutClassifier.ts` (pure function) + column population in `validators` (`schedule_every_hours`)
- Coverage report in Notes: % of listed validators normalizable

**Acceptance criteria:**
- [ ] All P0-05 wild-observed strings classified (normalizable or explicitly not)
- [ ] Ambiguous/free-text never forced into a number
- [ ] Unit tests for each form + rejection cases (P2-14)

**Verification:** P2-14 suite; report reviewed.

**Notes:**
-

---

### P2-03 — Schedule adherence calculator

- **Team:** Implementation
- **Depends on:** P2-01, P2-02
- **Docs:** METHODOLOGY.md §3 (thresholds), §4.2
- **Human-in-the-loop:** no

**Scope:** expected-vs-observed window analysis per validator over the indexed history: compute expected windows from normalized schedule, count observed windows, map to status labels (`on-schedule` ≥ 95%, `mostly-on-schedule` 80–95%, `irregular` < 80% with ≥ 14 days history, else `insufficient-data`; `unavailable` when not normalizable with no runs).

**Deliverables:**
- Adherence computation in `observationScoring.ts`, persisted as `schedule-adherence` observations
- `window { from, to, expectedWindows, observedWindows }` payload for the API

**Acceptance criteria:**
- [ ] Threshold mapping exactly per METHODOLOGY.md §3
- [ ] < 7 days history always yields `insufficient-data`, never a grade
- [ ] Non-normalizable schedules never graded — runs still shown
- [ ] Unit-tested boundary values (95.0%, 79.9%, day-6 history, day-14 history)

**Verification:** P2-14 suite.

**Notes:**
-

---

### P2-04 — Recipient coverage observations

- **Team:** Implementation
- **Depends on:** P2-01
- **Docs:** METHODOLOGY.md §4.3
- **Human-in-the-loop:** no

**Scope:** per payout run: distinct recipient count, and when a known staker set exists (registry stakers list), the covered/total pair. Persisted as `recipient-coverage` observations with the mandated caveats in the payload's `limitations` array.

**Deliverables:**
- Coverage computation + persistence; API-ready payload including `knownStakersCovered`/`knownStakersTotal` nullable fields

**Acceptance criteria:**
- [ ] Missing staker set → nulls, never 0/0 or percentages
- [ ] Payload always includes the consolidation/threshold/registry-incompleteness caveats
- [ ] No derived "payout rate %" anywhere (banned phrasing)

**Verification:** P2-14 suite; P2-06 contract test.

**Notes:**
-

---

### P2-05 — Personal continuity endpoint

- **Team:** Implementation
- **Depends on:** P1-02, P2-01
- **Spec refs:** SPEC §7.2 (personal continuity)
- **Docs:** API.md §5, METHODOLOGY.md §4.4
- **Human-in-the-loop:** no

**Scope:** `GET /api/me/observations`: for the authenticated staker delegating to a direct-payout validator — last observed payment to their address, consecutive observed windows including them, time since last payment, current membership in the known staker set. Each field independently nullable; restake-delegated users get an explicit `Observed position growth` pointer (snapshot-based) instead of payout claims.

**Deliverables:**
- Endpoint + continuity computation reading `transactions`/`validator_observations`
- Response per API.md §5

**Acceptance criteria:**
- [ ] No staker account → clean `NotStaked`-style payload, not an error
- [ ] Fields null independently (e.g. membership known, last payment unknown)
- [ ] Wording in payload keys/messages matches METHODOLOGY.md (no "missed payment" semantics)

**Verification:** integration test with crafted fixtures; build green.

**Notes:**
-

---

### P2-06 — Observations/evidence endpoints

- **Team:** Implementation
- **Depends on:** P2-03, P2-04
- **Spec refs:** SPEC §6.3, §9
- **Docs:** API.md §3
- **Human-in-the-loop:** no

**Scope:** `GET /api/validators/:address/observations` per contract: status, schedule (declared + normalized + normalizable), analysis window, paginated runs with tx hashes + block ranges, limitations array. Plus `GET /api/explorer/transaction/:hash` redirect service and `GET /api/network/summary`.

**Deliverables:**
- The three endpoints, response-envelope compliant (`updatedAt`, `source`, `status`, `dataFreshness.historyDepthDays`)
- Cursor pagination for runs

**Acceptance criteria:**
- [ ] Response matches API.md §3 shape exactly (contract test in P2-15)
- [ ] Every run's tx hashes present; explorer redirect resolves for both networks
- [ ] Network summary counts listed vs observable separately
- [ ] Empty-history validator returns `INSUFFICIENT_HISTORY`-style payload, HTTP 200

**Verification:** P2-15 contract test; manual pass.

**Notes:**
-

---

### P2-07 — History depth + freshness across APIs

- **Team:** Implementation
- **Depends on:** P2-06
- **Spec refs:** SPEC §7.1, §8.8
- **Docs:** API.md §1, METHODOLOGY.md §1
- **Human-in-the-loop:** no

**Scope:** systematic freshness: compute `historyDepthDays` per validator (earliest indexed block → now), propagate through validators list/detail/observations, and ensure every stateful endpoint carries the full response envelope. Add stale detection (indexer watermark older than 2× poll cadence → `status: "stale"`).

**Deliverables:**
- Freshness computation in `observationScoring.ts`; envelope middleware applied to all endpoints
- `dataFreshness` populated everywhere per API.md §1

**Acceptance criteria:**
- [ ] No stateful endpoint without the complete envelope (contract sweep)
- [ ] Stale indexer → `status: "stale"` + accurate `ageSeconds`
- [ ] History depth visible in list, profile, and observations payloads

**Verification:** contract tests updated; manual stale-simulation noted.

**Notes:**
-

---

### P2-08 — Evidence layer UI

- **Team:** Implementation
- **Depends on:** P1-11, P2-06
- **Spec refs:** SPEC §6.3
- **Docs:** STYLING.md §5, METHODOLOGY.md
- **Human-in-the-loop:** no

**Scope:** the validator profile's evidence layer: payout window list (`EvidenceRow`: window time, recipient count, coverage when known, tx links), data collection timestamp, methodology + limitations section, history-depth display. Legible without charts; `nq-curtain-y` scroll areas.

**Deliverables:**
- `client/src/validators/Evidence.tsx` + `EvidenceRow` + limitations block
- Explorer links per row (outbound `nq-arrow` style)

**Acceptance criteria:**
- [ ] Every displayed metric has definition affordance + freshness + status tag (structural, not optional)
- [ ] Runs render correctly at 320 px without tables
- [ ] `Schedule cannot be normalized` state shows raw observations, no grade
- [ ] Empty history renders `insufficient-data` honestly, never as failure red

**Verification:** manual pass against fixtures incl. empty/non-normalizable validators; build green.

**Notes:**
-

---

### P2-09 — Status labels + official-vs-observed UI distinction

- **Team:** Implementation
- **Depends on:** P2-08
- **Spec refs:** SPEC §6.2–6.3, §7.5
- **Docs:** METHODOLOGY.md §2–3, STYLING.md §3
- **Human-in-the-loop:** no

**Scope:** finalize the visual language of trust: `StatusChip` set for the five observation statuses (colors per token mapping), official score badge explicitly captioned "Nimiq Validator Trust Score", Steakout observation captioned separately, and the directory cards updated from stubs to live observation data.

**Deliverables:**
- `StatusChip` final styling + caption system applied to directory + profile
- Tooltip/info affordances defining each label in one sentence

**Acceptance criteria:**
- [ ] A user can tell official score and Steakout observation apart at a glance (caption test with owner)
- [ ] Label colors match STYLING.md §3 mapping exactly
- [ ] One-sentence definitions present for every label
- [ ] Directory `recommended` sort now uses live observation status where available

**Verification:** manual caption test; Polishing pre-review; build green.

**Notes:**
-

---

### P2-10 — Activity timeline (personal + network)

- **Team:** Implementation
- **Depends on:** P1-05, P2-05
- **Spec refs:** SPEC §6.6
- **Docs:** API.md §5
- **Human-in-the-loop:** no

**Scope:** the Activity destination: authenticated users see their timeline (staking txs, delegation changes, retire/remove transitions, observed direct payouts received, restake balance changes from snapshots); everyone sees the network observation feed (recent payout runs across validators). In-app alerts surface as timeline badges (payout window observed, position changed, withdrawable available, validator status changed) — no push/email in v1.

**Deliverables:**
- `GET /api/me/activity` per contract + `client/src/activity/` timeline UI
- Badge logic client-side from observation deltas (simple, auditable)

**Acceptance criteria:**
- [ ] Timeline items carry type, time, tx link where applicable, status
- [ ] Empty timeline has a useful next action, not a dead end
- [ ] Restake changes labeled `Observed position growth`, never "payout"
- [ ] Disconnected users can browse the network feed

**Verification:** fixture-driven render pass; build green.

**Notes:**
-

---

### P2-11 — Change-delegation lifecycle action

- **Team:** Implementation
- **Depends on:** P0-03, P1-06
- **Spec refs:** SPEC §6.5, §11
- **Docs:** API.md §6, SECURITY.md §2
- **Human-in-the-loop:** device spot-check

**Scope:** add the second lifecycle operation (beyond create+add): `sendUpdateStakerTransaction` for change delegation (or the highest-confidence method from P0-03 evidence). Full intent/confirm/review-sheet treatment identical to the stake flow, including plain-language transition explanation.

**Deliverables:**
- `update-staker` operation wired through intents, review sheet, confirm matcher
- UI entry point on the position view (Change validator)

**Acceptance criteria:**
- [ ] Same safety bar as P1-12: review before confirm, matcher validation, reload recovery
- [ ] Works on testnet device (evidence in Notes)
- [ ] If P0-03 showed this method is broken, the card is marked `cut` with the evidence and the alternative implemented instead

**Verification:** device spot-check + integration tests extended.

**Notes:**
-

---

### P2-12 — Learn: staking, methodology, limitations

- **Team:** Polishing
- **Depends on:** P1-07
- **Spec refs:** SPEC §6.1, §7, §15
- **Docs:** METHODOLOGY.md (entire), STYLING.md §6
- **Human-in-the-loop:** no

**Scope:** the Learn destination: (1) how non-custodial staking works in Nimiq Pay, (2) Steakout methodology — what observed/declared/inferred mean, how runs and adherence are computed, (3) limitations — what Steakout cannot see, why no effective fee, calculation version + date. Written for non-crypto readers; `nq-prose` layout.

**Deliverables:**
- Three articles + routing under `/learn`
- Methodology graphic brief (for P3-12 asset production)
- Privacy disclosure section (SECURITY.md §5 content)

**Acceptance criteria:**
- [ ] Language-dictionary clean (Testing greps banned phrases)
- [ ] Every label/metric used in the app is defined here
- [ ] Limitations page lists current `calc_version`
- [ ] Readable at 320 px; no horizontal scroll

**Verification:** owner read-through; Testing dictionary grep.

**Notes:**
-

---

### P2-13 — Caching, rate limits, indexer diagnostics

- **Team:** Implementation
- **Depends on:** P2-06
- **Spec refs:** SPEC §8.8, Week-2 engineering
- **Docs:** ARCHITECTURE.md §9
- **Human-in-the-loop:** no

**Scope:** production hygiene: response caching for public endpoints keyed by validator + indexer watermark; confirm rate-limit coverage on all auth/staking routes; protected diagnostics route (`/api/diagnostics`, owner token) showing indexer cycles, RPC latency/error rates, cursor states, DB sizes.

**Deliverables:**
- Cache layer + invalidation on new index watermark
- Diagnostics endpoint (token-gated, excluded from public docs)

**Acceptance criteria:**
- [ ] Repeated profile requests don't re-hit the DB within TTL; invalidation proven after new index cycle
- [ ] Diagnostics shows per-address cursor + last-cycle stats
- [ ] No sensitive data (no user addresses) in diagnostics output

**Verification:** load-spot-check logged in Notes; security re-check in P3-10.

**Notes:**
-

---

### P2-14 — Unit tests: classifier, scoring, cursor

- **Team:** Testing
- **Depends on:** P2-01, P2-02, P2-03, P2-04
- **Docs:** TESTING.md §2
- **Human-in-the-loop:** no

**Scope:** classifier unit batch per coverage map: schedule parser (all forms + rejections), run grouping (edges, gaps, single-tx), coverage calc (known set present/absent, consolidation case), adherence status (threshold boundaries, < 7-day and non-normalizable paths), cursor advancement (no advance on partial page).

**Deliverables:**
- `tests/unit/` classifier + scoring suites

**Acceptance criteria:**
- [ ] Every coverage-map row for these modules tested incl. listed edge cases
- [ ] Boundary tests at exactly 95%/80% and day 7/14
- [ ] Green in clean env

**Verification:** `npm test`.

**Notes:**
-

---

### P2-15 — Integration: indexer, dupes, evidence links

- **Team:** Testing
- **Depends on:** P0-06, P0-08, P2-06
- **Docs:** TESTING.md §2
- **Human-in-the-loop:** no

**Scope:** indexer integration batch: multi-page fetch with mockRpc (ordering + cursor continuity), retry on injected failures, process-restart recovery from persisted cursor, duplicate page → zero duplicates, public observations contract test vs API.md, evidence/explorer links resolve to correct URLs on both networks.

**Deliverables:**
- `tests/integration/` indexer + contract suites

**Acceptance criteria:**
- [ ] Restart test proves cursor-based resume with no refetch overlap
- [ ] Duplicate ingestion = zero new rows
- [ ] Contract test asserts full envelope + run payload shape
- [ ] Explorer URLs correct for testnet + mainnet

**Verification:** `npm test` clean env.

**Notes:**
-

---

### P2-16 — Shareable validator profile URLs + meta

- **Team:** Implementation
- **Depends on:** P2-08
- **Spec refs:** SPEC §3.5, §16
- **Docs:** —
- **Human-in-the-loop:** no

**Scope:** make validator profiles distribution-ready: canonical `/validators/:address` URLs, server-injected Open Graph/Twitter meta (name, official score, observation status, history depth — static per request, no client JS needed), and a copy-link affordance. This powers the validator-sharing distribution loop.

**Deliverables:**
- Meta injection in the SPA HTML for profile routes (server-side template substitution is fine)
- Share button on profile (copy link; Web Share API where available)

**Acceptance criteria:**
- [ ] Link unfurl shows validator name + status (verified with a debugger tool; screenshot in Notes)
- [ ] Meta contains no claims beyond displayed data
- [ ] Works for unknown/unlisted validators with graceful text

**Verification:** unfurl test noted; build green.

**Notes:**
-

---

## Phase 2 milestone — private beta (gate G3)

A usable staking cockpit with ≥ 1 evidence-backed validator profile and no known blocker on the primary mobile path. Owner runs the beta checklist; validator outreach prep (neutral invitation + preview URLs, SPEC §16) assembled for owner sending. If no profile is evidence-backed by Aug 20, gate G3 descope applies.
