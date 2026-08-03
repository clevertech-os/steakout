# Kill / Scope Decision Memo — DRAFT (agent inputs)

**Status:** DRAFT — prepared by agents for owner sign-off. **Not signed. Not frozen.**  
**Task:** P0-09  
**Assembled:** 2026-08-03  
**Owner action required:** answer go / fallback / scope reduction; freeze v1 scope; publish public build note.

This document assembles Week-0 spike evidence only. It does not invent device results, does not claim staking writes are proven, and does not mark tasks `cut`. Language follows [METHODOLOGY.md](../METHODOLOGY.md): `observed`, `not observed`, `insufficient data`, `unresolved`.

Final owner-signed memo (when ready): `docs/spikes/kill-decision.md` (not created by this draft).

---

## 1. Executive summary — proven vs blocked

| Area | Status | One-line finding |
|---|---|---|
| App scaffold / CI baseline | **Proven** | Monorepo boots; build/test path exists (P0-01). |
| Mini App SDK package + harness | **Proven (code only)** | SDK `0.1.0` wired; guarded `/spike` route; no device session. |
| Provider inject / `listAccounts` / `sign` | **Blocked (device)** | No Nimiq Pay testnet session; no signature fixture. |
| Six native staking methods | **Blocked (device)** | Harness at `/spike/staking-methods`; **no method cleared** for production. |
| Mainnet RPC reads | **Proven (partial)** | Block, validator, account, txs, pagination shapes captured on `rpc.nimiqwatch.com`. |
| Testnet RPC | **Blocked** | Configured testnet hostname fails DNS from workspace. |
| Staker lifecycle / `Withdrawable` timing | **Insufficient data** | Fields for active/inactive/retired exist; no release height; no full lifecycle matrix. |
| Validators registry | **Proven** | 24 listed / 78 observable; normalization + null rules work. |
| Reward-address resolution | **Partial** | 19/24 listed resolved in capture; 429s/errors on public RPC. |
| Payout indexer (schema + logic) | **Proven** | Dedup, cursor-on-success, health fields, tests. |
| Indexer deploy | **Proven (continuity residual)** | Railway mainnet deploy 2026-08-03; **≥24 h continuous operation not yet re-checked**. |
| Direct-payout classification | **Proven (local)** | Real runs for ≥2 listed validators; 60 min window justified; no fee/intent claims. |
| Explorer link human check | **Blocked (owner)** | RPC re-fetch matches; page render not agent-verified. |
| Custody risk | **Not observed** | Design and harnesses remain non-custodial; no private-key path. |

**Gate G1 readiness (from [phase-0-spike.md](../../plan/phase-0-spike.md)):** history accumulation is started on mainnet; create-staker + add-stake are **not** device-proven; scope is **not** frozen until owner decision.

---

## 2. Evidence index

| Spike report | Absolute path | Task |
|---|---|---|
| SDK smoke | [`docs/spikes/sdk-smoke.md`](sdk-smoke.md) | P0-02 |
| Staking methods | [`docs/spikes/staking-methods.md`](staking-methods.md) | P0-03 |
| RPC reads | [`docs/spikes/rpc-reads.md`](rpc-reads.md) | P0-04 |
| Validators API | [`docs/spikes/validators-api.md`](validators-api.md) | P0-05 |
| Indexer | [`docs/spikes/indexer.md`](indexer.md) | P0-06 |
| Payout classification | [`docs/spikes/payout-classification.md`](payout-classification.md) | P0-07 |
| Integration audit | [`docs/spikes/integration-audit.md`](integration-audit.md) | P0-02/03/04 context |
| Local classify outputs (gitignored) | `docs/spikes/local/` | P0-07 |

---

## 3. SPEC §19 — kill or pivot in Week 0

Answers are evidence-based recommendations for the owner. They are **not** a signed kill decision.

### 3.1 Native staking writes cannot be triggered in the shipped Nimiq Pay environment

