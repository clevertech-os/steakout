# Data Model & Indexer

Implements [SPEC.md §8.7–8.8](SPEC.md). SQLite via `better-sqlite3`. Schema is created and migrated in `server/src/db.ts`. Rules: **additive migrations only** (new tables/columns with defaults), `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`. Never store keys, seed phrases, or unnecessary personal data.

## 1. Schema (DDL)

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  address       TEXT NOT NULL UNIQUE,          -- normalized user-friendly format
  public_key    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS validators (
  address                  TEXT PRIMARY KEY,   -- validator address
  name                     TEXT,
  website                  TEXT,
  description              TEXT,
  logo_url                 TEXT,
  fee_declared             TEXT,               -- raw registry string, do not parse into a score
  payout_type_declared     TEXT,               -- 'direct' | 'restake' | 'unknown'
  payout_schedule_declared TEXT,               -- raw registry string
  schedule_every_hours     REAL,               -- normalized when possible, else NULL
  reward_address           TEXT,               -- resolved from chain
  official_score           REAL,               -- NULL when registry reports -1/missing
  dominance_ratio          REAL,
  stake_luna               INTEGER,
  stakers_count            INTEGER,
  is_listed                INTEGER NOT NULL DEFAULT 0,
  registry_updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_validators_listed ON validators(is_listed);

CREATE TABLE IF NOT EXISTS transactions (
  hash              TEXT PRIMARY KEY,
  from_address      TEXT NOT NULL,
  to_address        TEXT NOT NULL,
  value_luna        INTEGER NOT NULL,
  fee_luna          INTEGER NOT NULL DEFAULT 0,
  block_number      INTEGER NOT NULL,
  timestamp         TEXT NOT NULL,
  execution_result  TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'failed' | 'reverted'
  raw_json          TEXT NOT NULL                -- raw RPC payload for re-classification
);
CREATE INDEX IF NOT EXISTS idx_tx_from_block ON transactions(from_address, block_number);
CREATE INDEX IF NOT EXISTS idx_tx_to_block   ON transactions(to_address, block_number);

CREATE TABLE IF NOT EXISTS validator_observations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  validator_address TEXT NOT NULL REFERENCES validators(address),
  observation_type  TEXT NOT NULL,   -- 'payout-run' | 'schedule-adherence' | 'recipient-coverage' | 'history-depth'
  status            TEXT NOT NULL,   -- see status label enum in docs/METHODOLOGY.md
  observed_at       TEXT NOT NULL,
  source_tx_hash    TEXT,            -- nullable; runs span many txs (payload lists them)
  block_number      INTEGER,
  calc_version      INTEGER NOT NULL DEFAULT 1,  -- bump when classifier logic changes (audit trail)
  payload_json      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_validator ON validator_observations(validator_address, observation_type, observed_at);

CREATE TABLE IF NOT EXISTS staker_snapshots (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_address         TEXT NOT NULL,
  validator_address    TEXT,
  active_balance_luna  INTEGER NOT NULL DEFAULT 0,
  inactive_balance_luna INTEGER NOT NULL DEFAULT 0,
  retired_balance_luna INTEGER NOT NULL DEFAULT 0,
  total_balance_luna   INTEGER NOT NULL DEFAULT 0,
  observed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source_block         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_user ON staker_snapshots(user_address, observed_at);

CREATE TABLE IF NOT EXISTS index_cursors (
  source       TEXT NOT NULL,        -- e.g. 'rpc:main' (allows a second source later)
  address      TEXT NOT NULL,        -- reward address being indexed
  last_block   INTEGER NOT NULL DEFAULT 0,
  last_tx_hash TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (source, address)
);

CREATE TABLE IF NOT EXISTS staking_intents (
  id           TEXT PRIMARY KEY,     -- uuid
  user_address TEXT NOT NULL,
  operation    TEXT NOT NULL,        -- 'new-staker' | 'stake' | 'set-active' | 'update-staker' | 'retire' | 'remove'
  params_json  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'failed' | 'expired'
  tx_hash      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id          TEXT PRIMARY KEY,
  address     TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- P3-04: aggregate product counters only (SPEC §16). Never store addresses here.
CREATE TABLE IF NOT EXISTS metrics (
  key         TEXT PRIMARY KEY,
  value       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

Sessions: signed httpOnly cookie (no table needed for v1 volume); if server-side sessions become necessary, add a `sessions` table additively.

### Metrics keys (aggregate)

| key | Incremented on |
|---|---|
| `auth_connects` | Successful `POST /api/auth/verify` |
| `repeat_sessions` | Successful verify when the user row already existed |
| `validator_profile_views` | Successful `GET /api/validators/:address` (200, incl. cache hits) |
| `public_profile_shares` | `GET /validators/:address` share HTML for a valid Nimiq address |

Derived on read (not stored as counters): `COUNT(users)`, `COUNT(staking_intents)`, confirmed intents, max indexer history depth days from earliest indexed tx/observation.

## 2. Indexer strategy

The indexer is the most time-sensitive asset — history only accumulates with wall-clock time. It ships in **P0-06** and must run continuously from Week 0, independent of UI work.

### Targets

- **v1 scope:** the ~24 listed validators' reward addresses; expand to all observable validators once stable (decision gate P0-09).
- **Poll cadence:** every 30–60 min per address.
- **Backfill:** ≥ 7 days minimum, 14–30 days preferred; every profile displays its actual `historyDepthDays`.

### Algorithm (per address, per cycle)

1. Load cursor `(source, address)` → `last_block`.
2. Fetch `getTransactionsByAddress` in bounded pages (newest-first), stop when reaching `last_block` or the backfill floor.
3. For each tx: normalize → `INSERT OR IGNORE` into `transactions` (dedup by hash).
4. Only after a page persists successfully: advance cursor.
5. On RPC error: exponential backoff (base 2s, max 5 min, jitter), give up the cycle after 5 attempts; never advance the cursor on partial data.
6. After ingest: run classifier for that address (new runs, adherence, coverage) → upsert observations with current `calc_version`.

### Concurrency & observability

- In-process queue; max 2 addresses concurrently; per-RPC-call timeout 10s.
- Structured log line per cycle: `{ address, fetched, inserted, ms, errors }`.
- `GET /api/health` exposes `lastRunAt`, `addressesIndexed`, `lagBlocks`.

### Re-classification

`transactions.raw_json` + `calc_version` allow re-running classification after logic changes without re-fetching the chain. Observation queries filter to the latest `calc_version` per type.

## 3. Data retention

- `transactions`, `validator_observations`: append-only, no deletion in v1.
- `auth_challenges`, expired `staking_intents`: daily cleanup job (delete where `expires_at < now - 7 days`).
- `staker_snapshots`: keep all in v1 (volume is bounded by active users × read frequency).

## 4. Fixture policy

Raw RPC responses captured during P0-04 live in `tests/fixtures/rpc/` (sanitized, no user addresses beyond test accounts). Validators API responses in `tests/fixtures/registry/`. Fixtures are the inputs for unit/integration tests ([docs/TESTING.md](TESTING.md)).
