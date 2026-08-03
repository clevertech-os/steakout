# P0-03 Staking-Method Spike

**Status:** Harness + package evidence + hash-derivation path prepared. **Device-dependent observations unresolved.** No Nimiq Pay device results have been recorded. Do not invent device outcomes.

**Scope:** guarded, manual testnet exercise of all six native provider staking methods. Separate from P0-02 SDK smoke (`/spike`); this harness is at `/spike/staking-methods`.

---

## Owner device runbook (human gate)

Run this only on a **disposable testnet** wallet inside **Nimiq Pay testnet**. Minimum amounts; expect real state changes.

### Preconditions

1. Nimiq Pay app with **testnet** mode and a funded testnet address (enough for fees + min stake experiments).
2. Dev build of Steakout with the staking spike enabled:
   - Local: `npm run dev` (spike routes allowed in development), **or**
   - Set `VITE_ENABLE_STAKING_SPIKE=true` for non-dev builds.
3. Open the mini-app URL that Pay injects (`window.nimiq`), not a bare desktop browser without the provider.
4. Know a **testnet validator address** for create-staker / update-staker (user-friendly `NQ…` form).

### Steps

1. In Pay testnet, open the Steakout mini-app → navigate to **`#/spike/staking-methods`** (or `/spike/staking-methods` depending on host routing).
2. Confirm **Provider present = Yes** after the page loads inside Pay.
3. Check **TESTNET ONLY** acknowledgement. No method button works until this is checked.
4. For each method you exercise (recommended order when starting from no staker):
   1. `sendNewStakerTransaction` — validator address + **minimum safe** stake in **Luna** (whole number; 1 NIM = 100_000 Luna). Start as small as the wallet/protocol allows; record any UI/protocol minimum you observe.
   2. `sendStakeTransaction` — small add-stake amount.
   3. Then optional lifecycle: set-active, update-staker, retire, remove (respect waiting periods).
5. For **each** method:
   - Fill args → check the per-method review box → **Run**.
   - Approve or **cancel** in the native Pay sheet as required for evidence.
   - Read **Classification**: `hash` | `serialized→hash` | `raw` | `error`.
   - Leave raw return values untouched; do not paraphrase errors.
6. After runs: **Copy report JSON** (or **Download `steakout-p0-03-report.json`**).
7. Paste the JSON (or fill the tables below from it) into this doc under Run Metadata + Per-Method Evidence. Attach sanitized RPC fixtures under `tests/fixtures/rpc/staking/` when a tx is chain-visible.
8. Independently resolve at least one success via testnet RPC `getTransactionByHash` and record confirmation.

### Min amounts guidance

| Field | Guidance |
|---|---|
| Unit | Integer **Luna** only in the harness |
| Create / add stake | Smallest amount Pay and protocol accept; record both if they differ |
| Fees | Leave room in wallet balance; harness does not set fee |
| Cancel tests | Use cancel on native sheet; capture exact error object |

### Residual human gates (still required for AC)

- [ ] Real device session inside Nimiq Pay testnet
- [ ] At least `sendNewStakerTransaction` + `sendStakeTransaction` success or precise failure
- [ ] Return-value semantics for all six methods from **host** (not package types alone)
- [ ] Cancel path exact shape from host
- [ ] One pending → confirmed chain follow-through
- [ ] Fixtures filled under `tests/fixtures/rpc/staking/` for working methods
- [ ] “Safe for Week 1” list updated from device evidence

---

## Package-level ground truth (pre-device)

Evidence from installed package types only. **Not** host behavior. **Device must confirm** before treating any of this as proven for production confirm paths.

**Source file:** `node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts`  
**Package:** `@nimiq/mini-app-sdk` (lockfile resolves to `0.1.0` at time of writing)

### Documented return types

| Method | TypeScript return | `@returns` JSDoc |
|---|---|---|
| `sendBasicTransaction` | `Promise<string \| ErrorResponse>` | **Yes:** “The serialized transaction” |
| `sendBasicTransactionWithData` | `Promise<string \| ErrorResponse>` | **Yes:** “The serialized transaction” |
| `sendNewStakerTransaction` | `Promise<string \| ErrorResponse>` | **No** `@returns` (params documented only) |
| `sendStakeTransaction` | `Promise<string \| ErrorResponse>` | **No** `@returns` |
| `sendSetActiveStakeTransaction` | `Promise<string \| ErrorResponse>` | **No** `@returns` |
| `sendUpdateStakerTransaction` | `Promise<string \| ErrorResponse>` | **No** `@returns` |
| `sendRetireStakeTransaction` | `Promise<string \| ErrorResponse>` | **No** `@returns` |
| `sendRemoveStakeTransaction` | `Promise<string \| ErrorResponse>` | **No** `@returns` |

