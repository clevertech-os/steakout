# Architecture

Technical design for Steakout. Expands [SPEC.md §8](SPEC.md). Where this file and the spec disagree, the spec wins — file a note on the task board.

## 1. Deployment shape

Same pragmatic shape as VeriLock:

- React + TypeScript + Vite client (`client/`)
- Express + TypeScript server (`server/`, run with `tsx`)
- SQLite (`better-sqlite3`) for operational data and indexer state
- Single Railway service serving API + built SPA from `client/dist`
- Root `Dockerfile`; `railway.toml`
- Public mini app URL + normal browser fallback (Nimiq Hub path)

## 2. Repository layout (target, after P0-01)

```text
steakout/
  package.json              # root scripts: dev/build/test/smoke (concurrently + --prefix)
  Dockerfile
  railway.toml
  client/
    index.html
    vite.config.ts
    package.json
    public/assets/fonts/    # Mulish + Fira Mono (see docs/STYLING.md)
    src/
      main.tsx
      App.tsx               # shell + routing + bottom nav
      nimiq.ts              # Pay + Hub wallet facade (ported, P1-01)
      api.ts                # typed API client
      session.ts            # session persistence (ported, P1-01)
      addresses.ts          # address normalize/validate (ported, P1-01)
      explorer.ts           # explorer URLs (ported, P1-01)
      styles/
        nimiq.css           # nimiq-css layer imports (see docs/STYLING.md)
        tokens.css          # Steakout semantic tokens on top of nimiq-css
        base.css
      wallet/               # connection state, challenge signing, account menu
      home/                 # dashboard states (disconnected / not-staked / staked)
      validators/           # directory, profile, evidence, share cards
      staking/              # stake flow, position management, review sheets
      activity/             # personal + network activity timeline
      learn/                # how staking works, methodology, limitations
      components/           # StatusChip, EvidenceRow, FreshnessTag, Identicon, Amount, ...
  server/
    package.json
    tsconfig.json
    src/
      index.ts              # express bootstrap, static SPA, security headers
      db.ts                 # better-sqlite3 schema + additive migrations
      auth.ts               # challenge/verify, sessions, address binding
      hub-signature.ts      # signed-message verification (ported, P1-02)
      auth-wallet.ts        # public-key -> address binding (ported, P1-02)
      nimiq-rpc.ts          # RPC client: retries, backoff, timeouts (ported, P1-03)
      validators-api.ts     # official validators API client (known + all-observable)
      validatorSync.ts      # registry -> validators table, scheduled
      stakingState.ts       # account/staker reads + position normalization
      payoutIndexer.ts      # reward-address tx indexing + cursors + scheduler
      payoutClassifier.ts   # payout-run grouping, schedule adherence, coverage
      observationScoring.ts # status labels, history depth, freshness
      stakingIntents.ts     # intent/confirm endpoints + chain matching
      explorer.ts           # explorer URL builder (server-side)
      rate-limit.ts         # ported (P1-02)
      http-headers.ts       # security headers (ported, P1-02)
      security.ts
  tests/
    fixtures/               # RPC + validators API + tx fixtures (P0-08)
    unit/
    integration/
  docs/  plan/  tests/
```

## 3. Client responsibilities / prohibitions

**Does:** mobile-first UI, provider initialization + warmup, wallet connection, native staking transaction *requests*, input validation + review screens, polling the Steakout API for status, public validator/evidence views, explorer links.

**Never:** stores keys; constructs/signs staking transactions outside the provider; treats a client-reported transaction as confirmed; displays stale state as current without a timestamp.

## 4. Server responsibilities

Wallet challenge + signed-message auth; validators registry sync; Nimiq RPC access with retry/backoff and (later) fallback source; staker/account reads; transaction confirmation + status normalization; reward-address resolution; payout history indexing; observation classification; rate limiting + caching; public validator profile APIs.

## 5. Nimiq integration surface

### 5.1 Provider writes (`@nimiq/mini-app-sdk`)

```ts
await nimiq.sendNewStakerTransaction({ delegation: validatorAddress, value: valueInLuna })
await nimiq.sendStakeTransaction({ value })
await nimiq.sendSetActiveStakeTransaction({ newActiveBalance })
await nimiq.sendUpdateStakerTransaction({ newDelegation, reactivateAllStake })
await nimiq.sendRetireStakeTransaction({ retireStake })
await nimiq.sendRemoveStakeTransaction({ value })
```

**Open question (P0-03 must answer):** docs and package type comments disagree on whether these return a tx hash or a serialized transaction. Record the actual return value per method in `docs/spikes/staking-methods.md` and encode the result in `stakingIntents.ts`.

### 5.2 Wallet identity

- `listAccounts()` → connected address (display + session hint only)
- `sign()` → server challenge authentication; verified server-side with the Nimiq signed-message envelope (`hub-signature.ts` port)
- **Never** use `requestDeviceIdentifier()` as identity (device-scoped per docs; may be reused later for abuse throttling only)

### 5.3 Reads (server-side RPC)

Provider exposes no reads. Server probes in P0-04 must validate: `getBlockNumber`, `getValidatorByAddress`, `getActiveValidators`, `getAccountByAddress`, `getStakerByAddress`, `getTransactionsByAddress`, `getTransactionByHash`. The public RPC endpoint is a development/fallback dependency — production needs rate-limit handling, caching, and a documented second-source/self-host plan (tracked in P3-03).

## 6. VeriLock reuse map

VeriLock repo: `/Users/sharms/_github_repos/verilock`. Port = copy + strip document-specifics + adapt to this repo's conventions.

