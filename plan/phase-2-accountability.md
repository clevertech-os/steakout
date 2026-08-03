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
- [x] Re-running classification over the same data produces no duplicate runs
- [x] Edge cases handled: single-tx run, run spanning window boundary, gaps > window
- [x] All run txs resolvable to `transactions` rows (FK-consistent)
- [x] Old `calc_version` rows retained; queries use latest version

**Verification:** P2-14 unit suite; re-classification demo from raw_json logged in Notes.

**Notes:**
- **Done 2026-08-03.** Productionized P0-07 grouping in `server/src/payoutClassifier.ts`:
  - Pure `groupPayoutRuns()` unchanged (60-min gap-based sliding window).
  - Persistence: `persistPayoutRuns` / `classifyPayoutRunsForRewardAddress` write
    `validator_observations` rows with `observation_type='payout-run'`,
    `status='verified'`, current `CALC_VERSION` (1), identity key
    `(validator, type, calc_version, source_tx_hash=firstTxHash)`.
  - Payload: `windowStart`/`windowEnd`, `txCount`, `recipientCount`, `recipients`,
    `blockRange`, `txHashes`, first/last hashes, `totalValueLuna`, `windowMinutes`.
  - Idempotent re-runs: second classify over same data → 0 insert/update/remove.
  - Growing runs UPDATE payload; same-version orphans removed; other calc_versions
    retained. `listPayoutRunObservations` defaults to latest calc_version.
  - **Indexer wire (DATA-MODEL §2 step 6):** after successful ingest in
    `PayoutIndexer.runAddress`, calls `classifyPayoutRunsForRewardAddress`.
    Skips with `skipReason: 'no-validator-row'` when no `validators` FK target
    exists (does not invent validators). Logs `{ address, classify: {...} }`.
  - `classify.ts` script and existing pure-function unit tests unchanged.
  - Unit tests: `tests/unit/server/payout-classifier.test.ts` (persistence +
    idempotency + calc_version retention + FK skip + edge cases).


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
- [x] All P0-05 wild-observed strings classified (normalizable or explicitly not)
- [x] Ambiguous/free-text never forced into a number
- [x] Unit tests for each form + rejection cases (P2-14)

**Verification:** P2-14 suite; report reviewed.

**Notes:**
- **Done 2026-08-03.** `normalizeSchedule()` in `server/src/payoutClassifier.ts` returns
  `{ normalizable, everyHours, raw }`. `normalizeScheduleHours()` kept as a thin
  wrapper so the P0-07 `classify` script is unchanged.
- **Wiring:** `normalizeValidator` sets `scheduleEveryHours` from the parser.
  There is no `validatorSync` upsert yet (P1-04); when P1-04 lands, map
  `scheduleEveryHours` → `validators.schedule_every_hours` on insert/update.
  See P1-04 Notes.
- **P0-05 coverage (known-only fixture, n=24):** 10/24 validators (41.7%) have a
  normalizable schedule; among those with a non-null declaration (15), 10/15
  (66.7%). All-observable (n=78): 10/78 (12.8%); among declared (16), 10/16
  (62.5%). Normalizable strings: `Every 12 hours` (×6), `Every 3 hours` (×2),
  `Every 4 hours` (×2). Explicitly not: crons (`0 * * * *`, `0 */6 * * *`),
  minute forms (`Every 1 minute`, `Every minute`), approximate (`Approx. every ~6hrs`),
  free text (`Payouts over 10 NIM are instant…`), and missing.

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
- [x] Threshold mapping exactly per METHODOLOGY.md §3
- [x] < 7 days history always yields `insufficient-data`, never a grade
- [x] Non-normalizable schedules never graded — runs still shown
- [x] Unit-tested boundary values (95.0%, 79.9%, day-6 history, day-14 history)

**Verification:** P2-14 suite.

