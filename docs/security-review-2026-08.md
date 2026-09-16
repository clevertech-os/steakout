# Steakout security review

Review run: 2026-09-15 (release-readiness rerun; task P3-10)
Environment: Node 22.23.2, production build, local disposable SQLite, no live wallet or chain writes.

## Checklist

| Area | Result | Evidence |
|---|---|---|
| Auth challenge expiry and single-use | PASS | `tests/unit/server/auth.test.ts`: expiry, replay, tampered signature, and client-address-only rejection; `tests/integration/auth-registry-intent.test.ts` covers the signed flow. Challenges are checked before verification and consumed with an atomic `used_at IS NULL` update. |
| Signature/public-key binding | PASS | Auth calls Hub-style signature verification and derives/binds the Nimiq address from the submitted public key. Existing unit and integration suites pass. |
| Session expiry and cookie flags | PASS | `auth.ts` verifies HMAC, address shape, and expiry; refreshes at half-life. Cookie is `HttpOnly; SameSite=Lax`, with `Secure` in production. Existing auth tests assert the non-secure flags; production `NODE_ENV` path is code-reviewed but still needs a deployed HTTPS check. |
| Rate limits | PASS | Auth and staking limits stack on the global API limit; 429 includes `Retry-After` and `retryAfterSeconds`. `security-hardening.test.ts` proves rotating spoofed `X-Forwarded-For` values cannot rotate the key. The limiter now uses Express `req.ip`, which only trusts forwarding when the deployment explicitly enables proxy trust. |
| Input validation / error envelopes | PASS | Address, operation, Luna integer/range, cursor, and transaction-reference validation are covered by unit/integration tests. Route handlers map expected failures to stable JSON errors; no route returns an exception stack in the tested paths. |
| Transaction matching / replay | PASS | `tests/unit/server/staking-intents.test.ts` covers amount/from/delegation mismatches, failed execution, pending lookup, expiry, cross-user access, replay, and successful confirmation. Confirmation reads the chain and never trusts a client success claim. |
| Production headers / CSP | PASS | `npm run build` succeeds. `security-hardening.test.ts` verifies production CORS behavior and CSP. SPA headers include `nosniff`, strict referrer policy, same-origin scripts, constrained Hub/RPC/registry connections, `object-src 'none'`, and `base-uri 'self'`. |
| Production CORS | PASS | With production mode and no `CORS_ORIGIN`, arbitrary origins receive no `Access-Control-Allow-Origin`; same-origin traffic remains valid. Configured origins are filtered for empty entries. |
| Key-material sweep | PASS (with deterministic test/docs references) | `git grep` and recent-history scans found no actual key, seed, token, or PEM material. Matches are explanatory docs, ignored probe runbooks, and the all-zero deterministic test key used only for signature fixtures. No `.env`, SQLite, probe output, or private-key file is tracked. |
| SQLite statements / schema | PASS | Server data access uses `better-sqlite3` prepared statements. The only interpolated SQL identifiers are fixed internal table/column names in migrations and diagnostics, never request input. `openDatabase` enables WAL + foreign keys and enforces directory `0700` / database `0600`. |
| Dependency audit | PASS for production dependencies; residual dev-only advisory | `npm audit --omit=dev` reports 0 vulnerabilities after lockfile update (`nanoid` 3.3.19, `qs` 6.16.0). Full audit retains 2 moderate Vitest / `@vitest/mocker` advisories; the available fix is Vitest 5, a major upgrade. Vitest is dev-only and not shipped in the production image. Upgrade before exposing test tooling to untrusted inputs. |

## Findings and disposition

### Fixed in this review

- **Major, fixed:** production CORS reflected arbitrary origins when `CORS_ORIGIN` was unset. Production now disables cross-origin reflection; an explicit allowlist remains supported.
- **Major, fixed:** the rate limiter trusted caller-supplied `X-Forwarded-For`. It now uses Express `req.ip`; proxy trust must be configured deliberately by deployment infrastructure.
- **Major, fixed:** production served the `/spike` SPA and `/api/spike/block-number` route. Both are now development-only and return 404 in production.
- **Moderate, fixed:** SQLite confidentiality was not enforced at runtime. New and existing data files are set to `0600`, with the containing directory set to `0700`.
- **Moderate, fixed:** the production SPA had no CSP. A compatible CSP is now emitted with the required Nimiq hosts.

### Residual risks / owner action

- Production HTTPS, `Secure` cookies, reverse-proxy trust configuration, and real Nimiq Pay WebView behavior still require owner/device verification. This review does not claim those rows passed.
- The production dependency graph is clean, but the dev-only Vitest advisory remains until the planned major-version upgrade is assessed.
- SQLite permissions protect the app host filesystem; volume/backups and operator access still need infrastructure controls.
- This is a code-and-automated-test review, not an external penetration test.

## Commands

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build       # pass
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test            # 491 tests pass
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run smoke      # pass: SPA, health, profile, evidence, spike disabled
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm audit --omit=dev # 0 vulnerabilities
```