| | |
|---|---|
| **Observation** | **Unresolved.** No device run inside Nimiq Pay. Package types declare all six methods (`Promise<string \| ErrorResponse>`); harness is guarded testnet-only. No approval, cancel, return value, or chain confirmation was observed. |
| **Evidence** | [`docs/spikes/staking-methods.md`](staking-methods.md) (Safe-for-Week-1: *no method cleared*); [`docs/spikes/sdk-smoke.md`](sdk-smoke.md) (device table all pending); [`docs/spikes/integration-audit.md`](integration-audit.md) (return type = package only). |
| **Implication for owner** | This kill criterion is **not disproven and not proven**. Default SPEC path if still unresolved at freeze: **activate read-only accountability fallback** ([SPEC §19](../SPEC.md), Day-7 kill line) until device evidence lands. Do not ship production stake CTAs on package types alone. |

### 3.2 Transactions cannot be confirmed reliably from the available RPC path

| | |
|---|---|
| **Observation** | **Mainnet reads work for confirmation plumbing; write-confirm path untested end-to-end.** `getTransactionByHash`, `getTransactionsByAddress` (cursor pagination), and block number succeed on `https://rpc.nimiqwatch.com`. Classifier re-fetched sample payout hashes and matched indexed rows. No staking write was ever submitted, so “confirm a user stake intent” is not demonstrated. Rate limits (HTTP 429) and JSON-RPC errors on missing entities are observed; no controlled 429 matrix. |
| **Evidence** | [`docs/spikes/rpc-reads.md`](rpc-reads.md); [`docs/spikes/payout-classification.md`](payout-classification.md) §1, §7; [`docs/spikes/indexer.md`](indexer.md). |
| **Implication** | Read-side confirmation infrastructure is **usable for mainnet monitoring**. Stake-intent confirmation remains gated on P0-03 + P1-06. Public RPC needs retry/backoff (already in indexer) and should not be assumed unlimited. |

### 3.3 The minimum stake or protocol state cannot be explained safely

| | |
|---|---|
| **Observation** | **Partially unresolved.** Staker shape fields (`balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`) are documented from live/protocol sources. `Withdrawable` timing **cannot** be derived safely: RPC does not expose inactive-release / equivalent height. Protocol minimum stake and full lifecycle transitions were **not** observed on device/testnet. |
| **Evidence** | [`docs/spikes/rpc-reads.md`](rpc-reads.md) Verdict; [`docs/spikes/integration-audit.md`](integration-audit.md); [`docs/spikes/staking-methods.md`](staking-methods.md). |
| **Implication** | Safe UI: show **observed balances and delegation** with timestamps; label missing states `insufficient data`. **Do not** ship unstaking countdown / `Withdrawable` deadline from `inactiveFrom` alone. Minimum-stake copy needs protocol docs + device observation before assertive claims. |

### 3.4 The app would need to custody user funds

| | |
|---|---|
| **Observation** | **Not indicated.** Architecture and spikes keep writes behind Nimiq Pay provider methods; harnesses refuse keys/seeds; server never accepts client “tx succeeded” claims as truth (product invariant). No custodial design path observed in Phase 0 work. |
| **Evidence** | [AGENTS.md](../../Agents.md) §4 invariants; [`docs/spikes/staking-methods.md`](staking-methods.md) Safety Boundary; SPEC non-custodial product framing. |
| **Implication** | This kill criterion does **not** fire on current evidence. Owner should keep non-custodial boundary in freeze statement. |

### 3.5 Payout history cannot be collected at a useful cadence