**Notes:**
- **Done 2026-08-03.** `server/src/observationScoring.ts`:
  - Pure `computeScheduleAdherence` / `mapAdherenceStatus` with METHODOLOGY §3
    thresholds (`on-schedule` ≥95%, `mostly-on-schedule` 80–95%, `irregular` <80%).
  - P0-07 rules: grid anchored at first observed run; only fully elapsed windows
    count; ≥14 days required before any graded label (extends METHODOLOGY’s
    irregular-only floor to all grades); <7 days always `insufficient-data`.
  - Non-normalizable: never graded; `unavailable` with no runs, else
    `insufficient-data` (runCount still in payload for API).
  - Persist as `schedule-adherence` observations (one row per validator per
    `calc_version`); payload includes `window { from, to, expectedWindows,
    observedWindows }` plus rate, historyDepthDays, everyHours, anchorAt.
  - Pipeline hook: `classifyObservationsForRewardAddress` (runs → adherence)
    called from `PayoutIndexer.runAddress` after ingest (DATA-MODEL §2 step 6).
  - Unit tests: `tests/unit/server/observation-scoring.test.ts` (boundaries
    95.0%, 79.9%, day-6, day-14; non-normalizable; persistence/idempotency).


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
- [x] Missing staker set → nulls, never 0/0 or percentages
- [x] Payload always includes the consolidation/threshold/registry-incompleteness caveats
- [x] No derived "payout rate %" anywhere (banned phrasing)

**Verification:** P2-14 suite; P2-06 contract test.

**Notes:**
- **Done 2026-08-03.** Recipient coverage in `server/src/observationScoring.ts`:
  - Pure `computeRecipientCoverage`: distinct `recipientCount`; when a non-empty
    known staker set is provided, `knownStakersCovered` / `knownStakersTotal`
    via normalized address intersection; missing/empty set → both **null**
    (never 0/0, never a percentage field).
  - Mandated `limitations[]` always present:
    `observed-recipient-coverage-is-not-proof-of-full-payout`,
    `consolidation-may-aggregate-multiple-stakers`,
    `payout-threshold-may-exclude-stakers`,
    `registry-staker-list-may-be-incomplete`.
  - Persist as `recipient-coverage` observations (identity:
    validator + type + calc_version + source_tx_hash=firstTxHash); status
    `verified`. Idempotent re-runs; same-version orphans removed.
  - `loadKnownStakerSet` returns null (schema has only `stakers_count`; do not
    invent a list from the count). Override via classify options for tests /
    future registry list.
  - Pipeline: `classifyObservationsForRewardAddress` now runs
    runs → adherence → coverage (indexer already calls this after ingest).
  - Unit tests in `tests/unit/server/observation-scoring.test.ts` (nulls,
    caveats, no payout-rate fields, persistence, pipeline).


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
- [x] No staker account → clean `NotStaked`-style payload, not an error
- [x] Fields null independently (e.g. membership known, last payment unknown)
- [x] Wording in payload keys/messages matches METHODOLOGY.md (no "missed payment" semantics)

**Verification:** integration test with crafted fixtures; build green.

**Notes:**
- **Done 2026-08-03.** `server/src/personalContinuity.ts` + `GET /api/me/observations`
  mounted in `app.ts` under existing `/api/me/*` auth.
  - **Not staked:** `mode: 'not-staked'`, all continuity fields null, HTTP 200.
  - **Direct-payout / unknown:** `lastPaymentAt` from `transactions` (reward→user),
    `windowsObserved` + `consecutiveWindowsIncluded` from payout-run payloads
    (space-insensitive recipient match), `timeSinceLastPaymentSeconds`,
    `currentlyInKnownStakerSet` when a known set is injectable or present on a
    `recipient-coverage` payload (`knownStakerAddresses`); else null.
  - **Restake:** `observedPositionGrowth` from last two `staker_snapshots`
    (label fixed `"Observed position growth"`); direct-payout fields stay null.
  - Every field independently nullable; no "missed payment" keys/messages.
  - Unit tests: `tests/unit/server/personal-continuity.test.ts`.
  - API.md §5 updated with full envelope shape.


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
- [x] Response matches API.md §3 shape exactly (contract test in P2-15)
- [x] Every run's tx hashes present; explorer redirect resolves for both networks
- [x] Network summary counts listed vs observable separately
- [x] Empty-history validator returns `INSUFFICIENT_HISTORY`-style payload, HTTP 200

**Verification:** P2-15 contract test; manual pass.

