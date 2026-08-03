# Integration tests

Offline Vitest suites under `tests/integration/`. They exercise multi-module
flows (indexer → SQLite → classify → HTTP) with **mocked RPC only** — no live
network (see [docs/TESTING.md](../../docs/TESTING.md)).

## Run

```bash
npm run test:integration
# or full suite
npm test
```

## Suites

| File | Task | Coverage |
|---|---|---|
| `auth-registry-intent.test.ts` | P1-15 | Auth challenge→verify→session (+ rejection codes); intent→confirm pending/success/failed/mismatch; registry fixture sync→list/detail; P0-04 RPC fixture normalization via mockRpc |
| `indexer-evidence.test.ts` | P2-15 | Multi-page cursor continuity + process reopen resume; retry after transient failure; duplicate page → zero new rows; observations envelope/run contract after pipeline; empty-history 200; explorer mainnet/testnet redirects |

Unit-level classifier/scoring/cursor edges remain in `tests/unit/server/` (P2-14). Auth/intent unit suites remain under `tests/unit/server/`.
