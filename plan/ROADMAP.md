# Roadmap — Cycle II calendar

Competition window: **Aug 10 – Sep 4, 2026**. The indexer starts in Week 0 because payout history only accumulates with wall-clock time ([SPEC.md §8.8](../docs/SPEC.md), §12).

## Week 0 — De-risk & accumulate history (Aug 2–9)

**Goal:** prove the protocol path; start collecting evidence before the competition begins. Cards: [phase-0-spike.md](phase-0-spike.md).

| Day | Focus | Cards |
|---|---|---|
| Aug 2 (Sun) | Repo + plan live; scaffold begins | P0-01 |
| Aug 3 | SDK smoke app; RPC probe | P0-02, P0-04 |
| Aug 4 | Testnet staking spike (device session) | P0-03 |
| Aug 5 | Validators API ingestion; fixture harness | P0-05, P0-08 |
| Aug 6 | Schema + indexer deployed and polling | P0-06 |
| Aug 7 | Classification spike + first local report | P0-07 |
| Aug 8 | Evidence assembly for decision | P0-03, P0-04, P0-06, P0-07 notes |
| Aug 9 | **Kill/scope decision + freeze + public build note** | P0-09 |

**Gate (P0-09):** if native staking writes are unavailable/unsafe → activate read-only accountability fallback (SPEC §11 scope fallback) before Week 1.

## Week 1 — Foundation & first usable stake (Aug 10–16)

**Goal:** connect → choose validator → native confirm → confirmed stake → position shown. Cards: [phase-1-foundation.md](phase-1-foundation.md).

- Mon–Tue: ports and server core (P1-01, P1-02, P1-03, P1-04, P1-05)
- Wed–Thu: app shell + styling base + screens (P1-07, P1-08, P1-09, P1-10, P1-11)
- Fri–Sat: stake flow + intent/confirm (P1-06, P1-12, P1-13)
- Sun: test gates (P1-14, P1-15, P1-16) + week retro on the board

**Milestone:** functional vertical slice on a real device. Public build note: "first native staking transaction".

## Week 2 — Accountability engine & private beta (Aug 17–23)

**Goal:** staking action + evidence-backed validator record. Cards: [phase-2-accountability.md](phase-2-accountability.md).

- Mon–Wed: classifier + endpoints (P2-01…P2-07, P2-13)
- Thu–Fri: evidence UI + labels + activity + lifecycle action (P2-08, P2-09, P2-10, P2-11, P2-16)
- Sat: Learn content (P2-12); test gates (P2-14, P2-15)
- Sun: validator outreach prep (owner-led; agents assemble preview URLs + neutral invitation copy from SPEC §16)

**Milestone (internal hard deadline): private beta** — at least one evidence-backed profile, no known blocker on the primary mobile path. Public build note: "first payout observation report".

## Week 3 — Public beta, polish, distribution (Aug 24–30)

**Goal:** strangers can use it; looks submission-ready. Cards: [phase-3-polish.md](phase-3-polish.md).

- Mon–Tue: lifecycle hardening + degraded mode + telemetry (P3-01, P3-02, P3-03, P3-04)
- Wed–Thu: design/responsive/a11y/states passes (P3-05, P3-06, P3-07, P3-08, P3-09)
- Fri: security review + failure matrix (P3-10, P3-11)
- Sat–Sun: **public beta** — live URL + deep link shared; issue intake; P3-13 triage (top-5 fixes ≤ 48 h); marketing assets drafted (P3-12)

**Milestone:** public beta with real wallet interactions. Public build note: beta announcement + tester request.

## Week 4 — Launch, measure, submit (Aug 31–Sep 4)

Cards: [phase-4-launch.md](phase-4-launch.md).

| Day | Focus | Cards |
|---|---|---|
| Mon | Reliability freeze — no new features | P4-01 |
| Tue | Evidence refresh; submission content | P4-02 |
| Wed | Community push: validators share profiles; video live | P4-04, owner |
| Thu | Final QA sweep on production build | P4-03 |
| Fri | **Submit** (license, repo, demo URL, video, ≤250-word description) | P4-05 |

**Milestone:** submission complete; launch metrics published.

## Decision gates (from SPEC §19)

| Gate | When | Question | If NO |
|---|---|---|---|
| G1 | Aug 9 (P0-09) | Native staking writes work + confirmable? | Read-only accountability fallback |
| G2 | Aug 13 | Position reads reliable? | Direct-payout monitoring only, labeled beta |
| G3 | Aug 20 | ≥1 validator profile evidence-backed? | Descope profile ambitions; ship honest "insufficient data" UX |
| G4 | Aug 27 | Public beta stable on devices? | Hold beta; extend triage; reduce scope (cut P3-02, alerts) |

## Standing obligations (all weeks)

- Indexer keeps running; check `GET /api/health` daily.
- Weekly public build note (owner posts; agents assemble facts/screenshots).
- Board hygiene: statuses current every day; blockers visible within the hour.