**Notes:**
- **Done 2026-08-03.** `server/src/observationsApi.ts` + network-aware `explorer.ts`.
  - **GET /api/validators/:address/observations** — envelope with
    `observationStatus`, `schedule` (declared/normalized/normalizable),
    analysis `window`, paginated `runs` (txHashes, blockRange, recipientCount,
    knownStakersCovered/Total), `nextCursor`, `limitations[]`,
    `dataFreshness.historyDepthDays`. Empty history → HTTP 200
    (insufficient-data or unavailable), not 404.
  - **Coverage plug-in:** joins `recipient-coverage` by firstTxHash when present
    (P2-04); else knownStakers* null. Limitations always include P2-04 caveats.
  - **GET /api/network/summary** — totalStakeLuna, listed vs observable counts,
    dominance buckets, stakeWithNormalizableScheduleRatio, indexer cursor stats.
  - **GET /api/explorer/transaction/:hash** — 302 to nimiq.watch / test.nimiq.watch
    from `NIMIQ_NETWORK`; `?format=json` → `{ url, network }`.
  - **List/detail:** `loadObservationSummaries` wires schedule-adherence status
    + last payout-run timestamp into `toListItem` / `toProfile` (replaces stub).
  - Unit tests: `tests/unit/server/observations-api.test.ts`.

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
- [x] No stateful endpoint without the complete envelope (contract sweep)
- [x] Stale indexer → `status: "stale"` + accurate `ageSeconds`
- [x] History depth visible in list, profile, and observations payloads

**Verification:** contract tests updated; manual stale-simulation noted.

**Notes:**
- **Done 2026-08-03.** Freshness helpers in `server/src/freshness.ts` (re-exported
  from `observationScoring.ts` per ARCHITECTURE).
  - `historyDepthDays` = earliest indexed payout-run `windowStart` (or outbound
    reward-address tx) → now; batch via `loadHistoryDepthDaysByValidator`.
  - Stale: `index_cursors` MAX(updated_at) older than `2 × INDEXER_INTERVAL_MINUTES`
    (default 45m, clamp 30–180) → envelope `status: "stale"`; `ageSeconds` from
    watermark. Never upgrades `unavailable`.
  - Wired: list/detail (`validatorSync`), observations + network summary
    (`observationsApi`), personal continuity (`personalContinuity`). Envelope
    fields: `updatedAt`, `source`, `status`, `dataFreshness.{ageSeconds,historyDepthDays?}`.
  - List/profile `observation.historyDepthDays` from live runs (not only adherence).
  - Tests: `tests/unit/server/freshness.test.ts` (depth, stale simulation, envelope shape).

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
- [x] Every displayed metric has definition affordance + freshness + status tag (structural, not optional)
- [x] Runs render correctly at 320 px without tables
- [x] `Schedule cannot be normalized` state shows raw observations, no grade
- [x] Empty history renders `insufficient-data` honestly, never as failure red

**Verification:** manual pass against fixtures incl. empty/non-normalizable validators; build green.

**Notes:**
- **Done 2026-08-03.** Evidence layer on validator profile:
  - `client/src/validators/Evidence.tsx` + `Evidence.css`: fetches
    `GET /api/validators/:address/observations`, summary metrics (history depth,
    windows/runs observed, declared schedule, analysis window, last activity),
    scrollable `EvidenceRow` list (`nq-curtain-y` + `nq-scrollbar-sm`), load-more
    via `nextCursor`, methodology limitations mapped from API machine keys to
    neutral METHODOLOGY §7 copy, links to Learn.
  - `EvidenceRow`: window range, recipient/tx counts, observed recipient coverage
    when known (else insufficient data), up to 4 explorer `nq-arrow` links + overflow
    count, definition + `DataStatusTag` + `FreshnessTag` on every metric.
  - Non-normalizable schedule → “Schedule cannot be normalized” chip (no grade);
    still shows raw runs. Empty history → neutral `Insufficient data` panel (disabled
    tokens, never failure red) + insufficient-data StatusChip.
  - Loading / error states with retry. Profile wires `<Evidence />` in place of the
    observation stub; official Trust Score section stays visually distinct.
  - Directory cards: live list-API observation `StatusChip` + optional history-depth
    mono caption (P2-09 caption system already present).
  - Types/fetch: `fetchValidatorObservations` in `client/src/validators/api.ts`.
  - `npm run build` + `npm run test:client` green.

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
- [x] A user can tell official score and Steakout observation apart at a glance (caption test with owner)
- [x] Label colors match STYLING.md §3 mapping exactly
- [x] One-sentence definitions present for every label
- [x] Directory `recommended` sort now uses live observation status where available

**Verification:** manual caption test; Polishing pre-review; build green.

