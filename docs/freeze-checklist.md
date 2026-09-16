# Reliability freeze checklist

Run: 2026-09-15 automated portion (P4-01)

This checklist separates repeatable local evidence from owner-only production
and device checks. “Pending owner” is intentional and is not a pass.

| Check | Result | Evidence / owner action |
|---|---|---|
| Clean production client build | PASS | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build` passed. |
| Production spike/dev routes unreachable | PASS | `npm run smoke` returned 404 for `/api/spike/block-number`; production server only mounts `/spike*` when `NODE_ENV` is not `production`. |
| No test keys or secrets in shipped tree/history | PASS | Tracked-file and recent-history scans found no actual credentials or PEM material. Deterministic all-zero test key references are confined to test fixtures/docs. |
| Environment variables accounted for | Pending owner | `.env.example` documents server/client variables. Owner must verify production values for `SESSION_SECRET`, `NIMIQ_NETWORK`, RPC endpoints, `DATA_DIR`, `CORS_ORIGIN`, registry sync/indexer settings, and public origins against deployment configuration. |
| Session secret is strong and production-only | Pending owner | Production code rejects a missing `SESSION_SECRET`; owner must confirm a long random secret is set and never reused from local/test values. |
| HTTPS + secure cookie | Pending owner | Code emits `Secure` when `NODE_ENV=production`; owner must verify deployed HTTPS response and cookie attributes. |
| Same-origin CORS policy | PASS in code/local test | Production with unset `CORS_ORIGIN` does not reflect arbitrary origins; explicit allowlist remains supported. Verify final public origin after deployment. |
| Security headers / CSP | PASS | Helmet API headers plus SPA `nosniff`, referrer policy, CSP, object/base restrictions; asserted by `security-hardening.test.ts`. |
| API health | PASS locally / Pending production | Local smoke health is HTTP 200 and reports API + degraded chain state. Owner must run against the production URL and require configured RPC availability/indexer status. |
| SQLite WAL + permissions | PASS locally | Runtime check reports `journal_mode=wal`, `foreign_keys=1`, directory `0700`, database `0600`. Owner must verify mounted volume and backup permissions. |
| Indexer cursor continuity across restart | PASS in fixtures / Pending production | `payout-indexer.test.ts` and `indexer-evidence.test.ts` prove reopen/resume behavior. Owner must capture production cursor continuity after a restart/redeploy. |
| Smoke surface | PASS local / Pending production | `npm run smoke` covers SPA, health, public validator list/profile, evidence, and disabled spike API. Run with `SMOKE_BASE_URL=https://<production-origin>` and `SMOKE_VALIDATOR_ADDRESS=<known-profile>` after deployment. |

## Freeze decision

The automated freeze checks are green. P4-01 remains `in-progress` until the
owner records production env, HTTPS/cookie, live RPC/indexer persistence, and
production smoke evidence. Device-only verification remains tracked in P1-16,
P3-11, and P4-03.
