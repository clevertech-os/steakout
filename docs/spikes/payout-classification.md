# Direct-Payout Classification Spike

**Task:** P0-07
**Date:** 2026-08-03
**Network:** mainnet (`https://rpc.nimiqwatch.com`)
**Status:** Local classification prototype complete on real indexed data

This spike validates payout-run grouping on real chain data and records the
run-window choice required by [docs/METHODOLOGY.md §4.1](../METHODOLOGY.md).
All statements below are observed chain data or registry declarations. No fee,
intent, or payout-purpose judgment is made or implied. Language follows the
[METHODOLOGY.md §7](../METHODOLOGY.md) dictionary: `observed`,
`not observed`, `insufficient data`.

## 1. Real-data ingestion

Two listed validators were selected from the P0-05 normalized registry data
because they (a) declare payout type `direct`, (b) declare a schedule that
normalizes under METHODOLOGY.md §4.2 (`Every 12 hours` → every 12 hours), and
(c) have reward addresses resolved in the P0-04/P0-05 evidence set:

| Validator | Validator address | Indexed reward address | Declared schedule (registry) |
|---|---|---|---|
| ObsidianStake | `NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV` | `NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV` | `Every 12 hours` |
| Nimiq.Fun | `NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU` | `NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717` | `Every 12 hours` |

Ingestion ran the unmodified P0-06 indexer script against mainnet:

```bash
NIMIQ_RPC_URL=https://rpc.nimiqwatch.com NIMIQ_NETWORK=main \
DATA_DIR=./data \
INDEXER_REWARD_ADDRESSES="NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV,NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717" \
npm run index:payouts --prefix server
```

Observed ingestion results:

| Reward address | Cycle 1 | Cycle 2 |
|---|---|---|
| `NQ15 5JNS…` (ObsidianStake) | fetched 10,000, inserted 10,000, 0 errors | — |
| `NQ16 373T…` (Nimiq.Fun) | fetched 2,000, inserted 0, 1 error | fetched 10,000, inserted 10,000, 0 errors |

The first Nimiq.Fun cycle exhausted the indexer's retry/backoff on the
rate-limited public RPC and persisted **zero rows and no cursor advancement**;
the retry cycle then completed cleanly. This is live confirmation of the P0-06
"cursor never advances on partial data" property (previously covered only by
unit tests).

Both addresses hit the indexer's `maxPages = 20` cap (10,000 transactions per
address). Because the cap counts inbound and outbound traffic together, the
indexed outbound history covers **5.0 days** (ObsidianStake) and **5.7 days**
(Nimiq.Fun) — below the SPEC §8.8 minimum 7-day backfill target. Backfill
depth vs. page caps is an input to P0-09 (see §7).

The local SQLite database (`server/data/steakout.sqlite`) is gitignored and
not committed.

## 2. Implementation

- `server/src/payoutClassifier.ts` v0 — pure, DB-free functions:
  - `groupPayoutRuns(transactions, { windowMinutes })`: gap-based
    sessionization over executed outbound transactions. A transaction joins the
    current run when it occurs within `windowMinutes` of the previous
    transaction (sliding window; default 60). Each run records window
    start/end, tx count, distinct recipients, block range, and tx hashes.
  - `normalizeScheduleHours(raw)`: the METHODOLOGY.md §4.2 minimal forms only
    (`hourly`, `every N hours`, `daily`, `twice daily`); anything else returns
    `null` ("schedule cannot be normalized").
- `server/scripts/classify.ts` — reads only the local DB (no RPC) and prints a
  markdown report: observed runs with tx counts, recipient counts, block
  ranges, first/last tx hashes with explorer links, and an
  expected-vs-observed window comparison when the declared schedule
  normalizes. Reproducible via:

  ```bash
  DATA_DIR=./data npm run classify --prefix server -- \
    --reward-address "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV" \
    --validator-name "ObsidianStake" \
    --validator-address "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV" \
    --declared-schedule "Every 12 hours"
  ```

  Full outputs are stored in the gitignored `docs/spikes/local/` directory.
  Re-running the script reproduces the run tables from the DB alone, with no
  refetch (only the generation timestamp changes).

## 3. Run-window choice: evidence

Gap distribution between consecutive executed outbound transactions
(2026-07-27 → 2026-08-03 indexed span):

| Gap bucket | ObsidianStake (1,596 gaps) | Nimiq.Fun (286 gaps) |
|---|---:|---:|
| < 1 min | 1,586 | 275 |
| 1–10 min | 0 | 1 |
| 10 min – 6 h | 0 | 0 |
| 6–13 h | 10 | 9 |
| > 13 h | 0 | 1 |

The distribution is strongly bimodal for both validators: every observed gap
is either under 10 minutes or over 6 hours. Run counts are therefore
insensitive to the exact window across a wide range:

| Window | ObsidianStake runs | Nimiq.Fun runs |
|---|---:|---:|
| 15 min | 11 | 11 |
| 30 min | 11 | 11 |
| 60 min | 11 | 11 |
| 120 min | 11 | 11 |
| 240 min | 11 | 11 |

**Decision:** keep the METHODOLOGY.md §4.1 default of **60 minutes**, defined
as a gap-based sliding window (a transaction joins the current run when it
occurs ≤ 60 minutes after the previous transaction; a gap > 60 minutes starts
a new run). On this dataset any window between ~10 minutes and ~6 hours
produces identical grouping, so 60 minutes sits far from either failure edge:
it neither splits tightly-bursted runs nor merges distinct 12-hour cycles.

## 4. Observed runs vs declared schedule

### 4.1 ObsidianStake — declared `Every 12 hours`

Indexed span 2026-07-28T16:18:36Z → 2026-08-03T10:14:58Z (cursor at block
57,891,420). 1,597 executed outbound transactions, 148 distinct recipients.

| # | Run start (UTC) | Run end (UTC) | Txs | Recipients | Blocks | First tx hash |
|--:|---|---|---:|---:|---|---|
| 1 | 2026-07-29T00:00:01Z | 2026-07-29T00:00:04Z | 147 | 142 | 57415407–57415410 | `3645e6fc44dc3e329a3fa0d30331c84958e9bd95227235e7afd334fdae1c1d18` |
| 2 | 2026-07-29T12:00:05Z | 2026-07-29T12:00:08Z | 141 | 137 | 57459263–57459266 | `037c5fb4144d8547c3072ff867d18802166172d959ecbb12b753e9fd7746b35a` |
| 3 | 2026-07-30T00:00:06Z | 2026-07-30T00:00:08Z | 147 | 142 | 57503126–57503128 | `0032409bd325df57aad9fd84c6f9047a18f2b47e85cabfa5ca81ee32fdebca11` |
| 4 | 2026-07-30T12:00:06Z | 2026-07-30T12:00:09Z | 141 | 137 | 57546987–57546990 | `044306a3ada1429780183ae460c9f1bc7b2e8a33c75727a80078e02863c9ef71` |
| 5 | 2026-07-31T00:00:06Z | 2026-07-31T00:00:09Z | 147 | 142 | 57590840–57590843 | `339aa524eb495044600b5a2e50ff3082ba77bc02d18f0b5135397413f8aa17c9` |
| 6 | 2026-07-31T12:00:14Z | 2026-07-31T12:00:16Z | 141 | 137 | 57634711–57634713 | `056115a59745f08dd3cb369da2ae907a960787354a30a42f9350e193db57b50e` |
| 7 | 2026-07-31T23:59:01Z | 2026-08-01T00:00:03Z | 156 | 148 | 57678503–57678565 | `046981ea211a108d06371a41bd3ebd5793bc10644f30442444adfd4019de37c9` |
| 8 | 2026-08-01T12:00:05Z | 2026-08-01T12:00:08Z | 141 | 137 | 57722427–57722430 | `029813e7e42425fb154330494eb7d41e45f5e5457b5587162d206cf9c88b1c40` |
| 9 | 2026-08-02T00:00:08Z | 2026-08-02T00:00:11Z | 147 | 142 | 57766249–57766252 | `00bbc18c3e403137e5e5bb13b0b3034aa6af2ac19bdc7a02cc2b23f6141c2830` |
| 10 | 2026-08-02T12:00:12Z | 2026-08-02T12:00:15Z | 141 | 137 | 57810116–57810119 | `02ebf22b5bbf344ea3b4cc4e6ea82b9f70814e23b32f98163f0bedc69940900b` |
| 11 | 2026-08-03T00:00:31Z | 2026-08-03T00:00:36Z | 148 | 142 | 57853993–57853998 | `0c5ae19ad207cb15cf31f0589414e09ef1697575f2483b0b22e658aed6cc45f0` |

Explorer link form (same for every hash): `https://nimiq.watch/#<HASH>` (uppercase hex, no `0x`). Example for run 1 first tx: https://nimiq.watch/#3645E6FC44DC3E329A3FA0D30331C84958E9BD95227235E7AFD334FDAE1C1D18. Full first/last hashes for every run are reproduced by `npm run classify` from the local DB (see `docs/spikes/local/`).

Inter-run start intervals (hours): 12.00, 12.00, 12.00, 12.00, 12.00, 11.98,
12.02, 12.00, 12.00, 12.01.

Expected-vs-observed (grid anchored at first observed run, 12-hour windows):