**Notes:**
- **Done 2026-08-03.** Visual language of trust finalized (P2-09):
  - **`StatusChip`** (`client/src/components/StatusChip.tsx`): five observation
    statuses with per-status one-sentence definitions (title + aria). STYLING §3
    tones: `on-schedule` → verified green; `mostly-on-schedule` + `irregular` →
    warn gold; `insufficient-data` + `unavailable` → disabled neutral.
  - **`DataStatusTag`**: full captions + definitions for Registry declaration vs
    Verified observation (and inferred / insufficient / unavailable); small mark + text.
  - **Directory cards** (`ValidatorCard`): official metric captioned
    **“Nimiq Validator Trust Score”** (info-tinted); footer captioned
    **“Steakout observation”** + live `StatusChip` (no ad-hoc chip colors).
  - **Profile**: official section title **“Nimiq Validator Trust Score”** with
    registry DataStatusTag; observation section **“Steakout observation”** +
    StatusChip; left-border accent tracks observation tone without blending into
    the official (info) card.
  - **Recommended sort** (`validatorSync.compareValidators`): after listed /
    normalizable schedule / payout type, ranks by live observation status
    (`on-schedule` → `unavailable`), then dominance, then official score.
    Directory explainer updated. Tests: `validator-sync.test.ts`,
    `validators-format.test.ts` (label/definition coverage).


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
- [x] Timeline items carry type, time, tx link where applicable, status
- [x] Empty timeline has a useful next action, not a dead end
- [x] Restake changes labeled `Observed position growth`, never "payout"
- [x] Disconnected users can browse the network feed

**Verification:** fixture-driven render pass; build green.

**Notes:**
- **Done 2026-08-03.** Personal + network activity timelines.
  - **Server** `server/src/activity.ts`:
    - `GET /api/me/activity` (auth cookie via existing `/api/me/*` middleware):
      merges observed direct payouts (txs from known reward addresses → user),
      staker_snapshots deltas (`observed-position-growth` when total ↑, else
      `position-change`), and `staking_intents` when present. Each item:
      `{ type, at, txHash, amountLuna, validatorAddress, status, label, … }`.
    - `GET /api/activity/network` (public): recent payout-run observations with
      txCount/recipientCount. Empty personal → HTTP 200 + `items: []`.
  - **Client** `client/src/activity/Activity.tsx` + `Activity.css` +
    `client/src/api/activity.ts`: Personal / Network tabs; connect CTA when
    disconnected; empty states with next actions (validators / position /
    network / methodology); explorer + validator links; neutral copy.
  - Restake growth uses fixed `OBSERVED_POSITION_GROWTH_LABEL` — never "payout".
  - API.md §5 updated with item shape + network endpoint.
  - Unit tests: `tests/unit/server/activity.test.ts` (10). Build green.

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
- [x] Language-dictionary clean (Testing greps banned phrases)
- [x] Every label/metric used in the app is defined here
- [x] Limitations page lists current `calc_version`
- [x] Readable at 320 px; no horizontal scroll

**Verification:** owner read-through; Testing dictionary grep.

**Notes:**
- Shipped 2026-08-03. Routes: `#/learn` hub + `#/learn/staking|methodology|limitations|privacy`.
- `calc_version` displayed from `client/src/learn/calcVersion.ts` (v1 / 2026-08-03). Bump when classifier changes.
- Privacy article covers SECURITY.md §5. Copy uses METHODOLOGY dictionary (observed / not observed / insufficient data).
- **Methodology graphic brief (for P3-12):**
  - **Goal:** one plain-language square/landscape graphic for social + submission (no fake precision).
  - **Layout (3 columns or 3 stacked cards):** (1) **Declared** — registry fee, schedule, payout type; tag “Registry declaration”. (2) **Observed** — payout runs from reward address, windows vs schedule; tag “Verified observation” / “Insufficient data”. (3) **Labels** — On schedule / Mostly on schedule / Irregular / Not enough observed data — with one-line definitions, never fraud language.
  - **Footer strip:** “Official Validator Trust Score stays official · Steakout observes payouts · No guaranteed APY”.
  - **Visual:** light surface, ember accent sparingly, blue for info tags, green only for verified; Fira Mono for status chips; Mulish for body.
  - **Source copy:** Learn methodology article + METHODOLOGY.md §2–§4.

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
- [x] Repeated profile requests don't re-hit the DB within TTL; invalidation proven after new index cycle
- [x] Diagnostics shows per-address cursor + last-cycle stats
- [x] No sensitive data (no user addresses) in diagnostics output

**Verification:** load-spot-check logged in Notes; security re-check in P3-10.

