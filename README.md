# Steakout

> **Stake in. Know who is paying you.**

Steakout is a non-custodial Nimiq staking cockpit and validator accountability layer built for **Nimiq Pay**. It adds a mobile-first staking flow using Nimiq Pay's native staking transaction methods, then gives stakers a plain-language, evidence-linked view of what happens after delegation: declared payout policy vs. observed chain behavior, recipient coverage, and personal position history.

- **Competition:** Nimiq Mini Apps Competition, Cycle II (Aug 10 – Sep 4, 2026)
- **Status:** Pre-implementation. The repo currently contains the spec, technical docs, and an agent-ready implementation plan.
- **License:** MIT

## Read first

| Document | Purpose |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | **Authoritative product spec** — scope, methodology, schedule, acceptance checklist |
| [plan/README.md](plan/README.md) | **Implementation plan** — master task board, task-card format, workflow |
| [plan/TEAMS.md](plan/TEAMS.md) | Agent team charters (implementation / testing / polishing) and assignments |
| [plan/ROADMAP.md](plan/ROADMAP.md) | Week-by-week schedule mapped to task IDs and decision gates |

## Technical docs

| Document | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, module layout, VeriLock reuse map |
| [docs/API.md](docs/API.md) | API contract: endpoints, response rules, error taxonomy |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | SQLite schema (DDL) and indexer strategy |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Accountability methodology: status labels, neutral language, excluded metrics |
| [docs/STYLING.md](docs/STYLING.md) | Design system on [nimiq-css](https://onmax.github.io/nimiq-ui/nimiq-css/getting-started.html) |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, fixtures, device matrix, failure cases |
| [docs/SECURITY.md](docs/SECURITY.md) | Non-custody, auth, transaction safety, privacy, defamation controls |

## Stack (planned)

- **Client:** React 19 + TypeScript + Vite, styling via `nimiq-css` (native CSS layers)
- **Server:** Express + TypeScript (`tsx`), `better-sqlite3`
- **Chain:** `@nimiq/mini-app-sdk` (wallet + native staking writes), server-side Nimiq RPC (reads)
- **Deploy:** Railway, single service serving API + SPA, Dockerfile at root
- **Reuse:** wallet/RPC/auth modules ported from [VeriLock](https://github.com/sharms/verilock) (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#verilock-reuse-map))

## Working in this repo

This project is built by a team of agents. **Read [AGENTS.md](AGENTS.md) before touching anything**, then pick a task from the [master board](plan/README.md#master-task-board).

## Non-negotiables (short version)

1. **Non-custodial, always.** Steakout never receives keys or constructs transactions outside the Nimiq Pay provider.
2. **No client-reported success.** The server confirms every staking transaction from chain data.
3. **No invented metrics.** No effective fee, no APY promises, no accusatory labels. Every metric carries a definition, a source, a freshness timestamp, and a status label.
4. **Review before confirm.** The user always sees action, amount, and destination before the native wallet dialog.

The full rules live in [docs/METHODOLOGY.md](docs/METHODOLOGY.md) and [docs/SECURITY.md](docs/SECURITY.md).
