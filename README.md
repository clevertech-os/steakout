# Steakout

> **Stake in. Know who is paying you.**

Steakout is a **non-custodial** Nimiq staking cockpit and validator accountability layer built for **Nimiq Pay**.

It connects two jobs:

1. **Stake from the wallet you already use** — when native staking writes are available in Nimiq Pay, users review the action, amount, and validator, then approve in the wallet. Steakout never holds keys or builds staking transactions itself.
2. **See what happens after delegation** — declared registry policy vs. observed chain behavior (payout runs, schedule adherence when normalizable, recipient coverage), personal position history when connected, and clear status labels on every metric.

Official Validator Trust Score stays visible as the official score. Steakout adds the staker-side view Nimiq’s score does not cover: whether payouts are **observed** against declared schedules — without accusing validators or promising returns.

- **Competition:** Nimiq Mini Apps Competition, Cycle II (Aug 10 – Sep 4, 2026)
- **License:** [MIT](LICENSE)
- **Spec:** [docs/SPEC.md](docs/SPEC.md) (authoritative product scope)

## Non-custodial by design

| Rule | What it means |
|---|---|
| No keys, ever | Steakout never requests, receives, or stores private keys or seed phrases. |
| Wallet does the writes | Staking actions go through the Nimiq Pay provider (`@nimiq/mini-app-sdk`). The client does not construct or sign staking transactions. |
| Server-verified truth | The server does not accept “tx succeeded” claims from the client. Confirmations match chain data against authenticated address + intended operation. |
| Review before confirm | No provider transaction method is invoked without a prior review of action, amount (NIM), validator, and resulting state transition. |

Details: [docs/SECURITY.md](docs/SECURITY.md).

## Honest metrics (no guaranteed APY)

Steakout does **not** ship effective fee, fraud scores, guaranteed APY, or “best validator” rankings.

Every accountability metric is meant to carry:

- a one-sentence definition  
- a source  
- a freshness timestamp  
- a status label: `Verified observation` · `Registry declaration` · `Inferred` · `Insufficient data` · `Unavailable`

Language stays neutral: **observed**, **not observed**, **insufficient data**, **needs review**. See [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## What’s implemented

Reflects the current codebase and task board (not a product promise of completion for every SPEC item).

| Area | Status |
|---|---|
| Monorepo scaffold (Vite client + Express server + SQLite) | Implemented |
| Wallet connection facade (Nimiq Pay + Hub fallback path) | Implemented (full Pay session needs a device) |
| Challenge / verify auth + sessions | Implemented |
| Validator registry sync + directory + profile UI | Implemented |
| Staking position read (`/api/me/staking-position`) | Implemented |
| Home dashboard (disconnected / not staked / staked) | Implemented |
| Payout indexer + run grouping + observations API | Implemented |
| Evidence layer, status labels, freshness | Implemented |
| Activity timeline (personal + network) | Implemented |
| Learn: staking, methodology, limitations, privacy | Implemented |
| Shareable validator profile URLs + OG meta | Implemented |
| Unit + integration tests, smoke script | Implemented |
| Production packaging (Dockerfile, Railway config) | Implemented |

## What’s pending

| Area | Notes |
|---|---|
| **Native stake writes in production UI** | Provider methods are exercised only under guarded `/spike` harnesses. Device verification on Nimiq Pay (Android/iOS) is still required before shipping stake CTAs. |
| **Intent / confirm API + end-to-end stake flow** | Server matching and client review flow (P1-06 / P1-12) are not finished. Profile stake CTA is a stub until then. |
| Change delegation / retire / remove flows | Depend on device-proven methods + intent path. |
| Public beta polish, freeze, submission packaging | Phase 3–4 board items still open. |

Spike evidence: [docs/spikes/](docs/spikes/).

## Quick start (local)

**Requirements:** Node.js **≥ 22**, npm.

```bash
git clone <repo-url> steakout
cd steakout
npm install
cp .env.example .env
# Edit .env: at minimum set SESSION_SECRET to a long random string.
# Defaults point at testnet RPC; mainnet reads need NIMIQ_NETWORK + NIMIQ_RPC_URL accordingly.
# Root `.env` is loaded by both the server and Vite (client `envDir` → monorepo root).
npm run dev
```

- **API + static:** [http://localhost:3000](http://localhost:3000)  
- **Vite client (dev):** [http://localhost:5173](http://localhost:5173) (proxies API via CORS / `CORS_ORIGIN`)
- **Network badge:** yellow when `VITE_NIMIQ_NETWORK` is not `mainnet`. Restart `npm run dev` after changing `.env` (Vite only reads env at startup).

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Server (`tsx` watch) + Vite client together |
| `npm run dev:server` | Express API only |
| `npm run dev:client` | Vite only |
| `npm test` | Unit + integration (vitest) |
| `npm run build` | Typecheck + production client build |
| `npm run smoke` | Production smoke checks (built SPA + API health) |

### Environment

Copy [`.env.example`](.env.example). Important variables:

| Variable | Role |
|---|---|
| `SESSION_SECRET` | Required for auth cookies |
| `NIMIQ_NETWORK` / `NIMIQ_RPC_URL` | Chain network + RPC |
| `NIMIQ_RPC_URL_FALLBACK` | Optional secondary RPC |
| `VALIDATORS_API_URL` | Official validators registry |
| `INDEXER_ENABLED` | Enable reward-address payout indexing (off by default in example) |
| `DATA_DIR` | SQLite location |
| `CORS_ORIGIN` | Browser origin allowed to call the API (dev: `http://localhost:5173`) |
| `VITE_NIMIQ_NETWORK` | Client network badge + Hub/RPC defaults (`mainnet` hides badge; `testnet` → hub.nimiq-testnet.com) |
| `VITE_NIMIQ_HUB_URL` | Optional Hub override (else derived from network) |
| `PUBLIC_APP_URL` | Canonical origin for shareable profile meta |

Indexer and diagnostics options are documented in `.env.example`.

### Deploy sketch

Single service: API serves `client/dist`. Root [Dockerfile](Dockerfile) and [railway.toml](railway.toml). Set production env vars to match `.env.example` (secrets never committed).

## Architecture (text)

```text
Browser / Nimiq Pay Mini App
  └─ React client (wallet connect, UI, review screens only)
       │  HTTPS
       ▼
  Express API  ── SQLite (registry cache, payout index, sessions)
       │
       ├─ Nimiq RPC (reads: accounts, stakers, txs, validators)
       └─ Validators API (declared policy / listing)

  Staking writes (when wired): Nimiq Pay provider → chain
  Confirmation (when wired): API matches chain tx to recorded intent
```

Module map and VeriLock reuse: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

| Document | Purpose |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Authoritative product spec |
| [docs/API.md](docs/API.md) | API contract |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | SQLite schema + indexer strategy |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Status labels, neutral language, excluded metrics |
| [docs/SECURITY.md](docs/SECURITY.md) | Non-custody, auth, privacy |
| [docs/STYLING.md](docs/STYLING.md) | Design system (nimiq-css) |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy |
| [docs/submission-description.md](docs/submission-description.md) | Competition description draft (≤250 words) |
| [plan/README.md](plan/README.md) | Agent task board |

## Working in this repo

Built by coordinated agents. Read [AGENTS.md](AGENTS.md), then pick a task from the [master board](plan/README.md#master-task-board).