| | |
|---|---|
| **Observation** | **Collectable on mainnet with limits.** Indexer deployed to Railway (`INDEXER_ENABLED=true`, mainnet RPC, volume at `/data`), deep-backfill config (up to 21 listed reward addresses, maxPages 100, concurrency 1). Local cycles inserted 10k txs per of two seed addresses; cursor did not advance on partial/rate-limited failure. History depth under earlier 20-page cap was ~5–6.4 days for high-volume addresses — below 7-day / 14-day methodology targets until deeper walk completes. **≥24 h continuous deploy operation not yet re-checked.** |
| **Evidence** | [`docs/spikes/indexer.md`](indexer.md); [`docs/spikes/payout-classification.md`](payout-classification.md) §1, §7. |
| **Implication** | Kill criterion **does not fire** for “cannot collect at all.” Scope should assume **listed-first, rate-limit-aware** accumulation; graded adherence labels stay off until depth thresholds are met. |

---

## 4. SPEC §19 — reduce scope if

### 4.1 Direct payout classification works but restake position reads do not

| | |
|---|---|
| **Observation** | Direct-payout run grouping works on real indexed data (ObsidianStake, Nimiq.Fun). Restake position reads: balance/delegation fields readable for known stakers; full restake analytics (growth vs expected range, lifecycle parity) **not** reliable enough for a complete v1 lifecycle claim. |
| **Evidence** | [`docs/spikes/payout-classification.md`](payout-classification.md); [`docs/spikes/rpc-reads.md`](rpc-reads.md) restake verdict. |
| **Recommendation** | **Ship direct-payout monitoring first.** Mark restake analytics as explicit limitation / later phase (aligns SPEC §7.3). Optional: show raw staker balances only, labeled observation not “validator payout verified.” |

### 4.2 Only a small number of validators have normalizable schedules

| | |
|---|---|
| **Observation** | Among 24 listed: 15/24 have non-empty `payoutSchedule` strings; free-text and cron-like forms present. Classifier `normalizeScheduleHours` accepts only minimal forms (`hourly`, `every N hours`, `daily`, `twice daily`). Two “Every 12 hours” validators fully exercised. Many schedules remain non-normalizable → `insufficient data` for adherence, not fabricated cadence. |
| **Evidence** | [`docs/spikes/validators-api.md`](validators-api.md) schedule inventory; [`docs/spikes/payout-classification.md`](payout-classification.md) §2, §4. |
| **Recommendation** | v1: **listed validators**; adherence only where schedule normalizes **and** history depth ≥ methodology threshold. Others: declarations + raw observations only. |

### 4.3 RPC throughput supports listed validators but not all observable validators

| | |
|---|---|
| **Observation** | Listed: 24 known, reward resolve 19/24 in one capture (429s). All-observable: 78 records; known-only omits ~39.7% of stake with non-null balance in that capture. Indexer default `INDEXER_LISTED_ONLY=true` with 21 resolved reward addresses. Public RPC 429s are normal under multi-address backfill. |
| **Evidence** | [`docs/spikes/validators-api.md`](validators-api.md); [`docs/spikes/indexer.md`](indexer.md). |
| **Recommendation** | **Start with listed validators only** for indexing, profiles, and network summaries that imply completeness. Do not silently treat known-only as full network. Expand all-observable only after RPC capacity / second source. |

### 4.4 Mobile wallet handoff takes longer than the core staking flow

| | |
|---|---|
| **Observation** | **Not measured.** No device handoff timing. |
| **Evidence** | Device sections of [`sdk-smoke.md`](sdk-smoke.md), [`staking-methods.md`](staking-methods.md). |
| **Recommendation** | Treat as open human gate; if device session shows long handoff, cut secondary stake actions before core connect → select validator → review → confirm. |

---

## 5. SPEC §19 — do not launch a metric if