- Analysis window: 2026-07-29T00:00:01Z → 2026-08-03T10:14:58Z (130.2 h)
- Fully elapsed 12-hour windows: **10**
- Fully elapsed windows containing at least one observed run: **9**
- Runs in the trailing partial window (not yet due): 1
- History depth 5.4 days → **insufficient data** for any observation status
  label (METHODOLOGY.md §3 requires ≥ 7 days; none assigned).

The one window without an observed run is a grid artifact: run 7 started at
23:59:01, **59 seconds before** the nominal 00:00 boundary, placing it in the
previous window. Runs bracket the "empty" window by about one minute on each
side. See §6 — this is the boundary-sensitivity evidence.

### 4.2 Nimiq.Fun — declared `Every 12 hours`

Indexed span 2026-07-27T18:50:04Z → 2026-08-03T10:16:56Z (cursor at block
57,891,540). 287 executed outbound transactions, 26 distinct recipients.

| # | Run start (UTC) | Run end (UTC) | Txs | Recipients | Blocks | First tx hash |
|--:|---|---|---:|---:|---|---|
| 1 | 2026-07-27T23:39:19Z | 2026-07-27T23:44:03Z | 29 | 25 | 57326439–57326727 | `6b13374ef40357a6232d4e06617e1cb0c4a8fe822e8c963f7c16c4925a30c602` |
| 2 | 2026-07-28T11:38:19Z | 2026-07-28T11:43:03Z | 29 | 25 | 57370228–57370516 | `895b0efdae57746ba59c82b7b446550e21918f323728c3405cac8234d74fd7be` |
| 3 | 2026-07-28T23:24:19Z | 2026-07-28T23:29:04Z | 29 | 25 | 57413233–57413521 | `3da4d8dfcc4cd0b0bdbd40cc926dc4f6c6efe70ed359ae2640a4ea26ba7bc650` |
| 4 | 2026-07-29T11:11:59Z | 2026-07-29T11:16:43Z | 29 | 25 | 57456334–57456622 | `2a2c4f1e5c5cf7be68c8e92555b2f7cefae88b56c972ae2cfc7a987afe9ad527` |
| 5 | 2026-07-29T22:58:19Z | 2026-07-29T23:03:03Z | 29 | 25 | 57499363–57499651 | `e5b4570d00f8e0fb53c4dce5b96cc57a576334a0ca1ae1a3539b491905d53b82` |
| 6 | 2026-07-30T10:50:18Z | 2026-07-30T10:54:53Z | 28 | 24 | 57542735–57543014 | `fbc3106b4159757537de392993d140cdf754d5b2db4088d300f318e0ec64368a` |
| 7 | 2026-07-30T22:44:19Z | 2026-07-30T22:48:54Z | 28 | 24 | 57586223–57586501 | `3f82f805938d17fe6e052e056550d3e115793820e67dd524eba5b608a879f8f3` |
| 8 | 2026-07-31T10:30:19Z | 2026-07-31T10:34:53Z | 28 | 24 | 57629234–57629511 | `a7f5130727841678712146cd74426f2aa0cf7abc0738b0aac925489c63bb9f70` |
| 9 | 2026-07-31T22:20:19Z | 2026-07-31T22:24:53Z | 28 | 24 | 57672490–57672768 | `2ab63cb019be72e3abdae2f5ef33ea85a54fa91520337cdbf7d7a09b3c696e21` |
| 10 | 2026-08-01T10:08:19Z | 2026-08-01T10:12:53Z | 28 | 24 | 57715619–57715898 | `a5bbba2487aa07b41beaf905f91bac98249273c805a23cc5839e1bd83c094855` |
| 11 | 2026-08-02T17:18:11Z | 2026-08-02T17:19:28Z | 2 | 1 | 57829487–57829566 | `29d59d485cea447aea0a11029e5b6c4855b803102386ac688d96a6be88cb7663` |

Inter-run start intervals (hours): 11.98, 11.77, 11.79, 11.77, 11.87, 11.90,
11.77, 11.83, 11.80, 31.16.

Expected-vs-observed (grid anchored at first observed run, 12-hour windows):

- Analysis window: 2026-07-27T23:39:19Z → 2026-08-03T10:16:56Z (154.6 h)
- Fully elapsed 12-hour windows: **12**
- Fully elapsed windows containing at least one observed run: **10**
- Runs in the trailing partial window (not yet due): 0
- History depth 6.4 days → **insufficient data** for any observation status
  label (none assigned).

Observed cadence between regular runs is ~11.8 hours, slightly faster than the
declared 12 hours, so run starts drift ~12 minutes earlier each cycle. Between
run 10 (2026-08-01T10:08) and run 11 (2026-08-02T17:18) there is a 31.16-hour
gap in which no run was observed for at least one full 12-hour cycle. Per
METHODOLOGY.md §1, no intent is inferred from the missing transactions; the
window is recorded as `not observed`.

## 5. Anomalies observed

