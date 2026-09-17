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
    "stakingIntents": 0,             // COUNT(staking_intents); rows from POST /api/staking/intent
    "stakingConfirmed": 0,           // confirmed intents from chain-matched POST /api/staking/confirm
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
  "logoUrl": "string | null",        // same-origin `/api/validators/:address/favicon` when a custom registry logo or website exists
  "website": "string | null",        // operator website from registry; directory shows external-link icon when set
  "officialScore": 0.0,              // or null -> client shows "Insufficient data" (registry may use -1)
  "stakeLuna": 0,
  "dominanceRatio": 0.0,             // or null
  "stakersCount": 0,                 // or null
  "declared": {
    "fee": "string | null",
    "payoutType": "direct" | "restake" | "unknown",
    "payoutSchedule": "string | null",
    "scheduleNormalized": { "everyHours": 12 } | null,
    // Steakout-researched (not official validators-api). Caption as Registry declaration.
    "minPayout": {
      "nim": 10,                                    // number | null — set when kind is "fixed"
      "kind": "fixed" | "none" | "stake-based" | "not_applicable" | "unknown",
      "confidence": "high" | "medium" | "low" | null
    }
  },
  "observation": { "status": "on-schedule" | "mostly-on-schedule" | "irregular" | "insufficient-data" | "unavailable", "lastObservedAt": "ISO | null", "historyDepthDays": 0 },
  // Inferred from indexed reward-address outflows. Prefer p5Nim for display (dust-robust).
  // Never replaces declared.minPayout. status: inferred | insufficient | unavailable.
  // Precomputed weekly into payment_floors (not scanned on request). computedAt = last job.
  "observedPaymentFloor": {
    "minNim": 3.98,
    "p5Nim": 10.03,
    "sampleSize": 192059,
    "recipientCount": 14,
    "historyDepthDays": 17.1,
    "status": "inferred",
    "computedAt": "ISO"
  },
  "canaryConfigured": false   // true when Steakout runs a canary probe stake on this validator
}
```

### `GET /api/validators/:address`
Full profile: everything from the list item plus `description`, `rewardAddress` (+ explorer link), score components if provided by registry, `registryUpdatedAt`, and `canaryProbe` (`website` is already on the list item).

### `GET /api/validators/:address/favicon`
Serves the validator icon. Prefers the official registry `logo` (custom artwork
only; default identicons are omitted). If none is stored, fetches the operator
website: conventional `/favicon.ico`, then HTML-declared icons. SVG payloads
are sanitized for `<img>` (external DTD, `zoomAndPan`, percent-sized roots
stripped). The response is an image, not an HTML document, so it does not
carry the SPA Content-Security-Policy. The server caches website lookups for
24 hours, serves a last-known website icon while refreshing, and returns `404`
when no usable icon is available. Responses advertise the same 24-hour browser
cache window. Websites are registry declarations only; Steakout does not search
the web to invent missing sites.

```jsonc
"canaryProbe": {
  "configured": true,
  "status": "not-configured" | "pending" | "active",
  "statusLabel": "Pending observation",
  "probeId": "probe-01",
  "probeAddress": "NQ..",
  "probeExplorerUrl": "https://nimiq.watch/#…",
  "stakeAmountLuna": 99900000,
  "stakedAt": "ISO | null",
  "stakeTxHash": "hex | null",
  "stakeExplorerUrl": "https://nimiq.watch/#… | null",
  "payoutType": "direct" | "restake" | "unknown" | null,
  "lastPaymentAt": "ISO | null",           // pending until indexer sees reward→probe
  "lastPaymentLuna": null,
  "lastPaymentTxHash": null,
  "lastPaymentExplorerUrl": null,
  "lastStakerBalanceLuna": null,           // pending until staker snapshots exist
  "lastStakerBalanceAt": null,
  "observationCount": 0,                  // indexed successful payments and/or snapshots
  "firstObservedAt": null,                 // earliest indexed probe evidence
  "lastObservedAt": null,                  // latest indexed probe evidence
  "historyDepthDays": 0,                   // elapsed time from first evidence to response time
  "note": "…",
  "dataStatus": "insufficient" | "verified" | "unavailable"
}

