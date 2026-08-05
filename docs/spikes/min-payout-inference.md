# Min-payout inference spike (on-chain floors)

**Date:** 2026-08-05  
**Network:** mainnet (local index `server/data/steakout.sqlite`)  
**Status:** Spike complete — method proven on real data; **product not shipped**  
**Related:** [METHODOLOGY.md](../METHODOLOGY.md) §2 (Inferred), §4 (direct payout), [min-payout research](../research/README.md), registry declaration UI (researched mins)

## 1. Question

Can Steakout estimate a validator’s **minimum payout threshold** by watching reward-address outflows on chain, instead of (or in addition to) operator FAQs?

## 2. Answer (short)

**Yes, as an upper-bound / observed floor — labeled Inferred, not Registry declaration.**

| What we can claim | Label | Notes |
|---|---|---|
| “Smallest observed direct payment was X NIM” | **Inferred** / Verified observation of amount | Requires enough outbound history |
| “Any fixed min-payout policy is **at most** X” | **Inferred** (conditional) | Only if those outflows are reward payouts |
| “Their declared min is X” | **Registry declaration** only | Still needs FAQ/research sheet |
| “Missing payment ⇒ wrongdoing” | **Banned** | METHODOLOGY §1, §6 |

Chain data does **not** prove the operator’s written policy. It proves **amounts that actually left the reward address**.

## 3. Method

### 3.1 Inputs

- `validators.reward_address` (resolved registry/RPC)
- Indexed `transactions` where:
  - `from_address` = reward address
  - `execution_result = ok`
  - `value_luna > 0`
  - exclude `to_address` ∈ {reward, validator} (self-loops)

### 3.2 Statistics (per validator)

| Stat | Role |
|---|---|
| `min` | Strict observed floor (sensitive to dust / final settlements) |
| `p5` / `p10` | Robust lower tail (less one-off noise) |
| recipient count | Many recipients → more “pool payout-like” |
| multi-recipient runs (≥3 recipients, 60‑min window) | Same floor restricted to payout-run style batches |
| history depth (days) | Insufficient-data gate |
| fraction of payments &lt; 1 NIM / &lt; 10 NIM | Calibration vs common declared thresholds |

### 3.3 Reproduce

Read-only local script (no RPC):

```bash
DATA_DIR=./server/data npm run min-payout-inference --prefix server
DATA_DIR=./server/data npm run min-payout-inference --prefix server -- --json
```

Optional: `MIN_PAYOUT_RESEARCH_PATH` to compare against `docs/research/min-payout-amounts.json`.

## 4. Coverage on this machine (2026-08-05)

| Metric | Value |
|---|---:|
| Validators with `reward_address` | 59 |
| Reward addresses with **any** indexed outbound txs | **2** |
| Outbound txs analyzed (after filters) | ~1 884 |
| Canary probe **inbound** payments indexed | **0** (expected early) |
| History depth (indexed) | ~5.0–5.7 days (under 7‑day backfill target) |

Almost all listed canary validators have **zero** reward outflows in this DB. Prior P0-07 indexing only fully backfilled **ObsidianStake** and **Nimiq.Fun**. Broader inference needs broader `index:payouts` coverage.

Also present: ~18k txs from unmapped `NQ81 C01N BASE…` (2 recipients only) — **not** treated as a staking-pool reward address.

## 5. Results (indexed direct pools)

| Validator | Declared type | n | recipients | min NIM | p5 | p10 | multi-run min | share &lt;1 NIM | share &lt;10 NIM | depth (d) | Research sheet |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **ObsidianStake** | direct | 1597 | 148 | **0.0073** | 0.096 | 0.245 | 0.0073 | 14.3% | 33.1% | ~5.0 | `unknown` |
| **Nimiq.Fun** | direct | 287 | 26 | **0.0037** | 0.379 | 0.912 | 0.0037 | 10.5% | 30.3% | ~5.7 | `none` |

All multi-recipient runs (≥3 recipients) for Obsidian: **11** runs, 0 single-recipient runs. Nimiq.Fun: **10** multi-recipient runs, 1 single-recipient run. Floors on multi-run subsets match all-outbound floors — dust is inside pool-style batches, not only odd one-offs.

### 5.1 Calibration vs research

