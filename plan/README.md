# Steakout Implementation Plan

This is the operating plan for the agent team building Steakout. It turns [docs/SPEC.md](../docs/SPEC.md) into **59 assignable task cards** across 5 phases and 3 teams.

- Teams and responsibilities: [TEAMS.md](TEAMS.md)
- Calendar, milestones, decision gates: [ROADMAP.md](ROADMAP.md)
- Working agreement: [../AGENTS.md](../AGENTS.md)

## How to use this plan

1. **Pick a task** from the board below whose dependencies are all `done`. Check the phase file for the full card.
2. **Claim it**: set status to `in-progress` (+ your agent id) in the board row.
3. **Execute** per the task card. Keep findings in the card's **Notes** section.
4. **Verify**: run the card's verification commands. All acceptance criteria must hold.
5. **Close**: check the criteria boxes, set status `done` + date.

### Statuses

`backlog` → `ready` (deps done) → `in-progress` → `done` · or `blocked` (note required) / `cut` (scope decision, note required)

### Task card format (used in every phase file)

```
### P#-## — Title
- **Team:** Implementation | Testing | Polishing | All | Owner
- **Depends on:** P#-##, ...
- **Spec refs:** SPEC §x
- **Docs:** relevant docs/ files
- **Human-in-the-loop:** yes/no

**Scope** — one paragraph.
**Deliverables** — concrete artifacts (files, endpoints, screens, reports).
**Acceptance criteria** — checkable boxes.
**Verification** — commands/tests that must pass.
**Notes** — running log of findings, decisions, blockers.
```

Rules: cards are self-contained (an agent with repo access needs no other briefing); scope stays inside the card — if work grows, split a new card instead of ballooning the current one; never edit another team's card scope without a board note.

---

## Master task board

### Phase 0 — De-risk spike (Aug 2–9) → [cards](phase-0-spike.md)

| ID | Task | Team | Depends on | Status |
|---|---|---|---|---|
| P0-01 | App scaffold & engineering baseline | Implementation | — | backlog |
| P0-02 | Mini App SDK smoke screen | Implementation | P0-01 | backlog |
| P0-03 | Testnet staking-method spike | Implementation | P0-02 | backlog (human-assisted) |
| P0-04 | RPC read-layer probe + fixtures | Implementation | P0-01 | backlog |
| P0-05 | Validators API ingestion probe | Implementation | P0-01 | backlog |
| P0-06 | Schema + payout indexer live | Implementation | P0-04, P0-05 | backlog |
| P0-07 | Direct-payout classification spike | Implementation | P0-06 | backlog |
| P0-08 | Test fixture harness | Testing | P0-04, P0-05 | backlog |
| P0-09 | Kill-decision memo + scope freeze | Owner | P0-03, P0-04, P0-06, P0-07 | backlog (owner) |

### Phase 1 — Foundation & first stake (Aug 10–16) → [cards](phase-1-foundation.md)

| ID | Task | Team | Depends on | Status |
|---|---|---|---|---|
| P1-01 | Port wallet facade + helpers from VeriLock | Implementation | P0-01, P0-02 | backlog |
| P1-02 | Auth: challenge/verify + sessions + rate limits | Implementation | P1-01 | backlog |
| P1-03 | Server RPC client (retry/backoff/timeouts) | Implementation | P0-04 | backlog |
| P1-04 | Validator registry sync + `/api/validators` | Implementation | P0-05, P1-03 | backlog |
| P1-05 | Position endpoint + state normalization | Implementation | P0-04, P1-03 | backlog |
| P1-06 | Staking intent/confirm + chain matcher | Implementation | P0-03, P1-02, P1-03 | backlog |
| P1-07 | App shell + routing + bottom nav | Implementation | P0-01 | backlog |
| P1-08 | nimiq-css wiring + tokens + fonts | Implementation | P0-01 | backlog |
| P1-09 | Home dashboard (3 states) | Implementation | P1-05, P1-07, P1-08 | backlog |
| P1-10 | Validator directory + sorts | Implementation | P1-04, P1-08 | backlog |
| P1-11 | Validator profile (summary layer) | Implementation | P1-04, P1-08 | backlog |
| P1-12 | Stake flow end-to-end | Implementation | P1-06, P1-09, P1-10, P1-11 | backlog |
| P1-13 | Non-custodial explainer + review-screen copy | Polishing | P1-12 | backlog |
| P1-14 | Unit tests: addresses, luna, position, intent | Testing | P1-01, P1-05, P1-06 | backlog |
| P1-15 | Integration: auth, registry, intent/confirm | Testing | P0-08, P1-02, P1-04, P1-06 | backlog |
| P1-16 | Device smoke: Pay Android/iOS + Hub fallback | Testing | P1-12 | backlog (human-assisted) |

