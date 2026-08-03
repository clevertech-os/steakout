# Payout Indexer Spike

**Task:** P0-06  
**Status:** Local implementation and fixture tests complete; deployment and testnet verification blocked

## Implementation

- `server/src/db.ts` creates the binding schema from `docs/DATA-MODEL.md`, enables WAL and foreign keys, and refuses destructive schema drift.
- `server/src/payoutIndexer.ts` fetches newest-first address pages, normalizes executed transactions, inserts with `INSERT OR IGNORE`, and persists an address cursor atomically with the page batch.
- A cycle processes at most two addresses concurrently. RPC failures retry up to five times with exponential backoff, a five-minute cap, and jitter.
- The scheduler is enabled with `INDEXER_ENABLED=true` and runs every 30–60 minutes. `server/scripts/index-payouts.ts` runs one configured cycle.
- Reward addresses come from `INDEXER_REWARD_ADDRESSES`, or from non-empty `validators.reward_address` rows.
- `/api/health` retains `{ ok: true }` when no indexer is supplied and includes indexer status in the production bootstrap.

## Verification

Unit tests cover repeated-page deduplication, atomic cursor behavior after a failed page, and cursor recovery across a database reopen. Existing sanitized P0-04 RPC fixtures remain the RPC input surface; no live testnet verification was available for this spike.

## Blockers

- No persistent Railway or equivalent deployment was performed in this workspace, so there is no 24-hour continuity evidence.
- The configured testnet RPC hostname has previously failed DNS resolution, and no testnet reward-address set was available for a live run.
- Mainnet fixture captures are sanitized read-layer evidence only; they do not constitute testnet or deployment verification.