| Validator | Research | Chain floor | Fit |
|---|---|---|---|
| Nimiq.Fun | **none** (explicit “no minimum threshold”) | min ≈ 0.004 NIM; ~10% of payments &lt; 1 NIM | **Consistent** — sub-1 NIM payments observed |
| ObsidianStake | unknown (FAQ only min **stake** 100 NIM) | min ≈ 0.007 NIM; ~14% &lt; 1 NIM | **Inferred near-none floor** — not a 1/10 NIM fixed policy in this window |
| Keyring / Siam / Pocket / Marketing (fixed 1 or 10) | researched fixed | **no outflows indexed** | **Insufficient data** — cannot calibrate yet |
| Restake majority of canary set | various | no direct reward outflows expected as primary path | Direct-payment floor is **not applicable** without a restake-specific model |

### 5.2 Example small multi-run payments (explorer-linkable)

| Validator | Amount (NIM) | Tx hash (prefix) |
|---|---:|---|
| ObsidianStake | 0.0073 | `33cb353c0b5a462c…` |
| Nimiq.Fun | 0.0037 | `a5bbba2487aa07b4…` |

These support “payments below 1 NIM **were observed**,” not “operator promised zero min.”

## 6. Failure modes (keep in product copy)

1. **Dust / residual settlements** — true min may be slightly higher than absolute min; prefer **p5** for UI if min is extreme.
2. **Incomplete index** — missing small payments → floor looks **higher** than reality (false “strict” threshold).
3. **Non-payout outflows** — treasury, refunds, consolidations. Mitigate with multi-recipient runs + recipient diversity.
4. **Restake validators** — rewards may never leave reward address as staker payments; floor metric stays **insufficient / N/A**.
5. **Canary silence** — no payment ≠ high min (unelected, restake, lag, threshold). Neutral language only.
6. **Short history** — &lt;7 days → label **Insufficient data** even if min is computable.

## 7. Product recommendation

### Go (v1-shaped)

Ship **alongside** researched registry min, never replacing it:

| Field | Status tag | Source |
|---|---|---|
| Min payout (declared) | Registry declaration | `docs/research` → `server/config/min-payout-declarations.json` (already wired) |
| Smallest observed payment | **Inferred** (or Verified observation of amount) | Indexer stats when gates pass |

**Gates for showing a number:**

- payout type `direct` (or observed multi-recipient payout runs exist), and  
- `txCount ≥ N` (suggest start: **50**), and  
- `recipients ≥ 5`, and  
- `historyDepthDays ≥ 7` (align SPEC indexer target), else **Insufficient data**.

**Display copy (example):**

> Smallest observed payment: **0.007 NIM**  
> *Inferred from reward-address outflows. Upper bound on a fixed min threshold only if these are reward payouts. Not an operator declaration.*

Optional secondary: p5, sample size, freshness.

### No-go

- Do **not** overwrite `declared.minPayout` with chain min.
- Do **not** rank validators by “lowest min.”
- Do **not** score adherence worse because payments are small.

### Follow-ups before shipping the Inferred metric

1. **Index more reward addresses** (especially researched fixed 1/10 NIM pools: Siam, Keyring, Pocket, Marketing) for calibration.
2. Persist a small summary table or compute on read from `transactions` (with cache).
3. Unit tests: percentile helper, self-transfer exclusion, insufficient-data gates.
4. Canary path: once probe receipts appear, report **observed canary payment min** separately (controlled stake).

## 8. Decision

| Decision | Choice |
|---|---|
| Is on-chain estimation viable? | **Yes** for validators with real index depth |
| Ready to ship UI now for all 24 canaries? | **Not yet** — need productized API field + gates; data on Railway is enough to start for many pools |
| Method ready to productize later? | **Yes** — script + gates + dual labeling above |
| Next engineering step | Productize **Inferred** “smallest observed payment” / robust p5 from production index; keep researched declaration separate |

## 9. Railway production cross-check (2026-08-05)

Local spike used a thin laptop DB. **Production** (`steakout` service, volume `/data/steakout.sqlite`, ~1.9 GB) has much more history.

### 9.1 Coverage (Railway)