### Phase 2 — Accountability engine (Aug 17–23) → [cards](phase-2-accountability.md)

| ID | Task | Team | Depends on | Status |
|---|---|---|---|---|
| P2-01 | Payout-run grouping | Implementation | P0-06, P0-07 | backlog |
| P2-02 | Schedule normalization | Implementation | P0-05 | backlog |
| P2-03 | Schedule adherence calculator | Implementation | P2-01, P2-02 | backlog |
| P2-04 | Recipient coverage observations | Implementation | P2-01 | backlog |
| P2-05 | Personal continuity endpoint | Implementation | P1-02, P2-01 | backlog |
| P2-06 | Observations/evidence endpoints | Implementation | P2-03, P2-04 | backlog |
| P2-07 | History depth + freshness across APIs | Implementation | P2-06 | backlog |
| P2-08 | Evidence layer UI | Implementation | P1-11, P2-06 | backlog |
| P2-09 | Status labels + official-vs-observed UI | Implementation | P2-08 | backlog |
| P2-10 | Activity timeline (personal + network) | Implementation | P1-05, P2-05 | backlog |
| P2-11 | Change-delegation lifecycle action | Implementation | P0-03, P1-06 | backlog |
| P2-12 | Learn: staking, methodology, limitations | Polishing | P1-07 | backlog |
| P2-13 | Caching, rate limits, indexer diagnostics | Implementation | P2-06 | backlog |
| P2-14 | Unit tests: classifier, scoring, cursor | Testing | P2-01, P2-02, P2-03, P2-04 | backlog |
| P2-15 | Integration: indexer, dupes, evidence links | Testing | P0-06, P0-08, P2-06 | backlog |
| P2-16 | Shareable validator profile URLs + meta | Implementation | P2-08 | backlog |

### Phase 3 — Polish & public beta (Aug 24–30) → [cards](phase-3-polish.md)

| ID | Task | Team | Depends on | Status |
|---|---|---|---|---|
| P3-01 | Retire + remove flows | Implementation | P0-03, P2-11 | backlog |
| P3-02 | Restake position-growth analytics | Implementation | P0-04, P2-10 | backlog (conditional on P0-04) |
| P3-03 | RPC fallback / graceful degraded mode | Implementation | P2-13 | backlog |
| P3-04 | Telemetry (aggregate, disclosed) | Implementation | P2-16 | backlog |
| P3-05 | Design polish pass (nimiq-css tokens, type, status colors) | Polishing | P1-08, P2-09 | backlog |
| P3-06 | Responsive sweep + content stress cases | Polishing | P3-05 | backlog |
| P3-07 | Accessibility pass | Polishing | P3-05 | backlog |
| P3-08 | Loading/empty/offline/skeleton/stale states | Polishing | P3-05 | backlog |
| P3-09 | Copy pass (first-run, errors, methodology) | Polishing | P2-12 | backlog |
| P3-10 | Security review | Testing | P1-02, P1-06, P2-13 | backlog |
| P3-11 | Failure-mode matrix | Testing | P1-16, P2-16 | backlog (human-assisted) |
| P3-12 | Marketing assets (video script, screenshots, thread, post) | Polishing | P3-05 | backlog |
| P3-13 | Public beta triage: top-5 fixes in 48h | All | P3-05, P3-06, P3-07, P3-08 | backlog |

### Phase 4 — Launch & submission (Aug 31–Sep 4) → [cards](phase-4-launch.md)

| ID | Task | Team | Depends on | Status |
|---|---|---|---|---|
| P4-01 | Reliability freeze checklist | Testing | P3-10, P3-11 | backlog |
| P4-02 | README, submission description (≤250 words), build story | Polishing | P3-12 | backlog |
| P4-03 | Final QA sweep | Testing | P4-01 | backlog (human-assisted) |
| P4-04 | Launch metrics report | Implementation | P3-04 | backlog |
| P4-05 | Submission packaging + submit | Owner | P4-02, P4-03 | backlog (owner) |

---

## Parking lot (post-cycle / cut candidates)

Effective-fee research (with intent classification), restake analytics parity, push/email/Telegram alerts, network decentralization deep view, validator registry correction channel, self-hosted RPC node, dark mode. Items enter the board only via an Owner scope decision noted here.
