# Validators API Ingestion Probe

**Task:** P0-05  
**Capture:** 2026-08-03T05:24:27.000Z fixture capture; live RPC resolution run after capture  
**Network:** mainnet  
**Status:** Registry fetch and normalization proven; reward-address resolution is rate-limited on the public RPC

## Implementation

`server/src/validators-api.ts` fetches the official endpoint:

```text
https://validators-api-main.je-cf9.workers.dev/api/v1/validators
```

It requests both query modes:

- `only-known=true` as `known-only`
- `only-known=false` as `all-observable`

Each normalized record carries the registry fetch timestamp in
`sourceTimestamp`. Missing strings, numeric fields, and score values become
`null`; an official score of `-1` also becomes `null`. A real numeric zero is
retained. `direct` and `restake` are retained as normalized payout types;
`none`, missing values, and other values become `unknown`. `payoutSchedule` is
kept as the original non-empty registry string. This probe does not interpret
or grade schedules.

Reward addresses are resolved with `getValidatorByAddress` from the RPC
helper. A failed lookup leaves `rewardAddress: null` and is counted in the
resolution summary. The registry's descriptive fields are not treated as
on-chain verification.

## Coverage

| Mode | Records | Listed | Stake with value | Reward addresses resolved |
|---|---:|---:|---:|---:|
| Known-only | 24 | 24 | 554,507,123,616,122 Luna | 19/24 (79.2%) |
| All-observable | 78 | 24 | 919,078,771,348,698 Luna | 16/78 (20.5%) |

The all-observable query exposes 54 additional records. The known-only query
does not include 364,571,647,732,576 Luna observed in the all-observable
response, or 39.7% of the observable stake represented by records with a
non-null balance. The all-observable response therefore must not be silently
replaced by known-only data in a network summary.

The listed reward-address result is below the 90% target. One lookup returned a
JSON-RPC error and four returned HTTP 429 from the public RPC during the live
run. The result is not evidence that those validators lack reward addresses;
the unavailable addresses require a later retry or a less rate-limited RPC
source.

## Field Completeness

Counts below are normalized non-null values from the live run. `payoutType` is
always non-null because unsupported or missing declarations intentionally map
to `unknown`, not because every payout policy is known.

| Field | Known-only | All-observable |
|---|---:|---:|
| `name` | 24/24 (100.0%) | 78/78 (100.0%) |
| `fee` | 23/24 (95.8%) | 24/78 (30.8%) |
| `payoutType` | 24/24 (100.0%) | 78/78 (100.0%) |
| `payoutSchedule` | 15/24 (62.5%) | 16/78 (20.5%) |
| `officialScore` | 18/24 (75.0%) | 39/78 (50.0%) |
| `dominanceRatio` | 23/24 (95.8%) | 65/78 (83.3%) |
| `stakeLuna` | 24/24 (100.0%) | 67/78 (85.9%) |
| `stakersCount` | 23/24 (95.8%) | 63/78 (80.8%) |
| `rewardAddress` | 19/24 (79.2%) | 16/78 (20.5%) |

The official score is the registry's `score.total`, not the RPC validator
state and not a Steakout observation. Missing score totals remain insufficient
data.

## Raw Schedule Inventory

The following exact non-empty declarations were observed. Blank declarations
are shown as `(missing)` after normalization.

| Raw declaration | Known-only | All-observable |
|---|---:|---:|
| `(missing)` | 9 | 62 |
| `0 * * * *` | 1 | 1 |
| `0 */6 * * *` | 1 | 1 |
| `Approx. every ~6hrs` | 0 | 1 |
| `Every 1 minute` | 1 | 1 |
| `Every 12 hours` | 6 | 6 |
| `Every 3 hours` | 2 | 2 |
| `Every 4 hours` | 2 | 2 |
| `Every minute` | 1 | 1 |
| `Payouts over 10 NIM are instant when NimiqPocket is elected .` | 1 | 1 |

Free text and conditional declarations are retained for display and later
schedule-parser work. They are not converted into an expected payout cadence
by this probe, and no financial recommendation is derived from this data.

## Fixtures And Tests

Sanitized live-shaped registry captures are stored in:

- `tests/fixtures/registry/p0-05-validators-known-mainnet.json`
- `tests/fixtures/registry/p0-05-validators-observable-mainnet.json`
- `tests/fixtures/registry/_meta.json`

The large presentation-only `logo` and `accentColor` fields were omitted from
the fixtures. Public validator addresses and registry declarations were
retained. `tests/unit/server/validators-api.test.ts` verifies both fixture
modes, source timestamps, missing-field behavior, payout normalization, score
sentinel handling, schedule preservation, and injected reward-address lookup.
