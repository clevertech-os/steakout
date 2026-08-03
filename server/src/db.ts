import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    address       TEXT NOT NULL UNIQUE,
    public_key    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS validators (
    address                  TEXT PRIMARY KEY,
    name                     TEXT,
    website                  TEXT,
    description              TEXT,
    logo_url                 TEXT,
    fee_declared             TEXT,
    payout_type_declared     TEXT,
    payout_schedule_declared TEXT,
    schedule_every_hours     REAL,
    reward_address           TEXT,
    official_score           REAL,
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
    execution_result  TEXT NOT NULL DEFAULT 'ok',
    raw_json          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_from_block ON transactions(from_address, block_number);
  CREATE INDEX IF NOT EXISTS idx_tx_to_block   ON transactions(to_address, block_number);

  CREATE TABLE IF NOT EXISTS validator_observations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    validator_address TEXT NOT NULL REFERENCES validators(address),
    observation_type  TEXT NOT NULL,
    status            TEXT NOT NULL,
    observed_at       TEXT NOT NULL,
    source_tx_hash    TEXT,
    block_number      INTEGER,
    calc_version      INTEGER NOT NULL DEFAULT 1,
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
    source       TEXT NOT NULL,
    address      TEXT NOT NULL,
    last_block   INTEGER NOT NULL DEFAULT 0,
    last_tx_hash TEXT,
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (source, address)
  );

  CREATE TABLE IF NOT EXISTS staking_intents (
    id           TEXT PRIMARY KEY,
    user_address TEXT NOT NULL,
    operation    TEXT NOT NULL,
    params_json  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
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

  -- Desktop browser session handoff: phone (Pay) approves, desktop claims cookie.
  CREATE TABLE IF NOT EXISTS desktop_pairings (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'waiting',
    address     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at  TEXT NOT NULL,
    approved_at TEXT,
    claimed_at  TEXT
  );

  -- P3-04: aggregate product counters only (no addresses / PII).
  CREATE TABLE IF NOT EXISTS metrics (
    key         TEXT PRIMARY KEY,
    value       INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`

const requiredColumns: Record<string, readonly string[]> = {
  users: ['id', 'address', 'public_key', 'created_at', 'last_seen_at'],
  validators: [
    'address', 'name', 'website', 'description', 'logo_url', 'fee_declared',
    'payout_type_declared', 'payout_schedule_declared', 'schedule_every_hours',
    'reward_address', 'official_score', 'dominance_ratio', 'stake_luna',
    'stakers_count', 'is_listed', 'registry_updated_at',
  ],
  transactions: [
    'hash', 'from_address', 'to_address', 'value_luna', 'fee_luna', 'block_number',
    'timestamp', 'execution_result', 'raw_json',
  ],
  validator_observations: [
    'id', 'validator_address', 'observation_type', 'status', 'observed_at',
    'source_tx_hash', 'block_number', 'calc_version', 'payload_json',
  ],
  staker_snapshots: [
    'id', 'user_address', 'validator_address', 'active_balance_luna',
    'inactive_balance_luna', 'retired_balance_luna', 'total_balance_luna',
    'observed_at', 'source_block',
  ],
  index_cursors: ['source', 'address', 'last_block', 'last_tx_hash', 'updated_at'],
  staking_intents: [
    'id', 'user_address', 'operation', 'params_json', 'status', 'tx_hash',
    'created_at', 'expires_at', 'confirmed_at',
  ],
  auth_challenges: ['id', 'address', 'message', 'created_at', 'expires_at', 'used_at'],
  desktop_pairings: [
    'id', 'status', 'address', 'created_at', 'expires_at', 'approved_at', 'claimed_at',
  ],
  metrics: ['key', 'value', 'updated_at'],
}

const additiveColumnDefinitions: Record<string, Record<string, string>> = {
  users: {
    public_key: "TEXT NOT NULL DEFAULT ''",
    created_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    last_seen_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
  },
  validators: {
    name: 'TEXT', website: 'TEXT', description: 'TEXT', logo_url: 'TEXT', fee_declared: 'TEXT',
    payout_type_declared: 'TEXT', payout_schedule_declared: 'TEXT', schedule_every_hours: 'REAL',
    reward_address: 'TEXT', official_score: 'REAL', dominance_ratio: 'REAL', stake_luna: 'INTEGER',
    stakers_count: 'INTEGER', is_listed: 'INTEGER NOT NULL DEFAULT 0', registry_updated_at: 'TEXT',
  },
  transactions: {
    value_luna: 'INTEGER NOT NULL DEFAULT 0', fee_luna: 'INTEGER NOT NULL DEFAULT 0',
    block_number: 'INTEGER NOT NULL DEFAULT 0', timestamp: "TEXT NOT NULL DEFAULT ''",
    execution_result: "TEXT NOT NULL DEFAULT 'ok'", raw_json: "TEXT NOT NULL DEFAULT '{}'",
  },
  validator_observations: {
    observation_type: "TEXT NOT NULL DEFAULT 'history-depth'", status: "TEXT NOT NULL DEFAULT 'unavailable'",
    observed_at: "TEXT NOT NULL DEFAULT ''", source_tx_hash: 'TEXT', block_number: 'INTEGER',
    calc_version: 'INTEGER NOT NULL DEFAULT 1', payload_json: "TEXT NOT NULL DEFAULT '{}'",
  },
  staker_snapshots: {
    user_address: "TEXT NOT NULL DEFAULT ''", validator_address: 'TEXT',
    active_balance_luna: 'INTEGER NOT NULL DEFAULT 0', inactive_balance_luna: 'INTEGER NOT NULL DEFAULT 0',
    retired_balance_luna: 'INTEGER NOT NULL DEFAULT 0', total_balance_luna: 'INTEGER NOT NULL DEFAULT 0',
    observed_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    source_block: 'INTEGER NOT NULL DEFAULT 0',
  },
  index_cursors: {
    last_block: 'INTEGER NOT NULL DEFAULT 0', last_tx_hash: 'TEXT',
    updated_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
  },
  staking_intents: {
    user_address: "TEXT NOT NULL DEFAULT ''", operation: "TEXT NOT NULL DEFAULT ''",
    params_json: "TEXT NOT NULL DEFAULT '{}'", status: "TEXT NOT NULL DEFAULT 'pending'",
    tx_hash: 'TEXT', created_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    expires_at: "TEXT NOT NULL DEFAULT ''", confirmed_at: 'TEXT',
  },
  auth_challenges: {
    address: "TEXT NOT NULL DEFAULT ''", message: "TEXT NOT NULL DEFAULT ''",
    created_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    expires_at: "TEXT NOT NULL DEFAULT ''", used_at: 'TEXT',
  },
  desktop_pairings: {
    status: "TEXT NOT NULL DEFAULT 'waiting'",
    address: 'TEXT',
    created_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    expires_at: "TEXT NOT NULL DEFAULT ''",
    approved_at: 'TEXT',
    claimed_at: 'TEXT',
  },
  metrics: {
    value: 'INTEGER NOT NULL DEFAULT 0',
    updated_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
  },
}

function migrateAdditive(database: Database.Database): void {
  // Existing columns are never changed or removed. Missing non-key columns are added only.
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const existing = new Set(
      (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((column) => column.name),
    )
    for (const column of columns) {
      if (existing.has(column)) continue
      const definition = additiveColumnDefinitions[table]?.[column]
      if (!definition) {
        throw new Error(`Database schema for ${table} is missing non-additive column ${column}`)
      }
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}

export function openDatabase(filename = resolve(process.cwd(), 'data/steakout.sqlite')): Database.Database {
  mkdirSync(dirname(filename), { recursive: true })
  const database = new Database(filename)

  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  migrateAdditive(database)

  return database
}