| Rule | Phase-0 application | Recommendation |
|---|---|---|
| Definition cannot fit in one sentence | Observation metrics in METHODOLOGY are one-sentence capable; “effective fee,” fraud scores, guaranteed APY are banned in v1 (product invariants). | Keep banned list; only ship metrics with definition + source + freshness + status label. |
| Source tx / account state cannot be linked | Classification attaches first/last tx hashes and explorer URL form; RPC re-fetch matched samples. Owner explorer page check open. | Ship tx-linked observations only after owner verifies at least one explorer link (or equivalent). |
| Requires guessing transfer intent | Spike explicitly avoided fee/intent; noted staking-contract txs and large co-occurring transfers as **observed patterns only**. | Never label missing payment as wrongdoing; atypical runs stay visible with neutral notes. |
| Insufficient data as negative score | History &lt; 7–14 days → no graded adherence status assigned in spike. | Do not assign `on-schedule` / `irregular` until depth rules met; show `insufficient data`. |
| False-positive “dishonest” label | Grid boundary artifact (±1 min) can swing a short window set by ~7 pp. | Prefer ≥14 days before graded labels (spike recommendation); neutral language only. |

Evidence: [`docs/spikes/payout-classification.md`](payout-classification.md) §§4–6; [AGENTS.md](../../Agents.md) §4; [METHODOLOGY.md](../METHODOLOGY.md).

---

## 6. Day-7 decision questions (SPEC Week-0 Day 7)

| Question | Agent recommendation | Confidence |
|---|---|---|
| Staking-method results with real testnet evidence? | **Insufficient device evidence.** Proceed with **read-only accountability fallback** for public stake writes until P0-03 device criteria pass; keep harness for when device is available. | High (absence is documented) |
| RPC reliability and indexer throughput? | Mainnet reads **usable**; pagination understood; 429s require backoff (implemented). Indexer **deployed**; deep backfill configured; **24h continuity residual**. Testnet RPC **not available** from workspace. | Medium–high for mainnet reads |
| Restake analytics in scope? | **Out of full v1 analytics.** Optional: position balances as raw reads with limitations. No restake “payout verified” parity. | High on evidence |
| 24 listed vs expand immediately? | **Listed-only** for v1 indexing and default UX; expose all-observable only as clearly labeled incomplete expansion later. | High |
| Freeze v1 scope? | **Owner only.** Recommended list in §7. | — |

---

## 7. Recommended v1 scope list (evidence-based; owner must freeze)

This is a **recommended** freeze list, not an approved product decision.

### In scope (v1)

1. **Non-custodial** Nimiq Pay Mini App shell; connect wallet when device path is proven (or connect-only if sign works before stake methods).
2. **Mainnet reads** via public/configured RPC with retry/backoff: validators, staker balances when present, transaction history for monitoring.
3. **Listed validators (≤24)** as default catalog; registry declarations (fee, payout type, schedule raw, official Trust Score) with nulls preserved.
4. **Payout indexer** on listed validators with resolved reward addresses; continuous mainnet accumulation; health surface for lag/last run.
5. **Direct-payout observations:** run grouping (60-minute window), expected-vs-observed windows only when schedule normalizes and history depth meets methodology; status labels `Verified observation` / `Registry declaration` / `Inferred` / `Insufficient data` / `Unavailable` as applicable.
6. **Validator profile** for listed validators: official score **alongside** Steakout observations; shareable public profile without requiring wallet (when implemented).
7. **Position display:** observed active/inactive/retired balances and delegation with timestamp; no invented withdrawable countdown.
8. **Review-before-confirm** for any provider write method once device-cleared (action, amount NIM, validator name+address, state transition).
9. **Server-verified confirmation** of staking txs (match chain data to authenticated address + intent) — only after return-value semantics resolved on device.
10. **Honest metric packaging** only; banned: effective fee, fraud/scam scores, guaranteed APY, “best validator,” missing payment as wrongdoing.

### Explicitly out / deferred until evidence

| Item | Reason |
|---|---|
| Production stake writes (`sendNewStaker*`, `sendStake*`, etc.) | Device unresolved ([`staking-methods.md`](staking-methods.md)) |
| Full restake analytics parity | Restake read reliability incomplete ([`rpc-reads.md`](rpc-reads.md)); SPEC §7.3 fallback |
| All-observable default indexing / “full network” claims | RPC load + incomplete reward resolution + stake omitted by known-only |
| Graded adherence labels on &lt;7–14 days history | Methodology + spike boundary sensitivity |
| `Withdrawable` countdown | No safe release field on RPC Staker shape |
| Testnet-first production path | Testnet RPC DNS failure; mainnet is accumulation path |
| Custody, key export, or client-trusted “success” claims | Product invariants |
| Alerts / social / effective fee / rankings | Pre-cut under breadth risk (SPEC risk table / reduce-scope) |