**Notes:**
- **Done 2026-08-03.** Production hygiene for public reads + operator visibility.
  - **Cache:** `server/src/responseCache.ts` — in-process GET cache for
    `/api/validators`, `/api/validators/:address`, `/api/validators/:address/observations`.
    Key = path + sorted query + indexer watermark (`MAX(index_cursors.updated_at)`).
    TTL 45s; watermark advance → automatic miss. Headers: `Cache-Control: public, max-age=45`,
    `X-Cache: HIT|MISS`. Soft cap 500 entries.
  - **Rate limits (documented in app.ts + ARCHITECTURE §9):**
    global `/api` 300/60s; auth challenge 12/60s IP + address, verify 24/60s;
    new strict `/api/staking` 60/60s (above global; for upcoming intent/confirm).
  - **Diagnostics:** `GET /api/diagnostics` via `DIAGNOSTICS_TOKEN` (Bearer or `?token=`).
    Payload: indexer health (`cycleCount`, `lastCycle` aggregates), watermark,
    configured address **count**, per-cursor **SHA-256 fingerprints** (no raw addresses /
    tx hashes), RPC metrics (avg latency, byMethod), DB table row counts, cache stats.
    Unset token → 503; bad/missing token → 401. `Cache-Control: no-store`.
  - **IndexerHealth** extended with `cycleCount` + `lastCycle` (addressCount/fetched/
    inserted/errorCount/durationMs) — still no per-address PII on `/api/health`.
  - `.env.example` documents `DIAGNOSTICS_TOKEN=`. ARCHITECTURE §9 updated.
  - Tests: `tests/unit/server/response-cache-diagnostics.test.ts` (cache hit/miss,
    watermark invalidation, diagnostics 401/503/Bearer/query, no secrets/PII).
  - `npm run test:server` + `npm run build` green.

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
- [x] Every coverage-map row for these modules tested incl. listed edge cases
- [x] Boundary tests at exactly 95%/80% and day 7/14
- [x] Green in clean env

**Verification:** `npm test`.

**Notes:**
- **Done 2026-08-03.** Audit + gap fill for TESTING.md §2 unit rows (classifier / scoring / cursor).
  No product code changes. `npm run test:server` green (241 tests).

### Coverage map (P2-14)

| Area (TESTING.md §2) | Module | Suite file | Status |
|---|---|---|---|
| Schedule parser/normalizer (all forms + rejections) | `payoutClassifier.ts` `normalizeSchedule` | `tests/unit/server/payout-classifier.test.ts` | **covered** |
| Payout-run grouping (window edges, gaps, single-tx) | `payoutClassifier.ts` `groupPayoutRuns` | same | **covered** |
| Recipient coverage (known set present/absent, consolidation) | `observationScoring.ts` `computeRecipientCoverage` | `tests/unit/server/observation-scoring.test.ts` | **covered** |
| Observation status (thresholds, insufficient-data paths) | `observationScoring.ts` `mapAdherenceStatus` / `computeScheduleAdherence` | same | **covered** |
| Index cursor (no advance on partial page) | `payoutIndexer.ts` | `tests/unit/server/payout-indexer.test.ts` | **covered** |

### Edge-case checklist

**Schedule parser** (`normalizeSchedule`):
- Forms accepted: `hourly`, `every N hours` (incl. 0.5 / hyphen / punctuation / case), `daily`, `twice daily`
- Rejections: crons, minute forms, approx/free-text, empty, weekly, `every 12 hrs`, zero/negative N, null/undefined
- Full P0-05 wild inventory classified (normalizable or explicitly not)

**Run grouping** (`groupPayoutRuns`):
- Empty input; all-failed/reverted → no runs
- Single-tx run; exact window join; 1ms-beyond split; sliding chain; large gaps; unordered input
- Distinct recipients; same-timestamp hash order; custom window; malformed timestamp throws
- Persistence: idempotent re-classify, growing-run update, calc_version retention, FK skip

**Coverage calc** (`computeRecipientCoverage`):
- Known set missing / undefined / empty → `knownStakers* = null` (never 0/0)
- Mixed present/absent; **all known present** (covered===total); **none present** (covered===0, total>0)
- Consolidation + threshold + registry-incompleteness limitations always present
- No derived payout-rate / coverage-percent fields; address normalization + dedupe

**Adherence boundaries** (`mapAdherenceStatus` / `computeScheduleAdherence`):
- Rate **exactly 95%** → `on-schedule`; just below → `mostly-on-schedule`
- Rate **exactly 80%** → `mostly-on-schedule`; just below (79.9%) → `irregular` (≥14d)
- History **day 6 / &lt;7** → `insufficient-data`; **day 7–13.999** → `insufficient-data`
- **Day 14** allows graded labels; non-normalizable + no runs → `unavailable`; + runs → `insufficient-data`
- Normalizable + zero runs → `insufficient-data`; expectedWindows=0 → `insufficient-data`
- Window math: anchor at first run; trailing partial excluded; multi-run-in-window counts once