| VeriLock source | Steakout target | Port task | Strip / change |
|---|---|---|---|
| `client/src/nimiq.ts` | `client/src/nimiq.ts` | P1-01 | Remove seal/document tx payloads; keep provider warmup, Pay+Hub facade, tx submit/poll |
| `client/src/journey/useJourneyWallet.ts` | `client/src/wallet/useWallet.ts` | P1-01 | Keep connection state machine + mobile/desktop handling; drop journey coupling |
| `client/src/session.ts` | `client/src/session.ts` | P1-01 | Keep as-is where possible |
| `client/src/addresses.ts` | `client/src/addresses.ts` | P1-01 | Keep as-is |
| `client/src/explorer.ts` | `client/src/explorer.ts` + `server/src/explorer.ts` | P1-01 | Keep URL builders |
| `server/src/nimiq-rpc.ts` | `server/src/nimiq-rpc.ts` | P1-03 | Keep retries/backoff/verification; drop document attestation calls |
| `server/src/hub-signature.ts` | `server/src/hub-signature.ts` | P1-02 | Keep as-is |
| `server/src/auth-wallet.ts` | `server/src/auth-wallet.ts` | P1-02 | Keep pubkey→address binding; drop document flows |
| `server/src/rate-limit.ts` | `server/src/rate-limit.ts` | P1-02 | Keep as-is |
| `server/src/http-headers.ts` | `server/src/http-headers.ts` | P1-02 | Keep as-is |
| `Dockerfile`, `railway.toml` | root | P0-01 | Adapt names/paths |

**Do not port:** document DB tables, PDF rendering/annotation, credits/Stripe, invitations/signing flows, journey components, seal payloads.

## 7. Data flow

```
Nimiq Pay provider ──writes──> Nimiq chain
      │                            │
      │ (address, signature)       │ RPC reads
      ▼                            ▼
  client ──API──> server ──> SQLite (validators, transactions,
      │                              observations, snapshots, cursors)
      └──<── normalized JSON ──────┘
```

- **Registry sync** (`validatorSync.ts`): polls official validators API (both `only-known=true` and all-observable modes), resolves reward addresses via RPC, upserts `validators`, stamps `registry_updated_at`.
- **Indexer** (`payoutIndexer.ts`): per reward address, incremental `getTransactionsByAddress` pages → normalized `transactions` rows (dedup by hash) → cursor advance. Scheduler: 30–60 min cycle, bounded pages, per-address concurrency limit, exponential backoff.
- **Classifier** (`payoutClassifier.ts`): reads `transactions` → payout runs, schedule adherence, recipient coverage → `validator_observations`.
- **Position reads** (`stakingState.ts`): on authenticated request, RPC `getStakerByAddress` + `getAccountByAddress` → normalized position → response (+ `staker_snapshots` append for restake growth history).

## 8. Normalized position states

Single client-visible enum (P1-05 owns the mapping; verify against P0-04 fixtures):

| State | Meaning |
|---|---|
| `NotStaked` | No staker account / zero balance |
| `Pending` | Staking tx broadcast, not yet confirmed on chain |
| `Active` | Active balance > 0, delegated |
| `Inactive` | Stake set inactive, not retired |
| `Retiring` | Retired, waiting period not elapsed |
| `Withdrawable` | Retired and removable via `sendRemoveStakeTransaction` |

## 9. Caching & rate limits

- Registry data: server cache, refresh ≥ hourly; responses always carry `registry_updated_at`.
- Position reads: short TTL (seconds) cache per address; never serve without `updatedAt`.
- Public profile/observation endpoints: in-process **stale-while-revalidate** cache (`server/src/responseCache.ts`). Stable key = path + query (not watermark). Fresh TTL ~45s; last-good kept ~1h. On TTL expiry or after idle, serve last-good immediately (`X-Cache: STALE`, envelope `status: stale` when previously `ok`) and revalidate in the background. Cold miss rebuilds from SQLite only (no live RPC). Boot warms default recommended list keys. `X-Cache: HIT|STALE|MISS` for ops.
- **Payment floors:** weekly precompute into `payment_floors` (`paymentFloor.ts`). List/profile join precomputed rows only — never scan `transactions` on a request. Scheduler checks hourly; refresh when empty or `computed_at` ≥ 7 days old.
- Rate limits (P2-13):
  - Global `/api`: 300 req / 60s per IP.
  - Auth challenge: 12 / 60s per IP + 12 / 60s per address; verify: 24 / 60s per IP.
  - Staking tree `/api/staking`: 60 / 60s per IP (strict layer above global; intent/confirm use this when mounted).
- Operator diagnostics: `GET /api/diagnostics` (token-gated via `DIAGNOSTICS_TOKEN`, Bearer or `?token=`). Indexer health/cycles, RPC metrics, cursor fingerprints (no raw addresses), DB table counts, cache stats. Excluded from public API docs.

## 10. Failure design

| Failure | Behavior |
|---|---|
| RPC timeout/malformed | Retry w/ backoff; optional `NIMIQ_RPC_URL_FALLBACK` failover (P3-03). Live reads → `RPC_UNAVAILABLE`. Public registry/observations keep serving SQLite with honest freshness. Health: `mode: degraded`, `features.liveChainReads: false`. Never 500 the SPA shell |
| Indexer stale | Profiles show history depth + last-indexed time; no fresh-looking empty state |
| Provider unavailable (browser fallback) | Hub path from ported facade; staking writes degrade to read-only with clear copy |
| Tx not found / failed execution | Distinct error codes per [API.md](API.md#error-taxonomy); UI returns to a useful state |

## 11. Environments

| Env | Chain | Purpose |
|---|---|---|
| local dev | testnet RPC | all development |
| testnet beta | testnet | device testing, staking spikes |
| production | mainnet (reads) + mainnet Pay (writes) | public demo + submission |

Chain selection is env-driven (`NIMIQ_NETWORK`); the UI always displays which network it is on when not mainnet.
