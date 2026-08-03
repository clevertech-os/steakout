# Phase 4 — Launch, measure & submit (Aug 31 – Sep 4)

**Goal:** maximize quality, unique wallet usage, storytelling, and submission completeness. Day-by-day layout in [ROADMAP.md](ROADMAP.md#week-4--launch-measure-submit-aug-31--sep-4).

Board: [README.md](README.md#phase-4--launch--submission-aug-31--sep-4)

---

### P4-01 — Reliability freeze checklist

- **Team:** Testing
- **Depends on:** P3-10, P3-11
- **Spec refs:** SPEC §12 Week-4 Monday
- **Human-in-the-loop:** no

**Scope:** feature freeze enforcement + production health verification: env vars complete and correct (against `.env.example`), no dev bypasses/test keys/spike routes reachable in production build, secrets sweep (tree + history), `/api/health` green (API + indexer + DB persistence across restart), `npm run smoke` green on the production build.

**Deliverables:**
- Completed freeze checklist `docs/freeze-checklist.md`
- Smoke script extended if gaps found (must cover: SPA boot, health, one public profile, evidence endpoint)
- Secrets sweep output attached (clean)

**Acceptance criteria:**
- [ ] `/spike` and any dev routes unreachable in production build
- [ ] Every env var in `.env.example` accounted for in production (values verified by owner)
- [ ] Indexer survives deploy restart with cursor continuity (log evidence)
- [ ] Zero secrets in tree/history scan

**Verification:** owner re-runs smoke against production URL.

**Notes:**
-

---

### P4-02 — README, submission description, build story

- **Team:** Polishing
- **Depends on:** P3-12
- **Spec refs:** SPEC §12 Week-4 Tuesday, §13 (submission)
- **Human-in-the-loop:** owner final approval

**Scope:** final written package: README quick start (setup, env, scripts) + architecture overview refresh; the **≤ 250-word submission description**; the public build-story post with honest limitations (linking Learn/limitations). Refresh validator data + observation calculations before screenshots are finalized.

**Deliverables:**
- README final (setup → dev → test → deploy, architecture diagram-in-text, links to docs/)
- `submission-assets/submission-description.md` (word count verified ≤ 250)
- `submission-assets/build-story.md`
- Verified-fresh screenshots (post data refresh)

**Acceptance criteria:**
- [ ] Submission description ≤ 250 words (script-verified count in Notes)
- [ ] README lets a stranger go from clone to running dev env without help
- [ ] Build story states limitations explicitly (methodology link)
- [ ] All text passes language-dictionary grep

**Verification:** owner approval; word-count + grep output in Notes.

**Notes:**
-

---

### P4-03 — Final QA sweep

- **Team:** Testing
- **Depends on:** P4-01
- **Spec refs:** SPEC §12 Week-4 Thursday, §13 (acceptance checklist)
- **Human-in-the-loop:** yes — device rows

**Scope:** the full Thursday list on the **production build**: clean open path, connected + disconnected paths, staking cancellation, pending → confirmation, stale indexer presentation, unavailable validator data, mobile sizes, all public share links, every evidence link on featured profiles, plus a complete walk of SPEC §13's acceptance checklist as the master list.

**Deliverables:**
- `tests/manual/final-qa.md`: SPEC §13 checklist with per-item pass/fail + evidence
- `npm run smoke` + full `npm test` output attached
- Bugs: blockers fixed same-day; non-blockers owner-triaged

**Acceptance criteria:**
- [ ] Every SPEC §13 checkbox answered with evidence (no untested "pass")
- [ ] All featured validator profiles' evidence links resolve correctly
- [ ] Production build from a clean checkout passes smoke end-to-end

**Verification:** owner signs the checklist.

**Notes:**
-

---

### P4-04 — Launch metrics report

- **Team:** Implementation
- **Depends on:** P3-04
- **Spec refs:** SPEC §16 (track list)
- **Human-in-the-loop:** no

**Scope:** assemble the launch-story numbers from the telemetry module: distinct connected wallets, staking intents, confirmed staking transactions, profile views, repeat sessions, profile shares, indexer history depth — as of submission morning, plus the time series across the cycle for the build story.

**Deliverables:**
- `submission-assets/metrics-2026-09-04.md` (auto-generated from `/api/metrics/public` + indexer stats, with generation script kept)
- One-paragraph honest interpretation (what the numbers do and don't show)

**Acceptance criteria:**
- [ ] Every number traceable to the metrics endpoint (no hand-counted claims)
- [ ] No raw addresses anywhere in the report
- [ ] Report regenerable on demand via the script

**Verification:** regeneration reproduces the numbers; owner reviews interpretation.

**Notes:**
-

---

### P4-05 — Submission packaging + submit

- **Team:** Owner (agents prepare)
- **Depends on:** P4-02, P4-03
- **Spec refs:** SPEC §12 Friday, §20 (launch definition)
- **Human-in-the-loop:** yes — owner submits

**Scope:** final packaging and submission through the competition dashboard: MIT license present, repo public and clean, live demo URL verified, demo video published, description within limit, launch post ready.

**Deliverables:**
- Pre-submission checklist mapping every SPEC §20 launch-definition item to evidence
- Submission confirmation recorded in this card's Notes (timestamp + any confirmation ID)
- Final launch post published (owner)

**Acceptance criteria:**
- [ ] All 10 SPEC §20 launch-definition items evidenced
- [ ] Dashboard submission completed and confirmed
- [ ] Post-submission monitoring plan noted (error checks, community questions)

**Verification:** owner confirmation.

**Notes:**
-

---

## Phase 4 milestone — submission complete

A polished, publicly usable, open-source Mini App with a clear story, real NIM usage, and measurable wallet adoption — submitted before the Sep 4 deadline with monitoring continuing afterwards.