**Cursor advancement** (`PayoutIndexer`):
- Later page fails (partial multi-page) → `cursorAdvanced=false`, zero rows retained
- First page fails → no cursor row created
- Empty page → cursor unchanged, `cursorAdvanced=false`
- Successful full-page ingest → cursor at newest tx, `cursorAdvanced=true`
- Restart recovery advances from persisted watermark (hash-dedup)

**Gap list closed this pass:**
1. Cursor: first-page failure / empty page / successful advance + `cursorAdvanced` assertions
2. Coverage: all-present and all-absent known-set cases
3. Adherence: named 95%/80%/day-7/14 boundary titles; normalizable-zero-runs path
4. Grouping: all-failed-tx empty-run edge

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
- [x] Restart test proves cursor-based resume with no refetch overlap
- [x] Duplicate ingestion = zero new rows
- [x] Contract test asserts full envelope + run payload shape
- [x] Explorer URLs correct for testnet + mainnet

**Verification:** `npm run test:integration` / `npm test` clean env.

**Notes:**
- **Done 2026-08-03.** Suite at `tests/integration/indexer-evidence.test.ts` (6 tests):
  1. Multi-page ingest + SQLite reopen: cursor resumes; only new tip inserts (no overlap).
  2. Transient first-page failures retry then succeed.
  3. Same mockRpc page twice → zero new rows (hash PK).
  4. Index → classify → `GET /api/validators/:address/observations` full envelope + run shape
     (`windowStart`, `txCount`, `recipientCount`, nullable coverage, `txHashes`, `blockRange`,
     `limitations`).
  5. Empty-history validator → HTTP 200 + `insufficient-data`/`unavailable`, empty runs.
  6. Explorer 302 mainnet (`nimiq.watch`) / testnet (`test.nimiq.watch`) + `?format=json`.
- Root scripts: `test:integration`; `npm test` now includes integration after unit suites.
- Offline only (mockRpc / injected fetch). See `tests/integration/README.md`.

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
- [x] Link unfurl shows validator name + status (verified with a debugger tool; screenshot in Notes)
- [x] Meta contains no claims beyond displayed data
- [x] Works for unknown/unlisted validators with graceful text

**Verification:** unfurl test noted; build green.

**Notes:**
- **Done 2026-08-03.** Shareable path URLs + meta:
  - **Canonical share URL:** `/validators/{compactAddress}` (no hash). Client
    `App.tsx` rewrites path opens → `/#/validators/:address` so the hash router
    still owns in-app navigation. Hash deep links (`#/validators/:address`)
    continue to work.
  - **Server (crawlers):** `mountProfileShareRoutes` in `server/src/profileMeta.ts`
    serves `GET /validators/:address` with built SPA HTML and injected
    `<title>`, `description`, `og:title`/`og:description`/`og:url`, Twitter
    tags, and canonical link. Meta fields from DB when present: name (or short
    address), observation status label, official score, history depth days.
    Unknown/invalid → “Validator profile · Steakout” + graceful copy. HTML
    escaped. Optional `PUBLIC_APP_URL` for og:url origin.
  - **Client:** Profile sets document title/meta after load; restores defaults
    on unmount. **Share profile** button uses Web Share API when available,
    else clipboard copy of the path-based URL.
  - **Default shell meta** in `client/index.html` (description + OG/Twitter).
  - Unit tests: `tests/unit/server/profile-meta.test.ts`,
    `tests/unit/client/profile-share.test.ts`.
  - **Unfurl check:** inject unit test asserts name + status in title/description
    and single OG tags; live debugger screenshot deferred to deploy URL
    (no production host in this change). Example expected tags for a known
    pool: `title=Example Pool · Steakout`,
    `description=Observation: On schedule. Official Nimiq Validator Trust Score: …`.


---

## Phase 2 milestone — private beta (gate G3)

A usable staking cockpit with ≥ 1 evidence-backed validator profile and no known blocker on the primary mobile path. Owner runs the beta checklist; validator outreach prep (neutral invitation + preview URLs, SPEC §16) assembled for owner sending. If no profile is evidence-backed by Aug 20, gate G3 descope applies.
