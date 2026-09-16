# Accountability Methodology

Binding rules for every metric, label, and claim Steakout produces. Implements [SPEC.md §7](SPEC.md). This document exists to protect users **and** validators from overclaiming. When in doubt, say less.

## 1. Principles

1. Separate **declared policy** (registry) from **observed chain behavior** (indexer) — visually and in the data model.
2. Never infer intent from a missing transaction.
3. Never publish an effective fee number in v1.
4. Display data freshness everywhere a metric appears.
5. Treat insufficient data as a valid result, never as a negative score.
6. Link conclusions to raw transactions wherever possible.
7. Neutral language only: `observed`, `not observed`, `insufficient data`, `needs review`.

## 2. Data status labels (enum)

Every accountability metric carries exactly one:

| Status | Machine value | Meaning |
|---|---|---|
| Verified observation | `verified` | Derived from a confirmed on-chain tx or account state |
| Registry declaration | `registry` | Supplied by the validators registry; not independently verified |
| Inferred | `inferred` | Computed from observable patterns with stated assumptions |
| Insufficient data | `insufficient` | Not enough history, or policy cannot be normalized |
| Unavailable | `unavailable` | RPC/indexer/API did not provide the required data |

## 3. Observation status labels (validator-level)

| Label | Machine value | Rule |
|---|---|---|
| On schedule | `on-schedule` | ≥ 95% of expected payout windows observed in the analysis window |
| Mostly on schedule | `mostly-on-schedule` | 80–95% observed |
| Irregular | `irregular` | < 80% observed, with a normalizable schedule and ≥ 14 days history |
| Not enough observed data | `insufficient-data` | < 7 days of indexed history, or too few windows to judge |
| Observation unavailable | `unavailable` | No reward address, indexer gap, or schedule not normalizable **and** no runs to show |

Thresholds are v1 defaults owned by `observationScoring.ts`; changing them bumps `calc_version` and is noted in the audit trail.

## 4. Direct-payout validators

Observation target: transactions **from** the validator's authoritative on-chain reward address.

### 4.1 Payout runs

Group outbound transactions into runs: txs within a **60-minute sliding window** belong to one run (default; tune with real data in P0-07 and record the choice). A run records: window start/end, tx count, distinct recipients, block range, tx hashes.

### 4.2 Schedule adherence

- Normalize declared schedules only for unambiguous forms: `hourly`, `every N hours` / `hrs` / `hr` / `h`, `daily`, `twice daily`, and hour-level cron `0 * * * *`, `0 */N * * *`, `0 0 * * *` (case-insensitive, trivial punctuation tolerated; calc_version 2).
- Anything else → `normalizable: false`, show the raw declaration and the raw observed runs. **Never grade a free-text schedule.** Minute-level cron and free-text policies stay non-normalizable.
- Adherence = observed windows ÷ expected windows over the analysis window, mapped to §3 labels.

### 4.3 Recipient coverage

Per run: distinct recipient addresses vs. known staker set (when the registry provides one). Display as **"Observed recipient coverage"** with the caveat that consolidation, thresholds, and registry incompleteness mean this is **not** proof of full payout. Copy must never say "paid everyone" / "missed stakers".

### 4.4 Personal continuity (authenticated user)

Last observed payment to the user's address; consecutive observed windows including the address; time since last observed payment; whether the address is in the known staker set. Each field independently nullable.

## 5. Restake validators

Rewards are not necessarily sent as direct payments. v1 model:

- Track the user's staker account state over time (`staker_snapshots`).
- Show **"Observed position growth"** — never "Validator payout verified".
- Show a multi-snapshot window with each interval, source block when available, freshness, and the aggregate delta from usable intervals.
- Steakout scans the authenticated staker address's cursor-paginated chain history and decodes protocol staking-contract payloads. This detects staking actions made through another wallet or app, including third-party additions directed to the staker.
- Intervals containing a known non-failed Steakout intent, an observed on-chain staking action, or a delegation change are marked `confounded` and excluded from the aggregate. If the RPC scan does not cover the interval's full time range, it is conservatively excluded as `chain-history-unavailable`. Excluded intervals remain visible.
- This chain evidence distinguishes observed balance changes from known protocol staking actions; it still does **not** identify the remaining growth as a validator reward or payout.
- Compare usable changes only against an **illustrative expected range**, clearly labeled as illustrative. The current `illustrative-v1` presentation assumption is a broad 2–5% annual network-wide range (“roughly a few percent per year”). It is not live network data, validator-specific, predictive, APY, or guaranteed. The range is unavailable when there is insufficient usable history.
- The illustrative estimate carries the status label **Inferred** and links to this methodology. It is never presented under the `Verified observation` status for indexed balances.
- If P0-04 shows staker state reads are unreliable, ship direct-payout monitoring first and label restake analytics as an explicit limitation ([SPEC.md §7.3](SPEC.md)).

## 6. Excluded in v1 (hard bans)

- Effective validator fee
- Fraud score / scam labels
- Guaranteed APY
- Any ranking implying a validator is objectively "best"
- Any claim that a missing payment proves wrongdoing

Rationale: validator outflows mix principal returns, treasury transfers, and unrelated movements; naive inflow/outflow math produces nonsensical, reputationally harmful results.

## 7. Language dictionary

| Say | Never say |
|---|---|
| observed payout run | payment proof |
| not observed in this window | missed / skipped / withheld |
| insufficient data | unrated / suspicious |
| schedule cannot be normalized | unclear policy (judgmental) |
| declared fee (registry) | actual fee / real fee |
| observed recipient coverage | paid everyone / payout rate |
| observed position growth | restake earnings verified |
| illustrative network estimate | expected return / APY |

## 8. Metric definition requirement

No metric renders without: (a) a one-sentence definition, (b) its status label, (c) a freshness timestamp, (d) a link to evidence or the limitations page. Enforced in review; the `Metric`/`EvidenceRow` components make the four parts structural.

## 9. Calculation versioning

Classifier logic changes bump `calc_version` ([DATA-MODEL.md](DATA-MODEL.md)). The limitations page lists the current version and date. This is the audit trail required by [SPEC.md §15](SPEC.md).