All items below are observed patterns only. None of them is evidence of
intent, and none changes the grouping output.

1. **Staking-contract transactions inside runs.** Both reward addresses send a
   share of outbound transactions to `NQ77 0000 0000 0000 0000 0000 0000 0000
   0001`, verified via `getAccountByAddress` as the protocol staking contract
   (`type: "staking"`, observed 2026-08-03). ObsidianStake: 59 of 1,597
   executed outbound transactions (3.7%), 83,316.47 NIM total. Nimiq.Fun: 50
   of 287 (17.4%), 19,605.27 NIM total. These protocol staking interactions
   currently count as run "recipients". Input for classifier v1: report
   staking-contract transactions separately from other recipients so that
   `Observed recipient coverage` is not inflated.
2. **Large-value transfers co-occurring within a run.** ObsidianStake run 7
   (156 transactions) includes five transfers ≥ 10,000 NIM — 902,372.78,
   217,216.62, 17,981.98, 17,963.11, and 12,223.38 NIM — all at
   2026-07-31T23:59:01Z, inside the same run as ~150 smaller transfers. A run
   is therefore not a homogeneous-purpose set; per-transaction purpose is not
   observable from grouping.
3. **Atypical small run.** Nimiq.Fun run 11 contains 2 transactions (100.00
   NIM, then 29,000.00 NIM ~77 seconds later) to a single address
   (`NQ90 FPSA DMVG 4X4M S65T TXV8 52EF 9SV5 SEBU`), 31.16 hours after the
   previous run start. The classifier reports it as an observed run; scoring
   should note atypical runs neutrally rather than silently excluding them.
4. **Repeated recipients within runs.** 11 of 11 runs for both validators
   contain more transactions than distinct recipients (e.g., one ObsidianStake
   non-contract recipient received 12 payments totaling 46,258.19 NIM across
   the indexed span). Consolidated-payment patterns exist, so
   `Observed recipient coverage` must keep its "not proof of full payout"
   caveat (METHODOLOGY.md §4.3).
5. **First-cycle indexing failure on the rate-limited RPC.** See §1. Observed
   behavior matched the designed failure mode (no partial persistence).

## 6. Recommendation: adherence thresholds

Input to the METHODOLOGY.md §3 defaults. Recommendation only — no doc values
were changed by this spike.

1. **Keep the existing bands** (≥ 95% `on-schedule`, 80–95%
   `mostly-on-schedule`, < 80% `irregular`). The real data shows clean
   separation between regular and gapped operation, so the bands are workable.
2. **Require ≥ 14 days of indexed history before any graded label** — extend
   the current `irregular`-only ≥ 14-day rule to `on-schedule` and
   `mostly-on-schedule` as well. Evidence: at 7 days a 12-hour schedule
   produces only ~14 windows, so a single grid-boundary artifact (§4.1: a
   59-second-early run costs one full window, ~7 percentage points) can move a
   validator across a band boundary. 14 days halves that sensitivity.
3. **Count only fully elapsed windows.** The trailing partial window is
   "not yet due" and must never count as observed or not-observed.
4. **Anchor the window grid at the first observed run** and publish the
   anchor with the metric. Residual boundary sensitivity remains (§4.1), which
   is a further reason for recommendation 2.
5. **Treat runs as grouping primitives, not payout proof.** Atypical runs
   (§5.3) stay visible with a neutral note; scoring must not hard-filter them,
   because exclusion is itself an intent inference.

## 7. Follow-ups for other tasks

- **P0-09 / indexer tuning:** the 10,000-transaction page cap bounded history
  to ~5–6.4 days for these two addresses. Reaching the 14–30-day backfill
  target needs more pages, a block-floor backfill mode, or per-address
  page budgeting. Public-RPC 429s were observed; backoff works but history
  depth currently depends on retry luck.
- **P2-x classifier v1:** separate staking-contract recipients (§5.1), add
  recipient coverage vs. the registry staker set, and surface atypical-run
  notes (§5.3). Bump `calc_version` when grouping semantics change
  (METHODOLOGY.md §9).
- **Explorer verification (owner residual):** transaction
  `3645e6fc44dc3e329a3fa0d30331c84958e9bd95227235e7afd334fdae1c1d18`
  (ObsidianStake run 1 first tx, block 57,415,407) was re-fetched via
  `getTransactionByHash` on 2026-08-03 and matches the indexed row (block,
  timestamp, from/to). A second same-block peer
  `63720ad362716a3d8dda241d26bc9f34da1e3f8bb5caae147160843ed909dc68` also
  matches. Explorer links use the VeriLock `https://nimiq.watch/#<HASH>`
  convention (uppercase hex). nimiq.watch renders client-side, so automated
  fetching cannot confirm the rendered page; **manual owner verification of
  at least one link remains open** (P0-07 acceptance item).
