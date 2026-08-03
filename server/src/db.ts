import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function openDatabase(filename = resolve(process.cwd(), 'data/steakout.sqlite')) {
  mkdirSync(dirname(filename), { recursive: true })
  const database = new Database(filename)

  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.exec(`
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
      official_score            REAL,
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
    CREATE INDEX IF NOT EXISTS idx_tx_to_block ON transactions(to_address, block_number);

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
  `)

  return database
}
