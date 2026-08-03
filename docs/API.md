# API Contract

Base path: `/api`. All JSON. Implements [SPEC.md §9](SPEC.md). This contract is binding: client and server tasks must both conform to it. Changes require updating this file in the same commit.

## 1. Response rules (every stateful response)

```jsonc
{
  "updatedAt": "2026-08-20T12:34:56.000Z",  // when the underlying data was produced
  "source": "rpc" | "registry" | "indexer" | "cache" | "provider",
  "status": "ok" | "stale" | "partial" | "unavailable",
  "dataFreshness": { "ageSeconds": 42, "historyDepthDays": 14 },  // historyDepthDays where relevant
  "data": { /* endpoint payload */ }
}
```

Error envelope:

```jsonc
{ "error": { "code": "TX_PENDING", "message": "human-readable, neutral", "retryAfterSeconds": 15 } }
```

## 2. Error taxonomy

| Code | HTTP | Meaning |
|---|---|---|
| `WALLET_NOT_CONNECTED` | 401 | No valid session |
| `SIGNATURE_REJECTED` | 401 | Challenge signature failed verification |
| `CHALLENGE_EXPIRED` | 401 | Challenge too old or already used |
| `RATE_LIMITED` | 429 | Includes `retryAfterSeconds` |
| `RPC_UNAVAILABLE` | 503 | Upstream RPC failed after retries |
| `VALIDATOR_NOT_FOUND` | 404 | Unknown validator address |
| `TX_NOT_FOUND` | 404 | Hash not visible on chain (yet) |
| `TX_PENDING` | 202 | Broadcast but unconfirmed |
| `TX_FAILED` | 422 | Execution failed on chain |
| `TX_MISMATCH` | 422 | Confirmed tx does not match the recorded intent |
| `INTENT_NOT_FOUND` | 404 | Unknown/expired staking intent |
| `STATE_NOT_INDEXED` | 202 | Requested data not yet indexed |
| `INSUFFICIENT_HISTORY` | 200 | Valid response; payload explains the gap |
| `VALIDATION` | 400 | Malformed input |

## 3. Public endpoints

### `GET /api/metrics/public`
Aggregate product metrics for the launch story (SPEC §16). No auth. **Counts only — never addresses or other PII.**

```jsonc
{
  "updatedAt": "ISO",
  "disclosure": "Product metrics are aggregate counts only …",
  "metrics": {
    "distinctConnectedWallets": 0,   // COUNT(users)
    "authConnects": 0,               // successful wallet verifies
    "repeatSessions": 0,             // verify when user already known
    "validatorProfileViews": 0,
    "publicProfileShares": 0,        // path-based /validators/:address hits
    "stakingIntents": 0,             // COUNT(staking_intents); residual until intents land
    "stakingConfirmed": 0,           // confirmed intents; residual until confirm path lands
    "indexerHistoryDepthDays": 0     // computed from earliest indexed data → now
  },
  "notes": { /* short residual / methodology strings per computed field */ }
}
```
Short public cache (`max-age=30`). Do not treat as real-time.

### `GET /api/health`
Service + indexer liveness. Always HTTP 200 when the process is up (RPC outage does not fail the probe).

```jsonc
{
  "ok": true,
  "network": "main" | "testnet" | string,
  "blockNumber": 0 | null,           // null when live RPC probe fails / times out
  "mode": "ok" | "degraded",         // degraded when RPC unavailable or on fallback
  "features": {
    "liveChainReads": true,          // false → position/confirm will 503 RPC_UNAVAILABLE
    "registryReads": true            // public validators/observations always SQLite-backed
  },
  "indexer": { "lastRunAt": "ISO|null", "addressesIndexed": 0, "lagBlocks": 0 } | null,
  "rpc": {
    /* call metrics + */ "available", "degraded", "activeSource": "primary"|"fallback"|null,
    "activeHost", "primaryConfigured", "fallbackConfigured", "lastSuccessAt", "liveReads"
  }
}
```
No auth, no cache.

