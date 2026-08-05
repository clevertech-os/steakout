# Spike Reports

This directory holds evidence from the Phase 0 de-risk spikes. P0-01 establishes
the application shell and engineering baseline only; later tasks add reports
for wallet, RPC, registry, indexing, and payout-classification probes.

## Later spikes

- [min-payout-inference.md](min-payout-inference.md) — observed payment floors from reward outflows (Inferred; not registry policy). Re-run: `DATA_DIR=./server/data npm run min-payout-inference --prefix server`.

## P0-01 Scaffold Notes

- Client: Vite + React 19 + TypeScript on port 5173.
- Server: Express + TypeScript via `tsx` on port 3000.
- Health endpoint: `GET /api/health` returns `{ "ok": true }`.
- SQLite: `better-sqlite3` enables WAL mode and foreign-key enforcement on open.
- The shell imports `nimiq-css` natively and references local Mulish/Fira Mono
  asset paths, with system-font fallbacks when the binary assets are unavailable.
