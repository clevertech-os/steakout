# Payout Indexer Spike

**Task:** P0-06  
**Status:** Deployed to Railway (2026-08-03); 24h continuity evidence pending

## Implementation

- `server/src/db.ts` creates the binding schema from `docs/DATA-MODEL.md`, enables WAL and foreign keys, and refuses destructive schema drift.
- `server/src/payoutIndexer.ts` fetches newest-first address pages, normalizes executed transactions, inserts with `INSERT OR IGNORE`, and persists an address cursor atomically with the page batch.
- A cycle processes at most two addresses concurrently. RPC failures retry up to five times with exponential backoff, a five-minute cap, and jitter.
- The scheduler is enabled with `INDEXER_ENABLED=true` and runs every 30–60 minutes. `server/scripts/index-payouts.ts` runs one configured cycle.
- Reward addresses come from `INDEXER_REWARD_ADDRESSES`, or from non-empty `validators.reward_address` rows.
- `/api/health` retains `{ ok: true }` when no indexer is supplied and includes indexer status in the production bootstrap.

## Verification

Unit tests cover repeated-page deduplication, atomic cursor behavior after a failed page, and cursor recovery across a database reopen. Existing sanitized P0-04 RPC fixtures remain the RPC input surface; no live testnet verification was available for this spike.

## Deployment (2026-08-03)

| Field | Value |
|---|---|
| Project | `steakout` (`519f6554-3e8d-45a2-bad1-c356905e8378`) |
| Service | `steakout` |
| Environment | `production` |
| Public URL | https://steakout-production.up.railway.app |
| Health | `GET /api/health` |
| Volume | `steakout-volume` mounted at `/data` (`DATA_DIR=/data`) |
| Network | main (`NIMIQ_RPC_URL=https://rpc.nimiqwatch.com`) |
| Indexer | `INDEXER_ENABLED=true`, interval 45 min |
| Seed reward addresses | ObsidianStake + Nimiq.Fun (P0-07 set); also picks up `validators.reward_address` after registry sync |
| First deploy | deployment `e5d57219-a67c-4675-9632-fe753f42fb11` → `SUCCESS` ~14:14 UTC |

First health sample (shortly after boot) returned `ok: true`, live `blockNumber`, RPC metrics showing `getTransactionsByAddress` + registry `getValidatorByAddress` activity. Indexer `lastRunAt` starts null until the first full cycle finishes (initial multi-page backfill can take several minutes under public-RPC rate limits).

## Remaining

- **24-hour continuity:** leave the service running; re-check `/api/health` after ≥ 24 h and confirm `indexer.lastRunAt` advances and `addressesIndexed` stays non-zero across at least one container restart (volume must retain SQLite).
- Testnet RPC hostname still fails DNS; mainnet deploy is the production path for history accumulation.
- Rate-limit / 429s on the public RPC are expected; retries + backoff are in place.

## Deep backfill (2026-08-03 ~14:30 UTC)

Priority: accumulate as much payout history as the public RPC will serve.

| Knob | Value |
|---|---|
| Reward set | **All listed validators with a resolved `reward_address`** (21 of 24) + optional env seeds |
| Unlisted / all-observable | Off by default (`INDEXER_LISTED_ONLY=true`); flip to `false` to expand later |
| `INDEXER_MAX_PAGES` | **100** (was 20) → up to 50k txs/address if the RPC still has them |
| Concurrency | **1** address at a time (gentler under 429s) |
| Cursor reset | One-shot `INDEXER_REBACKFILL=true` cleared 7 cursors so history is re-walked newest→oldest |
| Interval | 120 min between full cycles (first cycle can run much longer) |

**Important:** after the first deep pass, cursors point at the *newest* tx. Later cycles only ingest *new* txs. History depth is fixed by the first successful walk + what the RPC still retains.

Live boot log confirmed: `rewardAddresses: 21`, `maxPages: 100`, `cycle-start` with 21 addresses. Public RPC 429s are normal; backoff continues until pages empty or the page budget is exhausted.

3 listed validators still lack a reward address (RPC `getValidatorByAddress` returns “No validator…” for some registry rows) — they cannot be indexed until resolve succeeds.
