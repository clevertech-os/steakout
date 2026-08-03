# Phase 0 — De-risk spike (Aug 2–9)

**Goal:** prove the protocol path and start accumulating payout history before the competition window. Every spike writes its evidence to `docs/spikes/` so P0-09 (kill/scope decision) is made on facts, not vibes. See [ROADMAP.md](ROADMAP.md) for the day-by-day layout.

Board: [README.md](README.md#phase-0--de-risk-spike-aug-29)

---

### P0-01 — App scaffold & engineering baseline

- **Team:** Implementation
- **Depends on:** —
- **Spec refs:** SPEC §8.1, §8.6
- **Docs:** ARCHITECTURE.md §2, STYLING.md §2, AGENTS.md §3/§5
- **Human-in-the-loop:** no

**Scope:** create the monorepo skeleton the whole team will build in: root scripts, `client/` (Vite + React 19 + TypeScript), `server/` (Express + TypeScript via tsx), `tests/` layout, and deployment baseline adapted from VeriLock's `Dockerfile`/`railway.toml`. No product features.

**Deliverables:**
- Root `package.json` scripts exactly as listed in AGENTS.md §3 (`dev`, `dev:server`, `dev:client`, `test`, `test:client`, `test:server`, `build`, `smoke` — smoke may be a stub)
- `client/`: Vite+React+TS app, strict tsconfig, `nimiq-css` installed, `public/assets/fonts/` with Mulish + Fira Mono, empty route shell rendering "Steakout"
- `server/`: Express + tsx, `better-sqlite3`, `helmet`, `/api/health` returning `{ ok: true }`, `src/db.ts` opening SQLite with WAL + foreign keys
- `tests/` directory layout + vitest configured for both packages (one trivial passing test each)
- `Dockerfile`, `railway.toml`, `.env.example` (`PORT`, `NIMIQ_NETWORK`, `NIMIQ_RPC_URL`, `DATA_DIR`, `SESSION_SECRET`, `CORS_ORIGIN`)
- `docs/spikes/` directory with an index README

**Acceptance criteria:**
- [ ] `npm run dev` boots server (:3000) + client (:5173) concurrently; client renders; `/api/health` 200
- [ ] `npm run build` typechecks and builds both packages from clean install
- [ ] `npm test` runs vitest in both packages green
- [ ] nimiq-css import resolves; a Mulish-rendered heading and one `nq-card` visible on the shell page
- [ ] No product code, no secrets, `.env.example` complete

**Verification:** clean clone → `npm install && npm run build && npm test && npm run dev` (manual boot check).

**Notes:**
- Implementation complete. Mainnet block probe and guarded `/spike` route verified. Device verification remains blocked: no Nimiq Pay testnet session, provider injection, account listing, signing result, or signature fixture yet. The configured testnet RPC hostname currently fails DNS resolution.

---

### P0-02 — Mini App SDK smoke screen

- **Team:** Implementation
- **Depends on:** P0-01
- **Spec refs:** SPEC §8.4
- **Docs:** ARCHITECTURE.md §5.1–5.2
- **Human-in-the-loop:** yes — final check inside Nimiq Pay on a device

**Scope:** a throwaway route (`/spike`) in the client that exercises the Mini App SDK end-to-end: provider detection/warmup, `listAccounts()`, `sign()` of a fixed challenge string, and (server probe) `getBlockNumber`. Purpose is evidence that wallet connection + signed challenge work before any real feature is built.

**Deliverables:**
- `client/src/` spike page showing: provider present?, connected address, signature result for a fixed message, block number from the server probe
- `server/src/` minimal probe endpoint calling `getBlockNumber` via RPC
- `docs/spikes/sdk-smoke.md`: SDK version, Pay app version tested, exact call results, screenshots
- Signature fixture saved to `tests/fixtures/wallet/` (address, message, signature, pubkey) for auth tests later

**Acceptance criteria:**
- [ ] `listAccounts()` returns the expected address in Nimiq Pay (testnet)
- [ ] `sign()` returns a signature over the exact challenge string; result recorded
- [ ] Server probe returns current block number
- [ ] Spike report lists exact SDK + Pay versions and any deviations from docs
- [ ] `/spike` route is feature-flagged/guarded so it can't ship to production by accident

**Verification:** human runs the route inside Nimiq Pay testnet and confirms the report matches the screen; `npm test` green.

**Notes:**
- Implementation complete. Mainnet block probe and guarded `/spike` route verified. Device verification remains blocked: no Nimiq Pay testnet session, provider injection, account listing, signing result, or signature fixture yet. The configured testnet RPC hostname currently fails DNS resolution.

---

### P0-03 — Testnet staking-method spike

- **Team:** Implementation
- **Depends on:** P0-02
- **Spec refs:** SPEC §8.4, §22 (actions 1–2)
- **Docs:** ARCHITECTURE.md §5.1
- **Human-in-the-loop:** yes — device + testnet NIM required

**Scope:** exercise **all six** native staking provider methods on testnet with minimum safe amounts and record ground truth. This is the highest-risk unknown in the project: docs and package types disagree on return values.

**Deliverables:**
- `docs/spikes/staking-methods.md` with, per method (`sendNewStakerTransaction`, `sendStakeTransaction`, `sendSetActiveStakeTransaction`, `sendUpdateStakerTransaction`, `sendRetireStakeTransaction`, `sendRemoveStakeTransaction`):
  - works / fails / unsupported
  - exact return value (hash vs serialized tx vs other), pasted raw
  - exact error messages for cancel/insufficient balance/invalid state
  - observed protocol state transition and timing
- Observed minimum stake (protocol vs wallet UI) recorded
- All resulting tx hashes recorded and fetchable via RPC
- Fixture: one confirmed staking tx RPC response per working method → `tests/fixtures/rpc/staking/`

**Acceptance criteria:**
- [ ] `sendNewStakerTransaction` + `sendStakeTransaction` proven working on a real device, or failure documented precisely
- [ ] Return-value semantics resolved and written down for all six methods
- [ ] Cancel path returns a useful error object (shape documented)
- [ ] A pending tx followed through to on-chain confirmation at least once
- [ ] Report ends with an explicit "safe for Week 1 scope" list of methods

**Verification:** report reviewed by owner; tx hashes independently resolvable via RPC/explorer.

**Notes:**
- The guarded six-method harness is implemented at `/spike/staking-methods`. It requires explicit testnet acknowledgement and per-method clicks, refuses non-testnet providers, and records raw result/error data. All device-dependent observations, transaction hashes, and staking fixtures remain unresolved until a Nimiq Pay testnet session is available.

---

### P0-04 — RPC read-layer probe + fixtures

- **Team:** Implementation
- **Depends on:** P0-01
- **Spec refs:** SPEC §8.4 (Read APIs)
- **Docs:** ARCHITECTURE.md §5.3, DATA-MODEL.md §4
- **Human-in-the-loop:** no

**Scope:** validate every RPC method the server read layer depends on, against testnet (and mainnet for read-only checks), and capture raw responses as test fixtures. Decide definitively whether restake position reads are reliable enough for v1 (input to P0-09 and P3-02).

**Deliverables:**
- `server/scripts/probe-rpc.ts` (kept): calls `getBlockNumber`, `getValidatorByAddress`, `getActiveValidators`, `getAccountByAddress`, `getStakerByAddress`, `getTransactionsByAddress` (incl. pagination), `getTransactionByHash`
- Raw responses → `tests/fixtures/rpc/*.json` with `_meta.json` (endpoint, network, date)
- `docs/spikes/rpc-reads.md`: per method — works?, response shape (field list), pagination semantics, latency observed, rate-limit behavior observed, malformed/edge responses
- Explicit verdict: can we reliably read staker active/inactive/retired balances? Can we derive `Withdrawable` timing?

**Acceptance criteria:**
- [ ] Every listed method has a captured fixture and a shape summary
- [ ] Pagination semantics of `getTransactionsByAddress` written down (ordering, limits, cursor/block behavior)
- [ ] A known testnet staker address renders active/inactive/retired balances from raw RPC data
- [ ] Verdict on restake read reliability stated in one paragraph
- [ ] Rate-limit/error behavior documented (status codes, retry-after)

**Verification:** probe reruns green against testnet; fixtures load in a vitest sanity test.

**Notes:**
- Implementation complete with sanitized mainnet fixtures and probe tests. Testnet staker/account fixtures, rate-limit behavior, and lifecycle-state verification remain blocked pending a working testnet RPC/address.

---

### P0-05 — Validators API ingestion probe

- **Team:** Implementation
- **Depends on:** P0-01
- **Spec refs:** SPEC §8.8 (start with listed validators), Day-4 exit criteria
- **Docs:** DATA-MODEL.md (validators table), API.md §3
- **Human-in-the-loop:** no

**Scope:** integrate the official validators API and prove we can produce normalized validator records for both `only-known=true` and all-observable modes, including reward-address resolution via RPC and careful handling of missing fields and score `-1`.

**Deliverables:**
- `server/src/validators-api.ts` (first version): fetch + normalize registry payloads
- Normalization mapping documented: fee, payout type (`direct`/`restake`/`unknown`), schedule raw string, score (`-1`/missing → null), dominance, stakers count
- Reward-address resolution via `getValidatorByAddress` (from P0-04 findings)
- Fixtures → `tests/fixtures/registry/` (both modes)
- `docs/spikes/validators-api.md`: counts (listed vs observable), % stake hidden by `only-known=true`, field completeness stats, list of declared payout schedules seen in the wild (input to P2-02)

**Acceptance criteria:**
- [ ] Both modes ingested; listed vs all-observable delta quantified in the report
- [ ] Every record carries source timestamp
- [ ] Missing fields and score `-1` normalize to nulls, never to zero/fake values
- [ ] Reward address resolved for ≥ 90% of listed validators (or gaps documented)
- [ ] Raw declared schedule strings enumerated in the report

**Verification:** fixture-based vitest asserting normalization rules; report reviewed.

**Notes:**
- Complete. Mainnet capture includes 24 known and 78 observable validators. Reward resolution reached 19/24 listed validators; the remaining RPC errors/429s are documented in `docs/spikes/validators-api.md` and require a later retry or less rate-limited source.

---

### P0-06 — Schema + payout indexer live

- **Team:** Implementation
- **Depends on:** P0-04, P0-05
- **Spec refs:** SPEC §8.7, §8.8
- **Docs:** DATA-MODEL.md §1–2 (binding)
- **Human-in-the-loop:** deploy assistance (Railway) if needed

**Scope:** create the full database schema and the first working indexer polling listed validators' reward addresses on a schedule — deployed somewhere persistent so history starts accumulating **now**, before any UI exists.

**Deliverables:**
- `server/src/db.ts` implementing the DDL in DATA-MODEL.md §1 verbatim (additive migration runner included)
- `server/src/payoutIndexer.ts` v1: per-address incremental fetch → normalize → `INSERT OR IGNORE` → cursor advance only after successful page; exponential backoff; concurrency ≤ 2
- Scheduler running every 30–60 min; structured cycle logs
- `/api/health` extended with indexer fields per API.md §3
- Deployed to Railway (or equivalent persistent env) against mainnet reads; evidence of ≥ 24 h continuous operation in Notes
- Backfill started toward ≥ 7 days of history for listed validators

**Acceptance criteria:**
- [ ] Schema matches DATA-MODEL.md §1 exactly (tables, indexes, PKs)
- [ ] Duplicate fetch of the same page inserts zero duplicates (hash PK dedup)
- [ ] Cursor never advances on partial/failed page (proven by test or log evidence)
- [ ] Health endpoint shows `lastRunAt`, `addressesIndexed`, `lagBlocks`
- [ ] Indexer demonstrably accumulates rows across process restarts (cursor recovery)

**Verification:** `tests/integration` cursor/restart test (with P0-08 harness); deploy logs pasted in Notes.

**Notes:**
- Local schema, incremental indexer, retry/cursor logic, scheduler entry, health fields, and regression tests are complete. Cursor advancement was corrected for existing cursors.
- **Deployed 2026-08-03** to Railway project `steakout`, service domain https://steakout-production.up.railway.app, volume `/data` for SQLite, `INDEXER_ENABLED=true` on mainnet (`rpc.nimiqwatch.com`), seed reward addresses from P0-07. Evidence: `docs/spikes/indexer.md`. Residual: re-check health after ≥ 24 h for continuous operation; testnet path still DNS-blocked (mainnet is the accumulation path).

---

### P0-07 — Direct-payout classification spike

- **Team:** Implementation
- **Depends on:** P0-06
- **Spec refs:** SPEC §7.2, Day-6 exit criteria
- **Docs:** METHODOLOGY.md §4
- **Human-in-the-loop:** no

**Scope:** using real indexed data from P0-06, prototype payout-run grouping and schedule adherence for at least one direct-payout validator, producing a local (non-public) report. Purpose: validate window size, run detection, and that observations can be produced **without** fee or intent claims.

**Deliverables:**
- `server/src/payoutClassifier.ts` v0 (grouping only, behind a script entry: `server/scripts/classify.ts`)
- `docs/spikes/payout-classification.md`: chosen run-window (default 60 min) with evidence from real data, expected-vs-observed windows for ≥ 1 validator, anomalies seen (consolidated payments, treasury moves), confirmation that tx links resolve in an explorer
- Recommendation for adherence thresholds (input to METHODOLOGY.md §3 defaults)

**Acceptance criteria:**
- [x] Report shows observed payout runs for ≥ 1 real validator with tx hashes + block ranges
- [x] Run-window choice justified with before/after grouping examples
- [x] No fee/intent/good-bad judgments anywhere in the report
- [ ] At least one explorer link manually verified by owner

**Verification:** re-running the script reproduces the report from the DB alone (no refetch).

**Notes:**
- Agent close-out 2026-08-03: classifier v0, `server/scripts/classify.ts`, spike report, and unit tests are complete on real mainnet-indexed data (ObsidianStake + Nimiq.Fun).
- Deliverables: `server/src/payoutClassifier.ts`, `server/scripts/classify.ts` (`npm run classify` in `server/package.json`), `docs/spikes/payout-classification.md`, `tests/unit/server/payout-classifier.test.ts` (29 tests).
- Verification: `npm run test:server` — 43/43 passed including 29 classifier tests. `DATA_DIR=./data npm run classify --prefix server -- --reward-address "…" …` reproduces run tables from local SQLite only (no RPC).
- Report: 60-minute run window kept (gap distribution bimodal; 15–240 min windows yield identical run counts); first-tx hashes + block ranges for both validators; adherence threshold recommendations for METHODOLOGY.md §3; neutral language only.
- Residual (owner human gate): open one explorer link (e.g. https://nimiq.watch/#3645E6FC44DC3E329A3FA0D30331C84958E9BD95227235E7AFD334FDAE1C1D18) and confirm it matches the indexed ObsidianStake run-1 first tx. RPC re-fetch already matches; page render not agent-verifiable.


---

### P0-08 — Test fixture harness

- **Team:** Testing
- **Depends on:** P0-04, P0-05
- **Docs:** TESTING.md §3
- **Human-in-the-loop:** no

**Scope:** build the fixture loading + RPC mocking utilities every later test suite depends on.

**Deliverables:**
- `tests/helpers/fixtures.ts`: typed loader for `tests/fixtures/**` with `_meta.json` validation
- `tests/helpers/mockRpc.ts`: RPC server mock driven by fixtures (method → fixture mapping, error injection, call counting)
- Example test demonstrating both helpers
- Sanitization pass: no real user addresses in fixtures (validator addresses are public and fine)

**Acceptance criteria:**
- [ ] Any test can replace the RPC layer with fixtures in ≤ 5 lines
- [ ] Error/timeout injection works (drives retry-path tests later)
- [ ] `_meta.json` present and valid for every fixture
- [ ] `npm test` green

**Verification:** example suite runs in CI-equivalent clean env (`npm ci && npm test`).

**Notes:**
- Complete. Typed fixture loader, metadata validation, mock RPC mapping, call counting, error/timeout injection, and example tests are implemented.

---

### P0-09 — Kill-decision memo + scope freeze

- **Team:** Owner (agents prepare inputs)
- **Depends on:** P0-03, P0-04, P0-06, P0-07
- **Spec refs:** SPEC §19, §11 (scope fallback)
- **Human-in-the-loop:** yes — owner decision

**Scope:** assemble the Week-0 evidence into a decision memo; owner decides go / fallback / scope reduction and freezes v1 scope.

**Deliverables:**
- `docs/spikes/kill-decision.md`: summary of staking-method results, RPC reliability, indexer throughput, classification viability; explicit answers to SPEC §19 "kill or pivot" questions; chosen scope incl. listed-only vs all-observable validators and restake in/out; frozen v1 scope statement
- Board updated: tasks affected by the decision marked `cut` with notes
- Public build note drafted (owner posts)

**Acceptance criteria:**
- [ ] Every SPEC §19 Week-0 question has a written answer with evidence links
- [ ] v1 scope statement is a single unambiguous list
- [ ] Board reflects the decision within the day

**Verification:** owner signs off in the memo.

**Notes:**
-

---

## Phase 0 milestone (gate G1)

Proceed to Phase 1 only when: P0-06 shows history accumulating continuously, P0-03 proves at least create-staker + add-stake (or fallback activated), and P0-09 scope is frozen.