### Stake-write contingency (SPEC Day-7 kill line)

If at owner freeze time device evidence is still missing:

- **Activate read-only accountability fallback before Week 1 public claims of “stake from Steakout.”**
- Continue indexer + classification + registry profiles.
- Keep `/spike` and `/spike/staking-methods` guarded for internal device work.
- Unblock production stake CTAs only after: `listAccounts` + at least `sendNewStakerTransaction` and/or `sendStakeTransaction` observed, return semantics recorded, one pending→confirmed path, fixtures under `tests/fixtures/rpc/staking/` as applicable.

---

## 8. Open residual human gates

| Gate | Who | Why it remains open | Suggested check |
|---|---|---|---|
| Nimiq Pay testnet session: provider inject, `listAccounts`, `sign` | Owner / device operator | No device in agent workspace | Fill tables in [`sdk-smoke.md`](sdk-smoke.md); save wallet fixture (no secrets) |
| Six staking methods + cancel/error shapes | Owner / device operator | Highest-risk unknown | Run [`staking-methods.md`](staking-methods.md) harness on testnet |
| Explorer page click | Owner | nimiq.watch is client-rendered; agents matched RPC only | Open e.g. https://nimiq.watch/#3645E6FC44DC3E329A3FA0D30331C84958E9BD95227235E7AFD334FDAE1C1D18 and confirm vs ObsidianStake run-1 first tx |
| ≥24 h indexer continuity | Owner / ops | Deploy day is 2026-08-03; continuity not re-sampled | `GET https://steakout-production.up.railway.app/api/health` — `indexer.lastRunAt` advances; volume retains SQLite across restart |
| Testnet RPC access | Infra / Nimiq | Hostname DNS failure | Alternate testnet RPC or local node if stake writes need testnet confirm |
| Reward address retry for remaining listed validators | Implementation (later) | 3–5 listed unresolved under 429/error | Retry resolve; expand seed set when non-null |
| Public build note | Owner | Not drafted by agents in this memo | Post after freeze |

---

## 9. Suggested owner decision options (menu only)

Agents do **not** choose. Suggested frames:

| Option | When to pick | Immediate effect |
|---|---|---|
| **A. Go full path** | Device proves create-staker + add-stake + confirmable txs | Freeze §7 in-scope including stake writes; start P1-06 unblocked |
| **B. Go with read-only fallback** | Device still blocked but indexer/classification acceptable | Freeze §7 without production stake writes; accountability + profiles first |
| **C. Scope reduction beyond B** | RPC/history too thin or schedule coverage too low | Listed-only + insufficient-data-heavy UX; cut restake, alerts, expansion |
| **D. Kill / pivot** | Custody required, or history + reads both fail useful cadence | Stop Week-1 stake product claims; reassess competition positioning |

On current evidence, agents lean **B** (read-only fallback + listed direct-payout monitoring + mainnet indexer) **unless** a device session lands before freeze. That is a recommendation, not a decision.

---

## 10. What this draft does not do

- Does not mark board tasks `cut`.
- Does not create `docs/spikes/kill-decision.md` as signed.
- Does not claim owner sign-off, freeze, or public build note.
- Does not change product code or commit.
- Does not invent device, testnet, or 24h-continuity results.

---

## 11. Owner sign-off block (leave blank until decided)

```
Decision:     [ ] A  [ ] B  [ ] C  [ ] D  [ ] Other: _______________
v1 scope:     (paste or attach frozen list)
Date:         _______________
Signed by:    _______________
Notes:        _______________
```

**End of DRAFT.**
