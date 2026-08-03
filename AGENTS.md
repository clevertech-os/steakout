 # AGENTS.md — how to work in this repo

You are one of a team of agents building **Steakout**. This file is your entry point. Read it fully, then read the task card you were assigned from [`plan/`](plan/README.md).

## 1. Ground truth, in order

1. [`docs/SPEC.md`](docs/SPEC.md) — authoritative product spec. If code and spec disagree, the spec wins (or you stop and ask).
2. Your **task card** in [`plan/phase-*.md`](plan/README.md) — defines your scope, deliverables, and acceptance criteria.
3. The technical docs in [`docs/`](docs/) — architecture, API contract, data model, methodology, styling, testing, security.

Do not improvise product decisions. If a task is ambiguous or contradicts the spec, stop and ask the owner instead of guessing.

## 2. Teams and scope

You belong to exactly one team (see [`plan/TEAMS.md`](plan/TEAMS.md)):

| Team | Owns | Does NOT own |
|---|---|---|
| **Implementation** | `client/`, `server/`, indexer, integrations, deploy config | Test plans, marketing copy, final visual polish |
| **Testing** | `tests/`, fixtures, QA sweeps, security review, device matrix | Product features (file bugs instead) |
| **Polishing** | Design system, UX copy, responsive/a11y passes, marketing assets | Business logic, API shapes, data model |

Work only inside your team's scope unless a task card explicitly says otherwise. Cross-team problems are reported via the task board, not silently patched.

## 3. Commands (once P0-01 scaffold lands)

```bash
npm run dev            # server (:3000) + client (:5173) together
npm run dev:server     # Express API only (tsx watch)
npm run dev:client     # Vite dev server only
npm test               # all unit + integration tests (vitest)
npm run test:client    # client tests
npm run test:server    # server tests
npm run build          # typecheck + production build
npm run smoke          # production smoke checks (built SPA + API health)
```

Until the scaffold exists, the repo is docs-only; there is nothing to run.

## 4. Product invariants — never violate these

1. **Non-custodial.** Never request, receive, or store private keys or seed phrases. All staking writes go through the Nimiq Pay provider (`@nimiq/mini-app-sdk`). The client never constructs or signs staking transactions itself.
2. **Server-verified truth.** The server never accepts a client claim that a transaction succeeded. Every confirmation is matched against chain data (authenticated address + intended operation + amount + validator).
3. **Review before confirm.** No provider transaction method is ever invoked without a prior review screen showing action type, amount (NIM), validator name + address, and the resulting state transition.
4. **Honest metrics only.** Banned in v1: effective validator fee, fraud/scam scores, guaranteed APY, "best validator" rankings, and any claim that a missing payment proves wrongdoing. Every metric ships with a one-sentence definition, a source, a freshness timestamp, and a status label (`Verified observation` / `Registry declaration` / `Inferred` / `Insufficient data` / `Unavailable`).
5. **Neutral language.** Use `observed`, `not observed`, `insufficient data`, `needs review`. Never accusatory wording. See [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).
6. **Official score alongside, never replaced.** The Validator Trust Score is always displayed as the official score, distinct from Steakout observations.

## 5. Engineering conventions

- **TypeScript strict** everywhere. No `any` unless a comment justifies it.
- **ESM** (`"type": "module"`), Node >= 22.
- Server runs via `tsx`; production start is `node --import tsx src/index.ts` (same as VeriLock).
- **SQLite via `better-sqlite3`.** Schema lives in `server/src/db.ts` and must match [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md). Migrations are additive only.
- **Styling:** `nimiq-css` native CSS layers + Steakout token overrides. No Tailwind/UnoCSS unless [`docs/STYLING.md`](docs/STYLING.md) is updated first. No CSS-in-JS libraries.
- **Anti-slop (UI work):** before any visual restyle or new chrome, load [`docs/anti-slop.md`](docs/anti-slop.md) (ported from VeriLock). Run the ban list + section 5 pre-ship checklist. Prefer scoped passes over “make it pretty.”
- **Components:** plain React function components, co-located CSS files (`Foo.tsx` + `Foo.css`), matching the VeriLock style.
- **Minimal diffs.** Touch only what your task requires. Follow existing patterns rather than introducing new libraries.
- **No secrets.** Nothing sensitive is committed. Config comes from env vars; add new vars to `.env.example`.
- **Address handling:** always normalize and validate Nimiq addresses via the shared helpers (ported in P1-01); never string-compare raw input.

## 6. VeriLock reuse

Port, don't reinvent. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#verilock-reuse-map) lists exactly which VeriLock modules to copy and what to strip. The VeriLock repo lives at `/Users/sharms/_github_repos/verilock`. Do **not** copy document/PDF/Stripe/credit code.

## 7. Workflow for every task

1. Read your task card + linked docs. Confirm dependencies are `done` on the [board](plan/README.md#master-task-board).
2. Set your task to `in-progress` on the board (edit the status cell).
3. Implement the smallest change that satisfies every acceptance criterion.
4. Run the verification commands listed on the card (tests, typecheck, build). All must pass.
5. Self-check against the acceptance criteria, item by item.
6. Update the board: `done` + date. If partially blocked, leave `in-progress` and write a blocker note in the task card's **Notes** section.
7. If you changed anything described in [`docs/`](docs/) or this file, update the doc in the same change.

## 8. Definition of done (all teams)

- Acceptance criteria on the task card: all checked.
- `npm run build` passes; relevant `npm test` suites pass.
- No new dependencies unless the task card allows them.
- No linter/type suppressions without a justification comment.
- Board and docs updated.

## 9. Communication

Agents do not have a chat channel. Coordination happens through:

- the [master task board](plan/README.md#master-task-board) (status),
- the **Notes** section of each task card (blockers, decisions, findings),
- spike reports under `docs/spikes/` (evidence for kill/scope decisions).

Write findings for the next agent as if they cannot ask you questions — because they can't.