| Metric | Local laptop | Railway production |
|---|---:|---:|
| `transactions` rows | ~20k | **~1.43M** |
| Reward addresses with outbound | **2** | **18** |
| Outbound payments analyzed (non-self) | ~1.9k | **~643k** |
| `index_cursors` | 2 | **20** |
| `validator_observations` | 0 | **6.4k** (payout-run + coverage + adherence) |
| Typical history depth | ~5 days | **~30–42 days** for active pools |

Raw export: [`local/min-payout-railway-2026-08-05.json`](local/min-payout-railway-2026-08-05.json).

How to re-run (read-only SSH against live volume):

```bash
railway ssh --service steakout -- bash -lc 'python3 -' < path/to/analysis.py
# or after deploy: DATA_DIR=/data npm run min-payout-inference --prefix server
```

### 9.2 Calibration: researched declaration vs observed floor

| Validator | Research (sheet) | n | min NIM | p5 NIM | Share ≥1 / ≥10 | Cross-check |
|---|---|---:|---:|---:|---|---|
| **Keyring Staking** | fixed **10** | 4 087 | 10.00 | 11.04 | 100% / 100% | **Match** — hard floor at 10 |
| **NimiqPocket** | fixed **10** | 192 059 | 3.98 | **10.03** | 100% / ~100% | **Match** — p5≈10; rare dust below |
| **Siam Pool** | fixed **1** | 110 188 | 0.84 | **1.07** | ~100% / 55% | **Match** — p5≈1 |
| **Nimiq Marketing Pool** | fixed **1** | 17 544 | 1.00 | **1.09** | 100% / 32% | **Match** — min≈1 |
| **Nimiq.Fun** | **none** | 1 683 | 0.004 | 0.38 | 90% / 72% | **Match** — sub-1 common (~10%) |
| **AceStaking** | stake-based | 14 519 | 0.17 | 28.6 | 99% / 98% | **Consistent** — wide tail, no single fixed floor |
| **Nova Pool** | fixed 10 (Wayback) | — | — | — | — | **No outflows indexed** (pool closed / no reward activity) |

### 9.3 Inferences for previously unknown research rows

Chain floors (Inferred candidates — **not** auto-promoted to Registry declaration without operator source):

| Validator | Observed min / p5 | Suggested inference |
|---|---|---|
| **NimiqCafe Staking** | min=**10.00**, p5=10.30, 0% below 10 | Strong **~10 NIM** fixed floor |
| **Moon Pool** | min=0.47, p5=**1.06**, ~0% below 1 | Strong **~1 NIM** fixed floor |
| **Mint Pool** | min≈0, p5≈0.05, many sub-1 | **Low / none** (or dust-heavy restake path) |
| **$NIM_pool** | min≈0, p5≈0.01 | **Low / none** |
| **nim.re** | min≈0.01, p5≈0.02 | **Low / none** |
| **Garuda Pool** | min≈0.005, p5≈0.03 | **Low / none** |
| **Ritvars Staking** | min≈0, p5≈0.05 | **Low / none** |
| **ObsidianStake** | min≈0.007, p5≈0.12 (same as local, deeper history) | **Low / none** effective floor |
| **NimiqHub Staking** | min=**95**, p5≈96, 2 recipients | **High floor (~95 NIM)** or non-typical payout shape — treat carefully (few recipients) |
| **CHIPMUNK POOL** | min≈6.9, p5≈98, 2 recipients | Thin recipient set — **insufficient** for policy claim |
| **Synapse LN** | n=4 | **Insufficient data** |
| **Nimiq Surf** | n=81, 1 recipient, research n/a | Not a multi-staker payout series |

### 9.4 Takeaways from production

1. **Method validates** against known declarations (1 NIM and 10 NIM pools line up on **p5**, not always absolute min).
2. Prefer **p5 (or multi-recipient-run min)** over raw min for UI — Pocket’s absolute min (3.98) is rare dust under a clear 10 NIM regime.
3. Local-only spike was **coverage-limited**, not method-limited. Railway already has enough depth for many listed pools.
4. Restake pools still emit reward-address outflows that look like payments; floors remain meaningful as **observed transfer floors**, with restake caveats in copy.
5. Do **not** silently write inferred floors into `minPayoutKind: fixed` research rows without a source URL — keep dual status: Registry vs Inferred.

## 10. Neutral language checklist

Used throughout this spike: `observed`, `not observed`, `insufficient data`, `inferred`.  
Not used: paid everyone, missed stakers, fraud, effective fee, “best” pool.