`ErrorResponse` shape (from the same file):

```ts
interface ErrorResponse {
  error: {
    type: string
    message: string
  }
}
```

### Provisional hypothesis (package inference only)

1. Staking methods are the **same family** as `sendBasicTransaction`: success branch is a `string`, failure/cancel is `ErrorResponse` (or a thrown rejection — host must confirm which).
2. Because basic txs explicitly document the success string as **serialized transaction**, the success string for staking methods is **likely also serialized transaction hex**, **not** a 64-character transaction hash.
3. `ErrorResponse` is the typed shape for user cancel / provider failure when the promise **resolves** with an error object; rejections may still occur — both must be captured on device.
4. **None of the above is proven on device.** Do not mark return-value AC done from this section alone.

### Code prep (pre-device, no fake results)

| Area | Prep |
|---|---|
| Client `normalizeProviderTxResult` | 64-hex → `kind:'hash'` (`source:'hash'`); else try `@nimiq/core` `Transaction.fromAny(hex).hash()` → `source:'serialized'`; else `kind:'raw'` |
| Server `normalizeProviderTxRef` | Same derivation for confirm body `txHash` (accepts long hex provisionally) |
| Harness | Shows classification `hash` \| `serialized→hash` \| `raw` \| `error`; copy/download report JSON |
| Unit tests | Known **constructed** basic signed tx (TransactionBuilder) proves derivation round-trip — **not** a Pay device fixture |

---

## Safety Boundary

- The route is disabled in non-development builds unless `VITE_ENABLE_STAKING_SPIKE=true` is set explicitly.
- The screen requires an explicit `TESTNET ONLY` acknowledgement before any method button can be enabled.
- Each method has its own review checkbox and button. No staking method runs on mount, during provider warmup, or after a prior method completes.
- The provider network is checked after connection. A method call is refused unless the provider reports `testnet`.
- The native Nimiq Pay approval remains in the loop. The harness never requests, receives, stores, or displays private keys or seed phrases.
- Only user-entered method arguments are sent. The harness does not construct or sign staking transactions itself.
- Amounts are entered as whole-number Luna. The harness does not claim the protocol minimum is known.

## Evidence Status

Package types: documented above. Host return values, broadcast behavior, cancellation shape, and lifecycle transitions: **unresolved (no device)**.

No confirmed staking tx fixture under `tests/fixtures/rpc/staking/` yet — only a placeholder template. Fill after device run.

## Run Metadata

| Field | Observation |
|---|---|
| Harness route | `/spike/staking-methods` |
| Build guard | `VITE_ENABLE_STAKING_SPIKE=true` required outside development |
| Target network | Testnet only |
| SDK package | `@nimiq/mini-app-sdk` from lockfile; host SDK build unresolved |
| Nimiq Pay version | Unresolved: no device |
| Device and OS | Unresolved: no device |
| Provider injection | Unresolved: no device |
| Connected address | Unresolved; redact in public paste if needed |
| Testnet RPC URL | Unresolved for this device run |
| Test date/time | Fill during device run |
| Operator | Fill during device run |
| Report JSON paste | Paste `steakout-p0-03-report.json` contents here after device run |

## Static Return Semantics Baseline