The `canaryProbe` fields are evidence metadata for Steakout's own public
addresses. `status: "active"` and `dataStatus: "verified"` are used only when
the indexer has a successful reward-to-probe transaction or a staker snapshot.
Pending is not a verified observation.
```

Roster source: `server/config/probe-roster.public.json` (public addresses only; override with `PROBE_ROSTER_PATH`).

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

The response also includes `data.canary`, an aggregate of the configured public
probe roster. It contains `configuredCount`, a `payoutTypes` split (`direct`,
`restake`, `unknown`), and `statuses` (`observed`, `pending`, `unavailable`).
`observed` counts only probes with indexed successful payment or staker-snapshot
evidence. Restake and unknown canaries get snapshots from the background
`probeSnapshots` job (`CANARY_SNAPSHOT_ENABLED`, default on); direct canaries
still need a reward→probe transaction. `pending` means the evidence path is
checkable but no evidence is indexed yet. `unavailable` means the current
registry/roster data cannot support that check. These counts do not imply that
a missing observation proves a payout failure.

### `GET /api/explorer/transaction/:hash`
302 redirect to the canonical explorer URL for the active network, or JSON `{ url }` with `?format=json`.

## 4. Auth endpoints

### Desktop session handoff (Nimiq Pay phone → desktop browser)

1. Desktop `POST /api/auth/desktop-pair` → `{ pairId, expiresAt }` (≈5 min). No auth.
2. QR embeds `?desktopPair=<pairId>` in the Pay mini-app URL.
3. Phone (session cookie) `POST /api/auth/desktop-pair/approve` `{ pairId }`.
4. Desktop polls `GET /api/auth/desktop-pair/:pairId` until `status: "approved"`.
5. Desktop `POST /api/auth/desktop-pair/claim` `{ pairId }` → `Set-Cookie` for this origin + `{ address, sessionExpiresAt }`.

### `POST /api/auth/challenge`
Body: `{ address }`. Rate-limited. Returns `{ challengeId, message, expiresAt }` — `message` is the exact string the client passes to `nimiq.sign()`.

### `POST /api/auth/verify`
Body: `{ challengeId, signature, publicKey }`. Server verifies the Nimiq signed-message envelope, binds pubkey→address, creates a short-lived session (httpOnly cookie). Returns `{ address, sessionExpiresAt }`.

### `GET /api/me`
Session check → `{ address, sessionExpiresAt }` or `WALLET_NOT_CONNECTED`.

## 5. Authenticated position endpoints

### `GET /api/me/staking-position`

Authenticated live account + staker read for the session address. Query: optional `fresh=1` skips the short in-process cache (use after faucet or external funding so available balance is not stale for up to ~10s).

Balance fields are Pay-aligned:

- `accountBalanceLuna` — free basic balance on the session address (stake sizing baseline).
- `htlcBalanceLuna` / `htlcCount` — open HTLCs where this address is the **sender** (Pay payment contracts). Verified observation via RPC account type + sender.
- `walletBalanceLuna` — free + open HTLC as sender (matches what Nimiq Pay typically shows as wallet total). Null only when the free-balance read failed.

```jsonc
{
  "state": "NotStaked" | "Pending" | "Active" | "Inactive" | "Retiring" | "Withdrawable",
  "accountBalanceLuna": 0,            // free basic; nullable if account read fails
  "htlcBalanceLuna": 0,               // open HTLCs as sender (Pay contracts)
  "walletBalanceLuna": 0,             // free + htlc; nullable if free read fails
  "htlcCount": 0,
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
  // Restake only: multi-snapshot history. Null for direct-payout / not-staked. Never a payout claim.
  "observedPositionGrowth": {
    "label": "Observed position growth",
    "definition": "Change in this staker position between indexed snapshots.",
    "status": "observed" | "insufficient-data",
    "latest": { "at": "ISO", "totalLuna": 0, "sourceBlock": 0 | null, "validatorAddress": "NQ.. | null" } | null,
    "previous": { "at": "ISO", "totalLuna": 0, "sourceBlock": 0 | null, "validatorAddress": "NQ.. | null" } | null,
    "deltaLuna": 0,                       // latest − previous; null unless both snapshots present
    "totalDeltaLuna": 0,                  // sum of usable intervals; null when insufficient
    "window": { "from": "ISO", "to": "ISO", "durationDays": 0 } | null,
    "intervals": [{
      "from": { "at": "ISO", "totalLuna": 0, "sourceBlock": 0 | null, "validatorAddress": "NQ.. | null" },
      "to": { "at": "ISO", "totalLuna": 0, "sourceBlock": 0 | null, "validatorAddress": "NQ.. | null" },
      "deltaLuna": 0,
      "status": "observed" | "confounded",
      "confoundedBy": "staking-intent" | "delegation-change" | "chain-staking-action" | "chain-history-unavailable" | null
    }],
    "expectedRange": {
      "version": "illustrative-v1",
      "lowerLuna": 0, "upperLuna": 0,
      "annualRateLowPercent": 2, "annualRateHighPercent": 5,
      "assumptions": "string",
      "status": "inferred",
      "methodologyUrl": "#/learn/methodology"
    } | null,
    "freshness": { "at": "ISO", "ageSeconds": 0, "sourceBlock": 0 | null } | null
  } | null
}
```

Restake increases use type `observed-position-growth` and the fixed label **Observed position growth** — never "payout". Growth intervals containing a known non-failed Steakout intent, an observed protocol staking action from the authenticated address's chain history, or a delegation change are returned as `confounded` and excluded from `totalDeltaLuna`. An interval is also excluded as `chain-history-unavailable` unless its complete time range is covered by a successful address-history scan. Fewer than two snapshots, or no usable intervals, is `insufficient-data`; it is never represented as zero growth. Empty timeline is HTTP 200 with `items: []` (not an error).

### Authenticated monitoring: `/api/me/watchlist` and `/api/me/alerts`

The watchlist and alert inbox require the wallet session cookie. Watchlist
entries are validator addresses only; no keys or seed material are accepted.

- `GET /api/me/watchlist` → `{ data: { validators: [{ id, validatorAddress, validatorName, createdAt }] } }`
- `POST /api/me/watchlist` body `{ "validatorAddress": "NQ.." }` adds an observable validator idempotently.
- `DELETE /api/me/watchlist/:address` removes that validator from the caller's watchlist.
- `GET /api/me/alerts?limit=50` → `{ data: { alerts, unreadCount, nextCursor } }`.
- `POST /api/me/alerts/:id/read` marks one caller-owned alert read.
- `POST /api/me/alerts/read-all` marks all caller-owned alerts read.

Alert items are persisted with a per-user source `eventKey`, so reloading or
polling the inbox does not duplicate them. The server derives alerts from
indexed direct payouts to the authenticated address, staking intents, staker
snapshot position changes / retired-only withdrawable state, and new payout
runs or schedule-observation status changes for watched validators. These are
neutral observations: a missing alert or payout observation never proves a
missed payment or wrongdoing. Alert items have this shape:

```jsonc
{
  "id": 1,
  "type": "direct-payout" | "position-change" | "withdrawable" | "staking-intent" | "validator-status" | "payout-run",
  "title": "Observed direct payout",
  "message": "An indexed transaction to your address was observed from a validator reward address.",
  "observedAt": "ISO",
  "createdAt": "ISO",
  "readAt": "ISO | null",
  "isRead": false,
  "validatorAddress": "NQ.. | null",
  "validatorName": "string | null",
  "txHash": "hex | null",
  "amountLuna": 0
}
```

## 6. Staking action endpoints

### `GET /api/staking/intent/:intentId`
Auth required. Returns the caller’s intent for phone-approve / desktop wait:
`{ intentId, status, expiresAt, operation, params, summary, txHash, confirmedAt }`.
`404 INTENT_NOT_FOUND` if missing or owned by another wallet.

Desktop creates the intent, shows a Pay QR with `?approveIntent=<id>`. Phone loads this
endpoint, runs the provider, then `POST /api/staking/confirm`. Desktop polls this GET until
`status: "confirmed"`.

### `POST /api/staking/intent`
Body: `{ operation, params }` where

```ts
operation = "new-staker" | "stake" | "set-active" | "update-staker" | "retire" | "remove"
params    = { valueLuna?, delegation?, newActiveBalanceLuna?, newDelegation?, reactivateAllStake?, retireStakeLuna? }
```

Server validates (amounts > 0, address formats, state preconditions from chain reads), records the intent with expiry, returns `{ intentId, expiresAt, summary }`. `summary` is exactly what the client renders on the review screen.

### `POST /api/staking/cancel-pending`
Body: `{}` (auth cookie only). Expires the caller’s **abandoned** pending intents (status `pending` and no `tx_hash`). Used when the user backs out of review or never opened the wallet. Intents that already recorded a provider/tx hash are not cancelled here — they expire or confirm via `/confirm`. Response: `{ cancelled: number, message: string }`.

Creating a new intent via `POST /api/staking/intent` also auto-expires abandoned (no `tx_hash`) pending rows for that wallet so “Continue to review” is not blocked by a leftover desktop review.

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
