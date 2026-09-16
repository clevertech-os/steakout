# Steakout final QA sweep

Run: 2026-09-15 automated portion (Node 22.23.2)

This is the SPEC §13 master checklist. Automated rows have test/smoke evidence;
device and production rows remain pending owner verification.

## Wallet and staking

| SPEC item | Result | Evidence |
|---|---|---|
| App opens inside Nimiq Pay | Pending device | P1-16 / real Pay session required. |
| Wallet connection succeeds on a clean session | Pending device | P1-16. |
| Correct Nimiq address is shown | Pending device | P1-16; address helpers are unit-tested. |
| Signed challenge verifies server-side | PASS automated | Auth unit + integration suites. |
| Create-staker transaction can be requested | Pending device | Intent/review/provider path is implemented; Pay provider evidence is still pending. |
| Native confirmation clearly identifies action | Pending device | ReviewSheet code path exists; native dialog requires Pay. |
| Successful transaction confirmed from chain data | PASS automated / Pending device | Matcher tests pass; real provider return semantics still require device evidence. |
| Rejected transaction returns to useful state | Pending device | Provider rejection requires Pay. |
| Pending transaction survives reload | PASS automated / Pending device | Client pending-intent tests and server pending matcher pass; reload on Pay needs device. |
| Current position state is visible | PASS automated | Position state unit/integration tests; production UI device check pending. |
| At least one additional lifecycle action works reliably | PASS automated / Pending device | Change/retire/remove logic and tests pass; Pay execution pending. |
| No private key or seed phrase requested | PASS | Source scan and auth payload rejection; no custody path. |

## Validator data

| SPEC item | Result | Evidence |
|---|---|---|
| Registry data has source timestamp | PASS automated | Validator sync/API tests. |
| Official score distinguished from observations | PASS automated | Profile/API tests and UI implementation. |
| Unknown/unlisted validators not silently omitted from summaries | PASS automated | Validator/network summary tests. |
| Missing score displayed as insufficient data | PASS automated | Normalization and formatting tests. |
| Reward address resolved from chain where possible | PASS automated / Pending production | Fixture sync tests; live registry/RPC freshness pending. |
| Declared schedule not treated as verified behavior | PASS automated | Schedule/adherence tests and methodology copy. |

## Accountability

| SPEC item | Result | Evidence |
|---|---|---|
| Direct payout transactions indexed | PASS automated | Payout indexer/integration fixtures. |
| Transactions deduplicated | PASS automated | Payout indexer unit/integration tests. |
| Index cursors recover after restart | PASS automated | Reopen/resume integration tests; production restart evidence pending. |
| Schedule grouping tested | PASS automated | 70 payout-classifier tests. |
| Recipient coverage tested | PASS automated | Observation-scoring tests. |
| Evidence links open correct transaction | PASS automated | Explorer/evidence integration tests; live click verification pending. |
| Data freshness visible | PASS automated | Freshness/observations tests and UI. |
| Insufficient history visible | PASS automated | Observation scoring/API tests. |
| Effective fee not displayed | PASS | Source/copy scan and methodology constraints. |
| No accusatory labels used | PASS | Neutral-language source/copy scan. |

## UX

| SPEC item | Result | Evidence |
|---|---|---|
| New user reaches validator selection in under 60 seconds | Pending device | Needs timed owner walkthrough. |
| Primary action obvious on every screen | Pending visual QA | Needs owner review at target mobile sizes. |
| App works at 320px width | Pending visual QA | P3-06 device/browser sweep required. |
| Large balances do not overflow | Pending visual QA | Content-stress sweep required. |
| Long names/missing logos handled | PASS automated / Pending visual QA | Formatting code/tests; owner visual sweep pending. |
| Loading, empty, error, offline states exist | PASS automated / Pending visual QA | P3-08 implementation; production visual sweep pending. |
| Native confirmations preceded by clear review | PASS code / Pending device | ReviewSheet precedes provider call in client; Pay walkthrough pending. |
| Public profiles work without wallet connection | PASS automated | `npm run smoke` profile check and public API tests. |

## Submission

| SPEC item | Result | Evidence |
|---|---|---|
| Public MIT repository | PASS | `LICENSE` present; owner to confirm final repository visibility. |
| No secrets committed | PASS automated | Working-tree/history scan; deterministic fixture key is all-zero test material. |
| Live demo URL | Pending owner | Production URL verification required. |
| README with setup and architecture | PASS draft | README refreshed to current implementation; owner review remains. |
| Demo video | Pending owner | Human asset. |
| Screenshots | Pending owner | Human asset / fresh production data. |
| Submission text within 250 words | PASS draft | Existing draft is 222 words; owner approval remains. |
| Build story/community updates published | Pending owner | Human outbound work. |

## Automated evidence

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build  # pass
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test       # 491 tests pass
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run smoke # pass: SPA, health, list, profile, evidence, spike 404
```

P4-03 remains open: no device-only or production-only row is marked complete
by this automated pass. The owner should attach production URL, Pay/Hub device,
mobile-width, and live evidence-link observations before signing QA.