See [Package-level ground truth](#package-level-ground-truth-pre-device). Summary:

```ts
Promise<string | ErrorResponse>
// basic: @returns The serialized transaction
// staking: same Promise type, no @returns — provisional: also serialized
```

Harness classification (client-side, post-return):

| Label | Meaning |
|---|---|
| `hash` | String matched 64-hex |
| `serialized→hash` | Parsed via `Transaction.fromAny` → `.hash()` |
| `raw` | String neither 64-hex nor parseable serialized |
| `error` | ErrorResponse or unexpected shape |

Device must resolve whether the host actually returns serialized vs hash vs other.

## Per-Method Evidence Template

For every method, copy the exact result from the harness (or report JSON). Do not replace unresolved fields with assumptions.

### `sendNewStakerTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ delegation, value }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Classification | Unresolved (`hash` / `serialized→hash` / `raw` / `error`) |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved until host return observed |
| RPC lookup request/result | Unresolved; record `getTransactionByHash` or other follow-up and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved |
| After staker state | Unresolved |
| Observed transition/timing | Unresolved |
| Waiting-period behavior | Unresolved / not applicable |

### `sendStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` |
| Exact arguments | `{ value }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Classification | Unresolved |
| Return semantics | Unresolved |
| Provider error type/message | Unresolved |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved |
| RPC lookup request/result | Unresolved |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before / after staker state | Unresolved |
| Observed transition/timing | Unresolved |
| Waiting-period behavior | Unresolved |

### `sendSetActiveStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` |
| Exact arguments | `{ newActiveBalance }` |
| Classification | Unresolved |
| All other fields | Unresolved — fill from harness report |

### `sendUpdateStakerTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` |
| Exact arguments | `{ newDelegation, reactivateAllStake }` |
| Classification | Unresolved |
| Reporting-window / reactivation | Unresolved |
| All other fields | Unresolved — fill from harness report |

### `sendRetireStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` |
| Exact arguments | `{ retireStake }` |
| Classification | Unresolved |
| Waiting-period behavior | Unresolved |
| All other fields | Unresolved — fill from harness report |

### `sendRemoveStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` |
| Exact arguments | `{ value }` |
| Classification | Unresolved |
| Withdrawable precondition | Unresolved |
| All other fields | Unresolved — fill from harness report |

## Error Case Matrix

Run these only on a disposable testnet account and record the exact returned object or rejection without paraphrasing it.

| Case | Methods | Evidence required | Current result |
|---|---|---|---|
| User cancels native approval | All six | Exact `typeof`, raw returned/rejected value, `error.type`, `error.message` | Unresolved: no device |
| Insufficient wallet balance | Value-bearing methods | Exact provider error and whether no transaction was created | Unresolved: no device |
| Invalid lifecycle state | State-dependent methods | Exact provider error and before-state read | Unresolved: no device |
| Invalid or unknown delegation | New/update methods | Exact provider error and whether approval was shown | Unresolved: no device |
| Wrong network | All six | Harness refusal before provider method call | Guard implemented; device observation unresolved |

## Transaction and RPC Follow-Up

For every successful approval, record:

1. Exact returned `typeof` and raw value from the harness.
2. Harness **classification** and any derived hash.
3. Whether the value is serialized transaction data, a hash, or another string, with evidence.
4. Whether the transaction is visible in mempool or RPC immediately after approval, after reload, and after confirmation.
5. `getTransactionByHash` response, including `hash`, `blockNumber`, `executionResult`, `value`, `fee`, `senderData`, `recipientData`, and `validityStartHeight`.
6. A sanitized fixture at `tests/fixtures/rpc/staking/<method>.json`; see `tests/fixtures/rpc/staking/README.md`.

## Protocol State Transition Follow-Up

Capture before and after `getStakerByAddress` reads with RPC block metadata. At minimum record `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, and `retiredBalance`, plus the read timestamp and elapsed blocks. Mark `Withdrawable` only when the protocol evidence establishes the removal precondition; do not infer it from a missing release field. Record whether state changes are immediate, pending, election/reporting-window delayed, or otherwise delayed.

## Safe-for-Week-1 Decision

### Current decision

**No staking provider method is cleared for Week 1 production use from package evidence alone.** The harness is safe as a guarded manual testnet tool. All six methods remain **unresolved on device**. Confirm path code can provisionally derive a hash from long hex (unit-tested with constructed txs); that is **not** a substitute for Pay host observation.

### Method decision table

| Method | Safe for Week 1 production flow | Reason |
|---|---|---|
| `sendNewStakerTransaction` | No, unresolved | Device, return semantics, confirmation, and state transition absent |
| `sendStakeTransaction` | No, unresolved | Device, return semantics, confirmation, and state transition absent |
| `sendSetActiveStakeTransaction` | No, unresolved | Device and lifecycle preconditions absent |
| `sendUpdateStakerTransaction` | No, unresolved | Device and delegation/reactivation timing absent |
| `sendRetireStakeTransaction` | No, unresolved | Device and retirement timing absent |
| `sendRemoveStakeTransaction` | No, unresolved | Device and withdrawable precondition absent |

No production staking flow is unblocked solely by this prep work.