### `GET /api/validators`
Query: `sort=recommended|score|dominance|stake|direct-payout|restake|new` (default `recommended`), `listed=true|false` (default `false` = include all observable).
Each item:

```jsonc
{
  "address": "NQ..",
  "name": "string | null",
  "isListed": true,
  "logoUrl": "string | null",
  "officialScore": 0.0,              // or null -> client shows "Insufficient data" (registry may use -1)
  "stakeLuna": 0,
  "dominanceRatio": 0.0,             // or null
  "stakersCount": 0,                 // or null
  "declared": { "fee": "string | null", "payoutType": "direct" | "restake" | "unknown", "payoutSchedule": "string | null", "scheduleNormalized": { "everyHours": 12 } | null },
  "observation": { "status": "on-schedule" | "mostly-on-schedule" | "irregular" | "insufficient-data" | "unavailable", "lastObservedAt": "ISO | null", "historyDepthDays": 0 }
}
```

### `GET /api/validators/:address`
Full profile: everything from the list item plus `website`, `description`, `rewardAddress` (+ explorer link), score components if provided by registry, and `registryUpdatedAt`.

### `GET /api/validators/:address/observations`
Evidence payload (paginated, `?cursor=`):

```jsonc
{
  "observationStatus": "mostly-on-schedule",
  "schedule": { "declared": "every 12 hours", "normalized": { "everyHours": 12 }, "normalizable": true },
  "window": { "from": "ISO", "to": "ISO", "expectedWindows": 28, "observedWindows": 27 },
  "runs": [
    { "windowStart": "ISO", "txCount": 31, "recipientCount": 148,
      "knownStakersCovered": 121, "knownStakersTotal": 160,   // both nullable
      "txHashes": ["..."], "blockRange": [3812345, 3812401] }
  ],
  "limitations": ["observed-recipient-coverage-is-not-proof-of-full-payout", "..."]
}
```

Every run links to `GET /api/explorer/transaction/:hash` (or the external explorer URL directly).

### `GET /api/network/summary`
Aggregate network view: total stake, validator count (listed vs observable), dominance distribution buckets, % stake with normalizable payout schedules, indexer coverage. Used by the network/decentralization view.

### `GET /api/explorer/transaction/:hash`
302 redirect to the canonical explorer URL for the active network, or JSON `{ url }` with `?format=json`.

## 4. Auth endpoints

### `POST /api/auth/challenge`
Body: `{ address }`. Rate-limited. Returns `{ challengeId, message, expiresAt }` — `message` is the exact string the client passes to `nimiq.sign()`.

### `POST /api/auth/verify`
Body: `{ challengeId, signature, publicKey }`. Server verifies the Nimiq signed-message envelope, binds pubkey→address, creates a short-lived session (httpOnly cookie). Returns `{ address, sessionExpiresAt }`.

### `GET /api/me`
Session check → `{ address, sessionExpiresAt }` or `WALLET_NOT_CONNECTED`.

## 5. Authenticated position endpoints

### `GET /api/me/staking-position`

```jsonc
{
  "state": "NotStaked" | "Pending" | "Active" | "Inactive" | "Retiring" | "Withdrawable",
  "accountBalanceLuna": 0,            // nullable if account read fails
  "staker": {
    "activeLuna": 0, "inactiveLuna": 0, "retiredLuna": 0, "totalLuna": 0,
    "delegation": "NQ.. | null",
    "validatorName": "string | null"  // resolved via registry when listed
  },
  "retire": { "withdrawableAt": "ISO | null" },   // when protocol exposes it; else null
  "lastRewardObservation": { "type": "direct-payout" | "balance-change", "at": "ISO", "txHash": "string | null" } | null
}
```

### `GET /api/me/activity`
Chronological personal timeline: staking intents (when recorded), observed direct payouts to this address from known reward addresses, observed restake balance changes from `staker_snapshots`. Query: optional `limit` (default 50, max 100).

Each item:

