# Observation bottlenecks — implementation report

**Status:** DONE_WITH_CONCERNS  
**Date:** 2026-08-04  
**Branch:** main (working tree uncommitted)

## Summary

All four brief items implemented:

1. **Schedule normalization (calc_version 2)** — hour-level cron + `hrs`/`hr`/`h` synonyms; tests and METHODOLOGY §4.2 updated.
2. **UI distinction** — non-normalizable schedule vs shallow history on Evidence, Profile hero, ValidatorCard, Learn.
3. **Reward-address audit** — `server/scripts/audit-reward-addresses.ts`, resolve hardening for permanent RPC misses, diagnostics `rewardAddressGaps`.
4. **Historical RPC polish** — `.env.example`, README env table, `docs/spikes/indexer.md` self-hosted section.

## Files changed

### Item 1 — schedule normalization
- `server/src/payoutClassifier.ts` — `CALC_VERSION = 2`, `parseCronEveryHours`, hour-unit synonyms
- `client/src/learn/calcVersion.ts` — version 2 / `2026-08-04`
- `docs/METHODOLOGY.md` — §4.2 accepted forms + calc_version 2
- `tests/unit/server/payout-classifier.test.ts`
- `tests/unit/server/validator-sync.test.ts`
- `tests/unit/server/validators-api.test.ts`
- `tests/unit/server/observation-scoring.test.ts` (non-normalizable example → minute form)
- `tests/unit/server/observations-api.test.ts` (same)

### Item 2 — UI
- `client/src/validators/Evidence.tsx` — StatusChip definition override; secondary line for non-normalizable
- `client/src/validators/Profile.tsx` — hero definition when `historyDepthDays >= 7` + insufficient-data
- `client/src/validators/ValidatorCard.tsx` — same heuristic on list cards
- `client/src/learn/Learn.tsx` — insufficient-data covers history + non-normalizable; grades need ≥14d + normalizable

### Item 3 — reward address
- `server/scripts/audit-reward-addresses.ts` (new)
- `server/package.json` — `audit:rewards` script
- `server/src/validatorSync.ts` — permanent resolve failure logging / skip-per-cycle
- `server/src/diagnostics.ts` — `summarizeRewardAddressGaps` + payload field `rewardAddressGaps`

### Item 4 — RPC docs
- `.env.example` — self-hosted / historical RPC + rebackfill notes
- `README.md` — env table note
- `docs/spikes/indexer.md` — when historical RPC helps vs not

## Verification

```bash
npx vitest run tests/unit/server/payout-classifier.test.ts \
  tests/unit/server/observation-scoring.test.ts \
  tests/unit/server/validator-sync.test.ts \
  tests/unit/server/validators-api.test.ts \
  tests/unit/server/observations-api.test.ts \
  tests/unit/server/response-cache-diagnostics.test.ts
# → 6 files, 171 tests passed

npm run build
# → server tsc + client build OK

npm run test:client
# → 16 files, 89 tests passed
```

**Brief minimum suites:** payout-classifier (70) + observation-scoring (48) = 118 passed.

## Residual risks / concerns

1. **Pre-existing flaky/failing test (unrelated):**  
   `tests/unit/server/staking-intents.test.ts` → `intent → confirm pending → confirm success over HTTP` returns **401** instead of 200. Reproduced in isolation; no files in this change touch auth/staking intents. Do not block merge of observation-bottleneck work on this.

2. **Reclassification lag:** New normalizations apply on next indexer classify cycle (`CALC_VERSION` 2 observations written alongside v1). Registry `schedule_every_hours` updates on next validator sync. No forced rebackfill required.

3. **UI heuristic on list/hero:** Profile/ValidatorCard use `historyDepthDays >= 7` + `insufficient-data` as proxy for “not just shallow history” without schedule payload on list API. Evidence uses true `schedule.normalizable`. Slight mismatch possible for edge cases (e.g. deep history + normalizable + too few windows still gets the broader definition on hero).

4. **Registry reward field:** Official validators-api does not supply `rewardAddress`; resolve still RPC-only. COALESCE keep-existing behavior unchanged.

5. **Permanent resolve log volume:** One JSON log line per hard-failed address per sync cycle (plus summary). Acceptable for ~few missing listed validators; watch if all-observable resolve is enabled broadly.

## Operator notes

```bash
# Audit listed validators × reward × indexed txs
DATA_DIR=./data npm run audit:rewards --prefix server

# Point at archive node, one-shot deeper walk
# NIMIQ_RPC_URL=https://your-node ... INDEXER_REBACKFILL=true  # one boot only
```
