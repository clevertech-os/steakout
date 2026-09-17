# Observation bottlenecks — implementation brief

Repo: `/Users/sharms/_github_repos/steakout`  
Branch: work on `main` (user already on main; keep minimal focused commits or one clean commit).  
Read `Agents.md`, `docs/METHODOLOGY.md` §3–4, `docs/SPEC.md` §7.2.

## Item 1 — Schedule normalization extensions (calc bump)

**File:** `server/src/payoutClassifier.ts` — `normalizeSchedule` / `parseEveryHours` / `canonicalizeScheduleText`.

Today only: `hourly`, `every N hours`, `daily`, `twice daily`.

**Add (unambiguous only):**

1. **5-field cron** (space-separated), minute fixed to `0` only:
   - `0 * * * *` → 1 hour
   - `0 */N * * *` where N is positive integer → N hours  
   - `0 0 * * *` → 24 hours (daily)
2. **Synonyms** for hour forms:
   - `every N hrs` / `every N hr` / `every N h` → N hours
   - `every N hour` already covered

**Reject (keep non-normalizable):**

- Minute-level: `Every 1 minute`, `Every minute`, `* * * * *`, `*/N * * * *`
- Free text: `Payouts over 10 NIM…`
- Ambiguous cron (day/month/dow not `*`, non-zero minute other than the daily `0 0 * * *` case, lists, ranges, steps on minute field except `0 */N * * *`)
- Negative or zero intervals

**Tests:** `tests/unit/server/payout-classifier.test.ts` currently asserts `0 */6 * * *` is NOT normalizable — flip to expect `everyHours: 6`. Add cases for hourly cron, daily cron, `every 12 hrs`, and rejections for minute/free-text.

**CALC_VERSION:** bump `CALC_VERSION` from `1` → `2` in:
- `server/src/payoutClassifier.ts`
- `client/src/learn/calcVersion.ts` (`CALC_VERSION_DATE` → `2026-08-04`)

**Docs (same change):** one sentence in `docs/METHODOLOGY.md` §4.2 that cron forms `0 * * * *`, `0 */N * * *`, `0 0 * * *` and `every N hrs` are accepted. Note calc_version 2.

Reclassification happens automatically on next indexer cycle (existing classify-on-index path). No need to force rebackfill.

## Item 2 — UI: non-normalizable vs shallow history

Machine status may stay `insufficient-data` / `unavailable` (no new enum required unless API already has a clean place).

**Requirement:** Users must not think “wait for more history” when the real issue is schedule policy.

**Surfaces to update:**

1. `client/src/components/StatusChip.tsx` — keep labels; allow callers to override definition (already supported).
2. `client/src/validators/Evidence.tsx` — when `!schedule.normalizable && runs.length > 0`:
   - Prefer label sense: show definition from limitation `schedule-cannot-be-normalized` (already in LIMITATION_COPY).
   - Override StatusChip definition (and optionally a short secondary line under the chip) so it does **not** say “not enough indexed history”.
   - When `historyDepthDays < 7` (or API says insufficient-history limitation) and schedule **is** normalizable: keep “not enough history” messaging.
3. `client/src/validators/Profile.tsx` — hero observation chip: same distinction when profile has schedule info or when observation status is insufficient-data with historyDepthDays ≥ 7 and declared schedule present but not normalized. Profile list item may only have observation summary — use:
   - If `historyDepthDays >= 7` and status is `insufficient-data` → prefer definition: “Declared schedule cannot be normalized for adherence grading, or not enough expected windows; raw observations may still be available.”
   - If `historyDepthDays < 7` and status is `insufficient-data` → keep shallow-history definition.
4. `client/src/learn/Learn.tsx` — one short clarification that insufficient-data covers **both** short history and non-normalizable schedules; grades require normalizable schedule + ≥14 days.
5. `client/src/validators/ValidatorCard.tsx` — if it shows observation chips with history, align tooltip/definition if easy; skip if no status definition surface.

Do **not** invent accusatory language. Neutral only.

## Item 3 — Reward-address audit + resolve hardening

**Depth-0 / unavailable listed validators observed on mainnet:** Techbits, ImpactZero, Nova Pool, Private Whalidator (and any similar).

**Implement:**

1. **Script** `server/scripts/audit-reward-addresses.ts` (run via `npx tsx` or add npm script if package.json pattern exists):
   - Open SQLite from `DATA_DIR` (same as rest of server).
   - For each **listed** validator: print name, address, reward_address, payout_type, schedule, outbound tx count from `transactions` for reward address (or 0 if no reward), earliest/latest tx timestamps if any, index cursor presence.
   - Exit 0 always (audit tool).
2. **Hardening** in `server/src/validatorSync.ts` `resolveMissingRewards` / callers:
   - On permanent-looking RPC errors (`No validator with address`), log once per cycle and **do not** spam retries beyond existing attempt limits; prefer skip after first hard failure in a cycle.
   - Optional: if registry provides a reward address field, prefer it (check existing mapping — do not break current COALESCE keep-existing behavior).
3. **Diagnostics** (if `/api/diagnostics` already lists validators/indexer): add a compact `rewardAddressGaps` summary: listed validators with null reward_address and/or zero indexed txs. Keep token-gated. If diagnostics is large, a small helper used by both script and diagnostics is fine.

Do not change product claims. Do not store private keys.

## Item 4 — Historical / self-hosted RPC infrastructure polish

No need to provision a node. Make pointing one easy and documented:

1. `.env.example` — expand comments under `NIMIQ_RPC_URL` / `NIMIQ_RPC_URL_FALLBACK`:
   - Self-hosted full/archive node must expose JSON-RPC methods Steakout uses, especially `getTransactionsByAddress` with newest-first pagination + `startAt` cursor (see `docs/spikes/rpc-reads.md`).
   - Use primary = private/historical node for indexing; optional public fallback.
   - After switching RPC, set `INDEXER_REBACKFILL=true` only for one boot if you need deeper history than current cursors; then turn off.
2. `README.md` env table — one row/note on self-hosted historical RPC.
3. Short note in `docs/spikes/indexer.md` or `docs/ARCHITECTURE.md` (pick one existing section): when a historical node helps (depth beyond public retention, rate limits) vs when it does not (schedule normalization).

Verify `NIMIQ_RPC_URL_FALLBACK` is already wired in `nimiq-rpc.ts` / index; only fix gaps if fallback is incomplete.

## Verification

```bash
npm test --prefix server   # or root npm test / vitest for unit suites touched
# at least:
npx vitest run tests/unit/server/payout-classifier.test.ts tests/unit/server/observation-scoring.test.ts
npm run build   # if feasible
```

## Constraints

- TypeScript strict, no `any` without comment.
- Minimal diffs; no new deps.
- Methodology: never force free-text schedules into grades.
- Do not commit secrets or `server/data*`.
- Update docs only as specified.

## Report

Write `/Users/sharms/_github_repos/steakout/.superpowers/sdd/observation-bottlenecks/report.md` with: status, files changed, test commands + results, residual risks.
