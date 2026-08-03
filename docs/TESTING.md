# Testing Strategy

Implements [SPEC.md §14](SPEC.md). Owned by **Team Testing**; executed by everyone (Implementation runs unit tests for code they write; Testing owns the suites, fixtures, and sweeps).

## 1. Stack

- **Vitest** for unit + integration tests (client and server), run via `npm test`.
- Fixtures: sanitized RPC + registry + transaction payloads under `tests/fixtures/`.
- RPC access in tests is **always mocked from fixtures** — no live network in CI/test runs.
- Manual device matrix for wallet flows (cannot be automated in v1).
- `npm run smoke`: boots the production build and asserts `/api/health`, SPA serving, and a public validator profile response.

## 2. Coverage map

### Unit tests

| Area | Module under test | Task |
|---|---|---|
| Address normalization/validation | `client/src/addresses.ts`, server equivalent | P1-14 |
| Luna ↔ NIM conversion/formatting | shared format helpers | P1-14 |
| Position state normalization | `server/src/stakingState.ts` | P1-14 |
| Transaction intent matching | `server/src/stakingIntents.ts` | P1-14 |
| Schedule parser/normalizer | `server/src/payoutClassifier.ts` | P2-14 |
| Payout-run grouping (window edges, gaps, single-tx runs) | `payoutClassifier.ts` | P2-14 |
| Recipient coverage calculation | `payoutClassifier.ts` | P2-14 |
| Observation status calculation (label thresholds, insufficient-data paths) | `observationScoring.ts` | P2-14 |
| Index cursor advancement (no advance on partial page) | `payoutIndexer.ts` | P2-14 |

### Integration tests

| Flow | Notes | Task |
|---|---|---|
| Validators API fixture ingestion → normalized rows | both known-only and all-observable payloads | P1-15 |
| RPC response normalization (account, staker, validator, tx pages) | from P0-04 fixtures | P1-15 |
| Auth challenge → sign → verify → session | signature fixtures from P0-02 | P1-15 |
| Intent → confirm polling (pending → confirmed, failed, mismatch) | mocked RPC tx states | P1-15 |
| Indexer pagination, retry, restart recovery | cursor continuity across process restart | P2-15 |
| Duplicate transaction handling | same page fetched twice | P2-15 |
| Public profile + observations response shape | contract test vs [API.md](API.md) | P2-15 |
| Evidence links resolve to correct explorer URLs | both networks | P2-15 |

### Manual device matrix (human-assisted)

| Environment | Focus | Task |
|---|---|---|
| Nimiq Pay Android (testnet) | Full staking lifecycle, cancel paths, reload recovery | P1-16, P3-11 |
| Nimiq Pay iOS (if available) | Same | P1-16 |
| Mobile browser | Read-only + Hub handoff | P1-16 |
| Desktop browser + Nimiq Hub | Fallback connect/sign | P1-16 |
| Mainnet (read-only) | Registry/indexer/profile correctness | P3-11 |

### Failure tests (all must be exercised before launch)

User rejects wallet connection · user rejects native transaction · provider unavailable · RPC timeout · RPC malformed data · transaction not found · transaction failed execution · indexer stale · validator schedule is free text · validator with zero payout history · user with no staker account · user with retired stake · user switches wallet account mid-session · duplicate intent submission. (Tracked in P3-11.)

## 3. Fixture policy

- P0-04 captures raw RPC responses → `tests/fixtures/rpc/*.json`.
- P0-05 captures registry payloads → `tests/fixtures/registry/*.json`.
- P0-02/P0-03 capture signature + staking-method results → `tests/fixtures/wallet/*.json` + `docs/spikes/staking-methods.md`.
- Sanitize: replace real user addresses with deterministic test addresses; keep validator addresses (public data).
- Every fixture has a `_meta.json` noting source endpoint, network, and capture date.

## 4. Acceptance gates (per phase)

| Gate | Required to pass |
|---|---|
| Phase 1 exit | All P1 unit/integration suites green; vertical-slice manual pass on ≥ 1 device |
| Phase 2 exit | Classifier suites green incl. edge cases; indexer restart recovery proven |
| Phase 3 exit | Full failure matrix exercised; security review (P3-10) signed off; 320/375/430 sweep done |
| Phase 4 exit | P4-01 freeze checklist + P4-03 final QA sweep green on production build |

## 5. Bug workflow

1. Found by anyone → file as a **Notes** entry on the relevant task card (or the board's parking lot) with repro + expected vs actual.
2. Severity: `blocker` (core journey broken) > `major` (wrong data shown) > `minor` (polish).
3. Blockers stop the board — they preempt all other work until fixed.
4. Every fix ships with a regression test when the bug is in logic (not required for pure styling).
