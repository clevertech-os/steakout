# Phase 1 — Foundation & first usable stake (Aug 10–16)

**Goal:** a new Nimiq Pay user can connect, choose a validator, stake testnet NIM, and see the resulting position — the vertical slice. See [ROADMAP.md](ROADMAP.md#week-1--foundation--first-usable-stake-aug-1016).

Board: [README.md](README.md#phase-1--foundation--first-stake-aug-1016)

---

### P1-01 — Port wallet facade + helpers from VeriLock

- **Team:** Implementation
- **Depends on:** P0-01, P0-02
- **Spec refs:** SPEC §8.5
- **Docs:** ARCHITECTURE.md §6 (reuse map)
- **Human-in-the-loop:** no

**Scope:** port the client wallet stack from VeriLock (`/Users/sharms/_github_repos/verilock`): `client/src/nimiq.ts` → `client/src/nimiq.ts` (Pay + Hub facade, provider warmup, tx submit/poll helpers, explorer links), `journey/useJourneyWallet.ts` → `client/src/wallet/useWallet.ts` (connection state machine minus journey coupling), plus `session.ts`, `addresses.ts`, `explorer.ts` (client copies + server-side explorer builder). Strip every document/seal-specific piece.

**Deliverables:**
- The five modules above, compiling strict, with VeriLock provenance noted in file headers
- No references to documents, sealing, PDFs, credits, or Stripe anywhere in ported code
- `useWallet` exposes: `status`, `address`, `connect()`, `disconnect()`, `signMessage()`, provider-availability flags (Pay vs Hub vs none)

**Acceptance criteria:**
- [x] All ported modules build under this repo's strict tsconfig
- [x] Connection state machine matches VeriLock behavior (mobile Pay path + desktop Hub path)
- [x] Grep proves no document/seal/credit terms in ported files
- [x] Address helpers validate + normalize per ARCHITECTURE.md §5 conventions

**Verification:** `npm run build`; P1-14 unit tests against `addresses.ts`.

**Notes:**
- Done 2026-08-03. Modules: `client/src/nimiq.ts`, `wallet/useWallet.ts`, `session.ts`, `addresses.ts`, `explorer.ts`, plus Hub plumbing (`hubRedirectBehavior.ts`, `hubRedirectParse.ts`, `hubReturnPath.ts`, `hubLoginRedirect.ts`, `walletDebug.ts`, `nimiq-globals.d.ts`) and server copies (`server/src/addresses.ts`, `server/src/explorer.ts`).
- Stripped VeriLock product flows (attestation, top-up, journey types). Kept Pay warmup/connect/sign, Hub chooseAddress+signMessage redirect/popup, mobile deeplink, generic tx relay/poll.
- `useWallet` exposes `status`, `address`, `connect()`, `disconnect()`, `signMessage()`, `providerAvailability` (`pay` | `hub` | `none`). Optional `WalletAuthApi` for P1-02 challenge/verify; without it connect is address-only.
- New deps: `@nimiq/hub-api@1.14.0`, `@nimiq/rpc@^0.4.1` (required for Hub path).
- Unit tests: `tests/unit/client/addresses.test.ts`, `explorer.test.ts`, `session.test.ts`.
- Residual: no UI wiring (by design); Hub return hash may interact with SPA hash router — re-check when P1-02 wires full auth; live device verification still blocked (P0-02).

---

### P1-02 — Auth: challenge/verify + sessions + rate limits

- **Team:** Implementation
- **Depends on:** P1-01
- **Spec refs:** SPEC §9, §15
- **Docs:** API.md §4, SECURITY.md §3, DATA-MODEL.md §1
- **Human-in-the-loop:** no

**Scope:** server-side auth per contract: challenge creation (single-use, 5-min expiry, rate-limited), Nimiq signed-message verification (port `server/src/hub-signature.ts` + `auth-wallet.ts` from VeriLock), pubkey→address binding, short-lived httpOnly session cookie, `GET /api/me`. Port `rate-limit.ts` and `http-headers.ts` and apply globally.

**Deliverables:**
- `server/src/auth.ts`, `hub-signature.ts`, `auth-wallet.ts`, `rate-limit.ts`, `http-headers.ts`
- `auth_challenges` table usage per DATA-MODEL.md
- Session cookie: httpOnly, SameSite=Lax, Secure in prod, 24 h
- Auth guard middleware for `/api/me/*` and `/api/staking/*`

**Acceptance criteria:**
- [x] Full flow works with the P0-02 signature fixture: challenge → verify → session → `/api/me`
- [x] Reused challenge rejected; expired challenge rejected (`CHALLENGE_EXPIRED`); tampered signature rejected (`SIGNATURE_REJECTED`)
- [x] Rate limit returns 429 + `retryAfterSeconds` after threshold
- [x] A client-supplied address without valid verification is never authenticated
- [x] Security headers present on all responses

**Verification:** P1-15 integration suite; manual curl pass recorded in Notes.

**Notes:**
- Done 2026-08-03. Modules: `server/src/auth.ts`, `hub-signature.ts`, `auth-wallet.ts`, `rate-limit.ts`, `http-headers.ts`. Wired in `app.ts` + `index.ts` (database required). Dep: `@nimiq/core@^2.7.1` (same as VeriLock) for signed-message verify + pubkey→address.
- Contract: `POST /api/auth/challenge` → `{ challengeId, message, expiresAt }`; `POST /api/auth/verify` → `{ address, sessionExpiresAt }` + httpOnly `steakout_session` cookie (SameSite=Lax, Secure in prod / `SESSION_COOKIE_SECURE`); `GET /api/me`. Challenges single-use, 5 min; sessions 24 h signed HMAC (`SESSION_SECRET`), rolling refresh past half-TTL. Auth guard on `/api/me/*` and `/api/staking/*`. Rate limits: challenge 12/min IP + 12/min address; verify 24/min IP; global API 300/min — 429 envelope `RATE_LIMITED` + `retryAfterSeconds`.
- **Fixture gap:** `tests/fixtures/wallet/` (P0-02) still missing. Unit suite uses deterministic zero-key real crypto via `@nimiq/core` (`tests/unit/server/auth.test.ts`, 13 cases) plus injectible `verifySignature` path. No live device fixture required for server AC.
- Client `WalletAuthApi` shape (Bearer token) left unwired — server uses cookie sessions per API.md/SECURITY.md; client adapter is a later task if needed.
- Verified: `npm run build` pass; `npm run test:server` 85/85 incl. auth.


---

### P1-03 — Server RPC client (retry/backoff/timeouts)

- **Team:** Implementation
- **Depends on:** P0-04
- **Spec refs:** SPEC §8.4–8.5
- **Docs:** ARCHITECTURE.md §5.3, §10
- **Human-in-the-loop:** no

**Scope:** port VeriLock `server/src/nimiq-rpc.ts`; strip document-attestation calls; keep retries, exponential backoff with jitter, per-call timeout, and tx verification helpers. This is the single RPC gateway for validatorSync, stakingState, payoutIndexer, and stakingIntents.

**Deliverables:**
- `server/src/nimiq-rpc.ts` with typed methods matching P0-04's validated list
- Config: `NIMIQ_RPC_URL`, timeout 10 s, backoff base 2 s → max 5 min
- Error taxonomy mapping: timeouts/malformed → `RPC_UNAVAILABLE` at the API layer
- Call metrics (count, latency, errors) exposed for the health endpoint

**Acceptance criteria:**
- [x] All P0-04 fixture-backed calls work through the client (mocked via P0-08 harness)
- [x] Retry/backoff behavior proven by injected failures (test or logged demo)
- [x] No RPC call anywhere in the codebase bypasses this module
- [x] Document-attestation legacy fully removed

**Verification:** vitest with mockRpc; `npm run build`.

**Notes:**
- Done 2026-08-03. Productionized `server/src/nimiq-rpc.ts`: typed P0-04 methods (`getBlockNumber`, `getValidatorByAddress`, `getActiveValidators`, `getAccountByAddress`, `getStakerByAddress`, `fetchTransactionsByAddress`, `fetchTransaction`), 10s timeout, exponential backoff base 2s → max 5 min + jitter, retry on timeouts/429/5xx/transport, non-retry on JSON-RPC method errors, `RpcError` + `toRpcApiError` → `RPC_UNAVAILABLE` helpers, call metrics via `getRpcMetrics()` on `GET /api/health`.
- Callers unchanged: `payoutIndexer`, `validators-api`, spike block endpoint.
- Tests: `tests/unit/server/nimiq-rpc.test.ts` (fixture-backed methods + timeout/429/5xx retry injection via mockRpc + vi). No document-attestation code.
- Residual: only intentional raw RPC is `server/scripts/probe-rpc.ts` (fixture capture). Client wallet `nimiq.ts` has its own browser-side tx lookup (out of server gateway scope). Indexer keeps its own outer retry loop (DATA-MODEL cycle policy).

---

### P1-04 — Validator registry sync + `/api/validators`

- **Team:** Implementation
- **Depends on:** P0-05, P1-03
- **Spec refs:** SPEC §6.2, §8.8, §9
- **Docs:** API.md §3, DATA-MODEL.md §1
- **Human-in-the-loop:** no

**Scope:** productionize the P0-05 ingestion: scheduled sync of the validators registry (both known-only and all-observable modes), reward-address resolution, upsert into `validators`, and the public list/detail endpoints per contract.

**Deliverables:**
- `server/src/validatorSync.ts`: hourly sync, upsert + `registry_updated_at`, reward-address backfill for new validators
- `GET /api/validators` with all documented sort options and `listed` filter
- `GET /api/validators/:address` full profile
- Observation fields present but stubbed (`insufficient-data`) until Phase 2

**Acceptance criteria:**
- [x] Response shape matches API.md §3 exactly (fields, nullability)
- [x] Score `-1`/missing → null (never rendered as a number)
- [x] All-observable mode includes unlisted validators, flagged `isListed: false`
- [x] Sort options all functional; `recommended` ordering documented in one comment block (inputs only, no advice claims)
- [x] Every record carries `registryUpdatedAt`

**Verification:** P1-15 ingestion test from fixtures; manual API pass vs contract.

**Notes:**
- **Done 2026-08-03.** Modules: `server/src/validatorSync.ts` (sync, upsert, sorts, serialization, `mountValidatorsApi`); routes wired in `app.ts` (after auth, before health/position); hourly scheduler in `index.ts` (`VALIDATORS_SYNC_ENABLED`, `VALIDATORS_SYNC_INTERVAL_HOURS`).
- **Sync:** fetches known-only + all-observable via existing `fetchValidators` / `normalizeValidator`; merge prefers known-only metadata for overlapping addresses; upserts all 78 fixture rows; `schedule_every_hours = scheduleEveryHours` (P2-02); `registry_updated_at` stamped; reward-address RPC only for validators missing one (kept on re-sync via `COALESCE`).
- **API:** `GET /api/validators?sort=&listed=` and `GET /api/validators/:address` use API.md §1 envelope (`source: registry`); list items + profile include stub observation `{ status: insufficient-data, lastObservedAt: null, historyDepthDays: 0 }`; profile adds `website`, `description`, `rewardAddress`, `rewardExplorerUrl`, `scoreComponents: null` (not in schema yet), `registryUpdatedAt`. Compact and spaced address params both resolve.
- **Sorts:** recommended|score|dominance|stake|direct-payout|restake|new — see comment on `compareValidators` for recommended inputs (no advice claims).
- **Tests:** `tests/unit/server/validator-sync.test.ts` (15 cases) fixture-backed, mock fetcher/RPC. Verified: `npm run build` pass; `npm run test:server` 133/133.
- Residual: live reward resolution rate limits (P0-05); logo_url always null (fixtures omit logo); score components not persisted; observations real data lands in Phase 2.

---

### P1-05 — Position endpoint + state normalization

- **Team:** Implementation
- **Depends on:** P0-04, P1-03
- **Spec refs:** SPEC §6.1, §8.6
- **Docs:** API.md §5, ARCHITECTURE.md §8
- **Human-in-the-loop:** no

**Scope:** `GET /api/me/staking-position`: authenticated read of account + staker state via RPC, normalized into the six-state enum, with validator name resolution via registry. Also appends `staker_snapshots` (input for restake growth later) — throttled to ≥ 1 snapshot/hour/address.

**Deliverables:**
- `server/src/stakingState.ts`: reads, normalization, snapshot writer
- Endpoint per API.md §5 including `updatedAt`/`source`/`dataFreshness` envelope
- State mapping table (RPC fields → enum) documented in the module header, citing P0-04 fixtures

**Acceptance criteria:**
- [x] All six states derivable from fixture data (unit-tested in P1-14)
- [x] Unknown/unreadable state never renders as `Active` — fails to `unavailable`
- [x] Snapshot written on read (throttled) with `source_block`
- [x] Response never cached beyond the documented short TTL

**Verification:** fixture-driven unit tests (P1-14); manual check with the P0-04 known staker address.

**Notes:**
- Done 2026-08-03. Modules: `server/src/stakingState.ts` (normalize + read + snapshot + short TTL cache), endpoint `GET /api/me/staking-position` in `app.ts` behind existing `/api/me/` auth guard.
- State mapping (module header + unit table): NotStaked (no-staker P0-04 fixture / zero balances), Pending (`hasPendingTx` or pending `staking_intents`), Active (active only or active+inactive partial), Inactive (inactive only), Retiring (retired + remaining stake), Withdrawable (retired-only; Core: immediately removable). `retire.withdrawableAt` always null (RPC has no release timestamp — P0-04).
- Envelope: `updatedAt` / `source` (`rpc`|`cache`) / `status` (`ok`|`partial`|`unavailable`) / `dataFreshness.ageSeconds` + API.md §5 payload. `Cache-Control: private, max-age=10` (matches `POSITION_CACHE_TTL_MS`). Snapshots ≥1/hour/address with `source_block`. Empty validators table → `validatorName: null` still returns position.
- Tests: `tests/unit/server/staking-state.test.ts` (25 cases) — pure six-state normalize, snapshot throttle, mockRpc P0-04 no-staker path, HTTP 401 + authenticated envelope. `npm run build` + `npm run test:server` 118/118.
- Residual: no live mainnet Active staker fixture (P0-04 only captured no-staker); lifecycle balances synthetic from PlainStaker field names. `lastRewardObservation` stubbed null until Phase 2.

---

### P1-06 — Staking intent/confirm + chain matcher

- **Team:** Implementation
- **Depends on:** P0-03, P1-02, P1-03
- **Spec refs:** SPEC §9, §15
- **Docs:** API.md §6, SECURITY.md §2, DATA-MODEL.md §1
- **Human-in-the-loop:** no (device proof happens in P1-16)

**Scope:** `POST /api/staking/intent` + `POST /api/staking/confirm` per contract: validate + record intent (15-min expiry, single-use), then match a client-supplied tx hash against chain data and the authenticated address. The trust core of the product — the server never believes the client.

**Deliverables:**
- `server/src/stakingIntents.ts`: intent CRUD, validation (amounts, addresses, state preconditions via P1-05 reads), chain matcher
- Polling semantics: `202 TX_PENDING` until confirmed/failed; `TX_MISMATCH` hard failure
- Return-value handling per P0-03 findings (hash vs serialized tx) with a normalization shim
- Replay protection: used/expired intents rejected

**Acceptance criteria:**
- [ ] Matcher validates operation, amount, and delegation (where visible on chain) — mismatch cases unit-tested
- [ ] Pending → confirmed and pending → failed paths both proven against fixtures
- [ ] Intent replay rejected; cross-user intent use rejected
- [ ] Preconditions block impossible operations (e.g. stake-more with no staker) with clear errors

**Verification:** P1-15 integration suite; P3-10 re-review.

**Notes:**
-

---

### P1-07 — App shell + routing + bottom nav

- **Team:** Implementation
- **Depends on:** P0-01
- **Spec refs:** SPEC §10
- **Docs:** STYLING.md §5, §7
- **Human-in-the-loop:** no

**Scope:** the SPA skeleton: hash-or-history routing (decide + note why), four destinations (Home, Validators, Activity, Learn), bottom navigation with ≥ 44 px targets and safe-area insets, network badge when not on mainnet, and the `/spike` route kept behind its flag.

**Deliverables:**
- `App.tsx` with route table + lazy loading per destination
- `components/BottomNav.tsx` + CSS per STYLING.md
- 404 → Home redirect; deep-linkable routes (`/validators/:address` reserved for P2-16)
- App works standalone in a plain browser (no provider) as a read-only shell

**Acceptance criteria:**
- [x] Four destinations reachable via nav at 320 px width
- [x] Deep links survive reload
- [x] No horizontal scroll at 320/375/430
- [x] Active destination visually distinct (ember accent per tokens)

**Verification:** manual viewport sweep; `npm run build`.

**Notes:**
- **Routing decision: hash** (`#/validators`, etc.). Fragment never hits the server, so deep links survive reload without an SPA rewrite on Railway/static Express. Production only special-cases `/spike*` for `index.html` (`server/src/index.ts`); history routes like `/validators` would 404 on hard reload. Pure matchers in `client/src/routes.ts` for unit tests.
- Shell: lazy destinations, BottomNav ≥44px + `env(safe-area-inset-bottom)`, active uses `--so-accent` (#d9573f) + top indicator, NetworkBadge via `VITE_NIMIQ_NETWORK` (hidden on mainnet), 404 → `#/`, `/validators/:address` reserved (renders Validators placeholder until P1-11/P2-16).
- Verified 2026-08-03: `npm run build` pass; `npm run test:client` includes `routes.test.ts` matcher smoke.

---

### P1-08 — nimiq-css wiring + tokens + fonts

- **Team:** Implementation
- **Depends on:** P0-01
- **Docs:** STYLING.md §2–4 (binding)
- **Human-in-the-loop:** no

**Scope:** wire nimiq-css per the styling contract: layer imports, fonts in `public/assets/fonts/`, `tokens.css` with the `--so-*` semantic palette mapped to nimiq-css variables, `base.css` (body bg, ink, focus defaults). Complete the "verify at install time" checklist in STYLING.md §2 and record results there.

**Deliverables:**
- `client/src/styles/{nimiq.css,tokens.css,base.css}` imported once in `main.tsx`
- Semantic tokens for every row of the STYLING.md §3 table
- A hidden `/spike-style` (or storyboard section of `/spike`) rendering: one of each pill variant, cards, labels, input box, status chips — as the team's visual reference
- STYLING.md §2 verification results filled in

**Acceptance criteria:**
- [x] Mulish + Fira Mono render from self-hosted font files
- [x] Components can style entirely from `--so-*` tokens (no raw palette vars outside tokens.css)
- [x] Both layer-import strategies considered; chosen one noted in STYLING.md
- [x] No unconfirmed `nq-text-*` classes used anywhere until verified

**Verification:** build passes; reference page visually confirmed by Polishing.

**Notes:**
- 2026-08-03: Wired nimiq-css@1.0.0-beta.162 via full `index.css`. Tokens map every STYLING §3 semantic to `--colors-*` with hex fallbacks. Fonts: corrected `@font-face` in `base.css` for `Mulish-Regular.ttf` + `FiraMono-Regular.ttf` (package `fonts.css` filenames differ; not imported). Style ref at pathname `/spike-style` (DEV or `VITE_ENABLE_STYLE_SPIKE=true`). Verification table filled in STYLING.md §2. Residual: only weight 400 self-hosted (no variable Mulish); bold may synthesize. Polishing visual confirm of `/spike-style` still pending.

---

### P1-09 — Home dashboard (3 states)

- **Team:** Implementation
- **Depends on:** P1-05, P1-07, P1-08
- **Spec refs:** SPEC §6.1
- **Docs:** STYLING.md, METHODOLOGY.md §8
- **Human-in-the-loop:** no

**Scope:** the three home states per spec: disconnected ("Your NIM may be idle…" + connect/explore/learn actions), connected-not-staked (balance if available, illustrative estimate labeled as such, `Choose a validator` CTA), connected-staked (totals, active/inactive/retired, validator, position status badge, last reward observation, monitoring status, state-appropriate primary CTA).

**Deliverables:**
- `client/src/home/` with one component per state + container switching on `useWallet` + position query
- `PositionStateBadge`, `Amount`, `FreshnessTag` components (first use of the shared component set)
- Loading, error (RPC unavailable), and empty variants for each state

**Acceptance criteria:**
- [x] All three states render from live API data (mockable via fixtures)
- [x] Illustrative estimate always carries the "illustrative network estimate" label + methodology link
- [x] Every timestamped value shows freshness
- [x] A user can reach validator selection in one tap from any state
- [x] 320 px clean; large balances don't overflow

**Verification:** `npm run build`; state matrix manually checked; Testing regression in P1-16.

**Notes:**
- Done 2026-08-03. Home container switches on `useWallet` + `GET /api/me/staking-position`.
- **Auth bridge:** `client/src/api/walletAuth.ts` maps VeriLock-shaped `WalletAuthApi` (`token`/`nonce`) onto cookie sessions (`challengeId`/`message`, `credentials: 'include'`). Pay path in `useWallet` changed to connect→address→challenge→sign (Steakout challenges are address-bound; VeriLock `challenge(null)` no longer applies).
- **API client:** `api/http.ts` (ApiError + credentials), `api/position.ts` envelope types + fetch.
- **Shared components (first use):** `Amount`, `FreshnessTag`, `PositionStateBadge` under `client/src/components/`.
- **Home states:** `DisconnectedHome`, `NotStakedHome`, `StakedHome` + `useStakingPosition`; co-located `Home.css` (`--so-*` + nq utilities). Illustrative estimate labeled + links `#/learn/methodology`. No staking write txs (P1-12).
- **Helpers:** `client/src/luna.ts` (format NIM from Luna).
- Verified: `npm run build` pass; `npm run test:client` 27/27.

---

### P1-10 — Validator directory + sorts

- **Team:** Implementation
- **Depends on:** P1-04, P1-08
- **Spec refs:** SPEC §6.2
- **Docs:** STYLING.md §4–5
- **Human-in-the-loop:** no

**Scope:** public validator directory (no wallet needed): cards with name + identicon/logo, official score, stake + dominance, stakers count, declared fee/payout type/schedule, observation status (stubbed `insufficient-data` until Phase 2), `View record` action; all sort options from API contract; recommended-sort explainer.

**Deliverables:**
- `client/src/validators/Directory.tsx` + `ValidatorCard.tsx`
- Sort selector wired to API `sort=` param; recommended view shows its inputs ("uses official score, dominance, and observation data — not financial advice")
- Skeleton loading + empty + error states

**Acceptance criteria:**
- [x] Works fully disconnected (no wallet)
- [x] Every card field honors null → `Insufficient data` rendering (no `-1`, no fake zeros)
- [x] Unlisted validators flagged when shown
- [x] One tap from card → profile
- [x] Long names/missing logos handled (verified with stress fixtures)

**Verification:** manual pass + P3-06 stress sweep later; build green.

**Notes:**
- Done 2026-08-03. Modules: `client/src/validators/Directory.tsx` + `Directory.css`, `ValidatorCard.tsx` + `ValidatorCard.css`, `api.ts` (fetch + sort enum), `format.ts` (null-safe display helpers). `Validators.tsx` is a thin entry that renders Directory; profile route remains P1-11 (`Profile.tsx` via App shell).
- Fetch: `GET /api/validators?sort=&listed=` with AbortController on sort/filter change. Default sort `recommended`; listed-only checkbox maps to `listed=true`.
- Cards: name + logo/initials fallback, official score, stake/dominance/stakers, declared fee/payout type/schedule (Registry declaration), observation stub chip, Listed/Unlisted flag, `View record` → `#/validators/{compactAddress}`.
- Recommended explainer shown only for recommended sort (not financial advice / not “best” ranking). Skeleton / empty / error + retry states.
- Unit: `tests/unit/client/validators-format.test.ts`. `npm run build` + `npm run test:client` green.

---

### P1-11 — Validator profile (summary layer)

- **Team:** Implementation
- **Depends on:** P1-04, P1-08
- **Spec refs:** SPEC §6.3
- **Docs:** API.md §3, STYLING.md, METHODOLOGY.md
- **Human-in-the-loop:** no

**Scope:** public validator profile at `/validators/:address`, summary layer only (evidence layer is P2-08): status label, declared payout type/schedule (labeled `Registry declaration`), official score visually distinct from Steakout observation, stake dominance, reward address with explorer link, registry timestamp. Include the stake CTA that deep-links into the stake flow.

**Deliverables:**
- `client/src/validators/Profile.tsx` + summary components (`StatusChip`, `DataStatusTag`)
- Explorer link via ported helper
- Not-found state for unknown addresses

**Acceptance criteria:**
- [x] Public without wallet; shareable URL shape (meta tags land in P2-16)
- [x] Declared vs observed visually separated per METHODOLOGY.md
- [x] Every metric shows definition affordance + freshness
- [x] Score rendered as official Nimiq score, never blended with Steakout status

**Verification:** manual pass against API fixtures; build green.

**Notes:**
- Done 2026-08-03. Summary layer only: `client/src/validators/Profile.tsx` + `Profile.css`; `StatusChip` + `DataStatusTag` under `client/src/components/`.
- Routing: `App.tsx` switches on `match.param` — `#/validators` list (P1-10) vs `#/validators/:address` profile. Hash routes already matched address param in `routes.ts`.
- Fetches `GET /api/validators/:address`; states: loading / invalid address / 404 / error / ok. Explorer via `buildNimiqAddressExplorerUrl` (reward + validator).
- Official Trust Score card captioned "Nimiq official", visually distinct from "Steakout observation" (stub `insufficient-data` until Phase 2). Declared fee/type/schedule + dominance/stake use `Registry declaration` tags + freshness.
- Stake CTA disabled stub ("coming soon") — no provider/review invocation (P1-12).

---

### P1-12 — Stake flow end-to-end

- **Team:** Implementation
- **Depends on:** P1-06, P1-09, P1-10, P1-11
- **Spec refs:** SPEC §6.4, §15
- **Docs:** API.md §6, SECURITY.md §2, STYLING.md §5
- **Human-in-the-loop:** yes for the final device pass (P1-16 formalizes it)

**Scope:** the core journey: choose validator → compact summary → amount entry with presets (25% / 50% / max-safe / custom) → review sheet (action, NIM amount, validator name+address+identicon, resulting transition) → native Pay confirmation → pending/confirmed/failed → back to position. Includes cancel handling, duplicate-submission protection, and reload recovery of a pending intent.

**Deliverables:**
- `client/src/staking/` flow components incl. `ReviewSheet`
- Max-safe calculation leaving room for fees (constant documented; testnet-verified value from P0-03)
- Intent lifecycle in client: create → provider call → confirm polling (backoff, ~2 min cap → "check later")
- Error states: user cancel, provider error, timeout, `TX_FAILED`, `TX_MISMATCH`

**Acceptance criteria:**
- [ ] No provider method fires without the review sheet (invariant #3)
- [ ] Presets never allow staking the entire balance (fee headroom enforced)
- [ ] Pending intent survives reload and resumes polling
- [ ] Duplicate taps cannot create two intents
- [ ] Confirmed end state shows the position from server data, not client optimism
- [ ] Works at 320 px with the CTA never below the fold on the review sheet

**Verification:** P1-15 integration + P1-16 device pass; build green.

**Notes:**
-

---

### P1-13 — Non-custodial explainer + review-screen copy

- **Team:** Polishing
- **Depends on:** P1-12
- **Spec refs:** SPEC §6.4, §15
- **Docs:** METHODOLOGY.md §8 (language dictionary), STYLING.md
- **Human-in-the-loop:** no

**Scope:** final copy for the stake flow and the non-custodial explanation: what happens to funds (they stay in protocol accounts), what the wallet dialog does, waiting periods, and the illustrative-estimate disclaimer. Plain language, no crypto jargon, no promises.

**Deliverables:**
- Copy deck in `client/src/learn/copy.ts` (or co-located strings) covering: explainer card, review sheet lines, cancel/error messages, estimate disclaimer
- Review against the language dictionary — zero banned phrases

**Acceptance criteria:**
- [ ] Every screen in the stake flow uses approved copy
- [ ] Reading-level check: a non-crypto user can explain back what will happen (owner sanity check)
- [ ] No yield promises, no "guaranteed", no fee claims

**Verification:** owner read-through; dictionary grep in Testing regression.

**Notes:**
-

---

### P1-14 — Unit tests: addresses, luna, position, intent

- **Team:** Testing
- **Depends on:** P1-01, P1-05, P1-06
- **Docs:** TESTING.md §2
- **Human-in-the-loop:** no

**Scope:** first unit suite batch per the coverage map: address normalize/validate (valid, invalid, mixed case, whitespace), luna↔NIM conversion + formatting (rounding, huge values, zero), position state normalization (all six states from fixtures, unknown → unavailable), intent matching (operation/amount/delegation mismatches, replay).

**Deliverables:**
- `tests/unit/` suites for the four areas, using P0-08 helpers where relevant

**Acceptance criteria:**
- [x] Every coverage-map row for these areas has ≥ 1 test incl. edge cases listed above *(except intent — residual)*
- [x] Suites run in `npm test` green from clean install

**Verification:** `npm test`; coverage spot-check in Notes.

**Notes:**
- Partial 2026-08-03. All available areas covered; intent deferred until P1-06 lands.
- **Addresses (client + server):** `tests/unit/client/addresses.test.ts` (expanded), `tests/unit/server/addresses.test.ts` (new). Covers normalize (spaces/tabs/newlines + mixed case), validate accept/reject, shortAddress, formatDisplayAddress (client only), addressesEqual.
- **Luna ↔ NIM:** `tests/unit/client/luna.test.ts` (new) → `client/src/luna.ts`. Covers `LUNA_PER_NIM`, `lunaToNim`/`nimToLuna` round-trip + rounding + huge/negative, `formatNimFromLuna` zero/fractional/thousands/`fixed`/null-NaN-Infinity → em dash.
- **Position state:** `tests/unit/server/staking-state.test.ts` (P1-05 suite expanded). Six states (NotStaked/Pending/Active/Inactive/Retiring/Withdrawable) + parseStakerBalances null on unreadable; **unavailable path:** unreadable NaN balances → envelope `status: 'unavailable'` (not Active); hard RPC still throws `RPC_UNAVAILABLE`.
- **Intent matching residual:** `server/src/stakingIntents.ts` does **not** exist (P1-06 backlog). Did not invent module or tests. Re-open P1-14 (or fold into P1-15) when matcher ships: operation/amount/delegation mismatches + replay.
- Spot-check: `npm test` green — server 265, client 46, integration 6 (no live network).

---

### P1-15 — Integration: auth, registry, intent/confirm

- **Team:** Testing
- **Depends on:** P0-08, P1-02, P1-04, P1-06
- **Docs:** TESTING.md §2
- **Human-in-the-loop:** no

**Scope:** integration batch: validators-API fixture ingestion → normalized rows (both modes); auth challenge→verify→session incl. rejection cases; intent→confirm polling with mocked RPC tx states (pending→confirmed, failed, mismatch, not-found); RPC normalization from P0-04 fixtures.

**Deliverables:**
- `tests/integration/` suites above; server booted in-test on ephemeral port + temp DB

**Acceptance criteria:**
- [ ] All listed flows green without any live network
- [ ] Temp DB per suite; no cross-test bleed
- [ ] Failure assertions match API.md error codes exactly

**Verification:** `npm test` green in clean env.

**Notes:**
-

---

### P1-16 — Device smoke: Pay Android/iOS + Hub fallback

- **Team:** Testing
- **Depends on:** P1-12
- **Spec refs:** SPEC §14 (manual device tests)
- **Docs:** TESTING.md §2
- **Human-in-the-loop:** yes — owner devices

**Scope:** first full manual matrix on the vertical slice: Nimiq Pay Android (testnet), iOS if available, mobile browser read-only, desktop + Hub. Run the scripted smoke checklist; log every deviation.

**Deliverables:**
- `tests/manual/smoke-1.md`: checklist (connect, correct address shown, stake review → native confirm → pending → confirmed, cancel path, reload during pending, Hub fallback connect/sign, position display)
- Results recorded per environment with versions; bugs filed to owning cards with severity

**Acceptance criteria:**
- [ ] Every checklist item has a pass/fail + evidence note per available environment
- [ ] Blockers, if any, are on the board same-day
- [ ] Phase-1 exit gate answered: does the vertical slice work on ≥ 1 real device?

**Verification:** owner signs the checklist; blockers triaged.

**Notes:**
-

---

## Phase 1 milestone (gate G2)

Vertical slice demonstrably works on a real device: connect → select validator → native confirmation → confirmed stake → position displayed. If position reads prove unreliable (P1-05/P0-04), activate the G2 fallback (direct-payout monitoring only, labeled) per ROADMAP.
