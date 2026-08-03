# Security & Trust Requirements

Implements [SPEC.md §15](SPEC.md). Owned by everyone; reviewed by Team Testing in P3-10.

## 1. Non-custody (absolute)

- Steakout never receives, stores, or transmits private keys or seed phrases.
- All staking operations are requested through the Nimiq Pay provider and approved natively by the user's wallet.
- The client never constructs or signs staking transactions outside the provider.
- Server code must never accept key material — reject such payloads explicitly if they arrive.

## 2. Transaction safety

Before any provider transaction method is invoked, the UI shows a review screen with:

- action type in plain language
- amount in NIM (Luna only as secondary technical detail)
- validator name + address (with identicon)
- the resulting position state transition
- whether the operation has a protocol waiting period (retire/remove)

Server-side, confirmed transactions are matched against the **authenticated address + recorded intent** (operation, amount, delegation). `TX_MISMATCH` is a hard failure, surfaced neutrally. Intents expire (15 min) and are single-use.

## 3. Authentication

- Nimiq signed-message challenge → verify server-side (`hub-signature.ts` port).
- Verified public key is bound to the derived Nimiq address (`auth-wallet.ts` port); a client-supplied address alone is never identity.
- Challenges: single-use, 5-minute expiry, rate-limited per IP and per address.
- Sessions: short-lived (24 h) signed httpOnly cookie, `SameSite=Lax`, `Secure` in production. Rolling refresh on activity.
- `requestDeviceIdentifier()` is **not** an identity primitive (device-scoped); may only be used later for abuse throttling.

## 4. API hardening

- `helmet`-equivalent headers via ported `http-headers.ts` (CSP allowing the Nimiq Pay webview + Hub origins only).
- Rate limits: strict on `/api/auth/*` and `/api/staking/*`; moderate elsewhere. 429 includes `retryAfterSeconds`.
- Input validation on every body/param: address format, integer Luna amounts within safe range, enum operations.
- SQL: prepared statements only (`better-sqlite3` `.prepare()`), no string interpolation.
- No permissive CORS in production (same-origin SPA); dev proxy handles local development.

## 5. Privacy

Disclose in the app (Learn → Privacy):

- the wallet address is sent to the Steakout server to retrieve position and activity data;
- public chain activity may be associated with the user's Steakout session;
- analytics are aggregate and minimal (no name, email, or location in v1);
- product metrics (SPEC §16) are server-side counters and table counts only — exposed at `GET /api/metrics/public` without addresses; disclosed in Learn → Privacy.

Data stored: see [DATA-MODEL.md](DATA-MODEL.md) — no keys, no seeds, no unnecessary personal data. Challenges/intents expire and are cleaned up.

## 6. Defamation & financial-risk controls

- No claims of fraud, theft, or intent — anywhere, including error messages and empty states.
- No guaranteed yield/payout language; estimates are always "illustrative network estimate" with a methodology link.
- Raw observations + methodology are shown; validators get a factual contact channel to correct **registry declarations** — never observed history.
- Classifier changes bump `calc_version` (audit trail) and are noted on the limitations page.
- A visible **Limitations** page is part of v1 scope (P2-12).
- Neutral language per [METHODOLOGY.md §8](METHODOLOGY.md).

## 7. Secrets & repo hygiene

- No secrets, keys, or tokens in the repository — ever. Config via env vars; `.env.example` documents them.
- P4-01 includes an automated secrets sweep (`git log` + working tree scan) before submission.
- Dependencies: pinned where VeriLock pins; no new dependency without task-card approval.

## 8. Security review checklist (P3-10 owns)

- [ ] Auth: challenge expiry/single-use enforced; signature verification rejects tampering; session cookie flags correct.
- [ ] API: rate limits trigger; validation rejects malformed addresses/amounts; no stack traces in responses.
- [ ] Tx matching: mismatched hash/amount/delegation → `TX_MISMATCH`; replay of a used intent rejected.
- [ ] Headers/CSP verified in production build.
- [ ] No key material paths exist in client or server code (grep sweep).
- [ ] DB: prepared statements only; WAL mode; file permissions on `server/data/`.
- [ ] Dependencies: `npm audit` reviewed; no high-severity unpatched issues without a documented reason.
