# Agent Teams

Three teams build Steakout. Each agent instance belongs to exactly one team per assignment. Charters are binding; the master board in [README.md](README.md) tracks ownership per task.

## Team Implementation — "IMPL"

**Mission:** build the working product — client, server, indexer, integrations, deployment.

**Owns:** `client/`, `server/`, `Dockerfile`, `railway.toml`, root scripts, `.env.example`.

**Typical tasks:** scaffold, VeriLock ports, auth, RPC client, registry sync, position reads, staking flows, indexer, classifier, evidence endpoints, activity, lifecycle actions.

**Rules:**
- Follow [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) and the API contract in [../docs/API.md](../docs/API.md) exactly; change contracts only by updating the doc in the same commit.
- Honor the product invariants in [../AGENTS.md](../AGENTS.md) §4 — they override any convenience.
- Write unit tests for pure logic you create (normalizers, matchers, parsers); Team Testing owns suites but you don't ship untested logic.
- Leave visual final-pass to Polishing, but ship screens that are complete, responsive, and use [../docs/STYLING.md](../docs/STYLING.md) tokens from day one.

**Handoff:** mark the task `done` with verification output in Notes; Testing picks it up from the board.

## Team Testing — "TEST"

**Mission:** prove the product works and keep it honest — test suites, fixtures, QA sweeps, security review, device matrix.

**Owns:** `tests/`, fixture policy, `npm run smoke`, QA checklists, bug triage (severity + routing).

**Typical tasks:** fixture harness, unit/integration suites, device smoke passes, failure matrix, security review, freeze + final QA.

**Rules:**
- Tests never hit live network — everything through fixtures ([../docs/TESTING.md](../docs/TESTING.md)).
- Found a product bug? Don't fix the product. File it in the owning card's Notes with repro, expected vs actual, severity. Blockers preempt the board.
- Acceptance-gate failures are reported against the specific acceptance criterion that failed, with evidence (test output, screenshots, device/OS).
- Verify the honesty rules: status labels, freshness, banned metrics, neutral language — Testing is the second pair of eyes for [../docs/METHODOLOGY.md](../docs/METHODOLOGY.md).

**Handoff:** gate results recorded in the phase file's milestone section; blockers flagged on the board immediately.

## Team Polishing — "POLISH"

**Mission:** make it feel finished and sound right — design system, responsive, accessibility, copy, methodology content, marketing assets.

**Owns:** `client/src/styles/`, component CSS refinement, UX copy across screens, Learn content, `submission-assets/`, README presentation (with Owner).

**Typical tasks:** nimiq-css token polish, responsive + a11y passes, state design (loading/empty/offline), copy passes, methodology/limitations pages, demo video script, screenshots, launch posts.

**Rules:**
- [../docs/STYLING.md](../docs/STYLING.md) is the contract; extend the doc before inventing new patterns.
- Copy must obey the [language dictionary](../docs/METHODOLOGY.md#8-language-dictionary) — neutral, non-promissory, no fake precision.
- Never change business logic, API shapes, or data semantics; route logic issues to Testing/Implementation via board notes.
- Every screen must survive 320px width, long names, huge balances, missing logos, slow networks.

**Handoff:** visual/copy changes verified by a Testing regression pass before `done` on shared screens.

## Cross-team rules

1. One task = one assignee at a time. Shared tasks (`All`) are split in the card's Notes before work starts.
2. Coordination happens only through the board, card Notes, and spike reports — write for a reader who cannot ask you questions.
3. Human-in-the-loop tasks (device tests, owner decisions, community outreach) are marked on the board; agents prepare everything testable/decidable in advance so the human session is short.
4. Owner (Sam) holds scope decisions: kill criteria, scope cuts, `cut` statuses, submission.