```jsonc
{
  "type": "direct-payout" | "observed-position-growth" | "position-change" | "staking-intent",
  "at": "ISO",
  "txHash": "string | null",
  "amountLuna": 0,                 // null when unknown; growth/change are signed deltas
  "validatorAddress": "NQ.. | null",
  "status": "observed" | "verified" | "pending" | "confirmed" | "failed" | "expired",
  "label": "string",               // neutral display label
  "growthLabel": "Observed position growth", // only on observed-position-growth
  "validatorName": "string | null"
}
```

Restake increases use type `observed-position-growth` and the fixed label **Observed position growth** — never "payout". Empty timeline is HTTP 200 with `items: []` (not an error).

### `GET /api/activity/network`
Public recent payout-run summaries across validators (indexer-backed). Query: optional `limit` (default 25, max 100). Envelope per §1; each item uses `type: "payout-run"` with `txCount` / `recipientCount` when present. No auth required — disconnected users can browse the network feed.

### `GET /api/me/observations`
Personal continuity for the authenticated wallet (METHODOLOGY.md §4.4 / §5). Always HTTP 200 when the session is valid — not staked is a clean payload, not an error. Envelope per §1 (`source` is `indexer` when continuity fields come from indexed data, else `rpc`).

```jsonc
{
  "mode": "not-staked" | "direct-payout" | "restake" | "unknown-payout",
  "positionState": "NotStaked" | "Pending" | "Active" | "Inactive" | "Retiring" | "Withdrawable",
  "validatorAddress": "NQ.. | null",
  "validatorName": "string | null",
  // Direct-payout fields — each independently nullable (INSUFFICIENT_HISTORY semantics when unknown).
  // Never use "missed payment" wording; null means not observed / insufficient data.
  "lastPaymentAt": "ISO | null",
  "consecutiveWindowsIncluded": 0,   // trailing streak of runs including this address; null if no runs
  "windowsObserved": 0,              // total runs including this address; null if no runs
  "timeSinceLastPaymentSeconds": 0,  // null when lastPaymentAt is null
  "currentlyInKnownStakerSet": true, // null when known-staker set is unavailable (never invent false)
  // Restake only: snapshot pointer. Null for direct-payout / not-staked. Never a payout claim.
  "observedPositionGrowth": {
    "label": "Observed position growth",
    "latest": { "at": "ISO", "totalLuna": 0 } | null,
    "previous": { "at": "ISO", "totalLuna": 0 } | null,
    "deltaLuna": 0                       // null unless both snapshots present
  } | null
}
```

## 6. Staking action endpoints

### `POST /api/staking/intent`
Body: `{ operation, params }` where

```ts
operation = "new-staker" | "stake" | "set-active" | "update-staker" | "retire" | "remove"
params    = { valueLuna?, delegation?, newActiveBalanceLuna?, newDelegation?, reactivateAllStake?, retireStakeLuna? }
```

Server validates (amounts > 0, address formats, state preconditions from chain reads), records the intent with expiry, returns `{ intentId, expiresAt, summary }`. `summary` is exactly what the client renders on the review screen.

### `POST /api/staking/confirm`
Body: `{ intentId, txHash }`. Server fetches the tx by hash and matches it against the authenticated address + recorded intent (operation, amount, delegation where visible). Responses:

- `202 TX_PENDING` — keep polling (client polls with backoff, max ~2 min then "check later" state)
- `200` — `{ status: "confirmed", blockNumber, position: <same shape as /api/me/staking-position> }`
- `422 TX_FAILED` / `422 TX_MISMATCH` — with neutral explanation

The server **never** marks anything confirmed from the client's word alone (invariant #2).

## 7. Client/server contract notes

- All amounts cross the wire in **Luna** (integer, JSON number is safe: supply < 2^53). Client formats NIM for display (1 NIM = 100 000 Luna).
- Addresses are user-friendly format (`NQ..`) on the wire; server normalizes on receipt.
- Timestamps are ISO 8601 UTC.
- List endpoints that can grow use `?cursor=` pagination, `nextCursor` in the payload.
- CORS: same-origin in production (single service); dev uses Vite proxy — no permissive CORS in prod.
