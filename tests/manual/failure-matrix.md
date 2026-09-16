# Steakout failure-mode matrix

Run: 2026-09-15 automated release-readiness pass (Node 22.23.2)

Automated rows use fixture-backed RPC or injected provider functions; no wallet
keys or live staking writes are used. Rows marked `Pending device` require an
owner-run Nimiq Pay / Hub session and must not be treated as launch passes.

| # | Failure case | Method | Result | Designed state / evidence |
|---:|---|---|---|---|
| 1 | User rejects wallet connection | Device | Pending device | Must remain disconnected with a retry/connect action; P1-16 is not complete. |
| 2 | User rejects native transaction | Device | Pending device | Must leave review/provider flow without a success claim; device verification required. |
| 3 | Provider unavailable | Device | Pending device | Must show provider-unavailable copy and preserve read-only public screens; device verification required. |
| 4 | RPC timeout | Auto | PASS | `tests/unit/server/nimiq-rpc.test.ts`; timeout maps to `RPC_UNAVAILABLE`, retries/backoff, and position UI remains unavailable rather than Active. |
| 5 | RPC malformed data | Auto | PASS | `tests/unit/server/nimiq-rpc.test.ts` and `rpc-fixtures.test.ts`; malformed payload maps to `RPC_MALFORMED` without a raw stack response. |
| 6 | Transaction not found | Auto | PASS | `tests/unit/server/staking-intents.test.ts`; confirm returns `TX_PENDING` (202) with retry metadata and keeps the intent pending. |
| 7 | Transaction failed execution | Auto | PASS | `tests/unit/server/staking-intents.test.ts`; confirm returns `TX_FAILED` and records failed status. |
| 8 | Stale indexer | Auto | PASS | `tests/unit/server/freshness.test.ts`, `observations-api.test.ts`; envelope is marked stale with age/depth metadata and neutral copy. |
| 9 | Free-text validator schedule | Auto | PASS | `tests/unit/server/observation-scoring.test.ts`; schedule is not graded, runs remain visible, and status is insufficient-data/unavailable as appropriate. |
| 10 | Validator with zero payout history | Auto | PASS | `tests/unit/server/observation-scoring.test.ts` and `observations-api.test.ts`; known profile returns a usable insufficient-data/unavailable envelope, not a 404 or invented score. |
| 11 | User has no staker account | Auto | PASS | `tests/unit/server/staking-state.test.ts`, `staking-intents.test.ts`; state normalizes to `NotStaked` and impossible add-stake is rejected with validation copy. |
| 12 | User has retired stake | Auto | PASS | `tests/unit/server/staking-state.test.ts`, `staking-intents.test.ts`; `Retiring`/`Withdrawable` are distinct and remove is blocked until withdrawable. |
| 13 | Account switches mid-session | Device | Pending device | Must not claim the old account’s position or confirm its intent; requires Pay account-switch test on P1-16 hardware. |
| 14 | Duplicate intent submission | Auto | PASS | `tests/unit/server/staking-intents.test.ts`; pending-intent limit rejects duplicates and replay/cross-user confirmation is rejected. |
| 15 | Indexer partial page / restart | Auto | PASS | `tests/unit/server/payout-indexer.test.ts`, `tests/integration/indexer-evidence.test.ts`; failed later page does not advance cursor, and reopening resumes without duplicate rows. |
| 16 | Production spike route access | Auto | PASS | `tests/unit/server/security-hardening.test.ts`, `npm run smoke`; `/api/spike/block-number` returns 404 in production and smoke reports `spike-disabled`. |

## Release interpretation

All automatable rows have deterministic evidence and land on an envelope,
pending, failed, or validation state. Four rows remain explicitly pending
human/device verification (wallet rejection, native transaction rejection,
provider unavailability, and account switching). P3-11 and P4-03 therefore
remain open for owner sign-off even though the automated subset is green.
