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
| `indexer-evidence.test.ts` | P2-15 | Multi-page cursor continuity + process reopen resume; retry after transient failure; duplicate page → zero new rows; observations envelope/run contract after pipeline; empty-history 200; explorer mainnet/testnet redirects |

Unit-level classifier/scoring/cursor edges remain in `tests/unit/server/` (P2-14).
