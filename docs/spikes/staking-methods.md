# P0-03 Staking-Method Spike

**Status:** Harness implemented. Device-dependent observations unresolved. No Nimiq Pay device or testnet wallet was available for this run.

**Scope:** guarded, manual testnet exercise of all six native provider staking methods. This is separate from the P0-02 SDK smoke route at `/spike`; the harness is at `/spike/staking-methods`.

## Safety Boundary

- The route is disabled in non-development builds unless `VITE_ENABLE_STAKING_SPIKE=true` is set explicitly.
- The screen requires an explicit `TESTNET ONLY` acknowledgement before any method button can be enabled.
- Each method has its own review checkbox and button. No staking method runs on mount, during provider warmup, or after a prior method completes.
- The provider network is checked after connection. A method call is refused unless the provider reports `testnet`.
- The native Nimiq Pay approval remains in the loop. The harness never requests, receives, stores, or displays private keys or seed phrases.
- Only user-entered method arguments are sent. The harness does not construct, sign, broadcast, or interpret transactions and does not submit a second time.
- Amounts are entered as whole-number Luna. The harness does not claim the protocol minimum is known.

## Evidence Status

The installed `@nimiq/mini-app-sdk` declaration resolves to `0.1.0` in the repository lockfile. It declares all six methods as `Promise<string | ErrorResponse>` and its method comments call the successful string a serialized transaction. That is package evidence, not device evidence. The actual host return value, broadcast behavior, cancellation shape, and lifecycle transitions remain unresolved.

No transaction fixture is added under `tests/fixtures/rpc/staking/`: without a device run there is no confirmed staking transaction to capture or independently resolve.

## Run Metadata

| Field | Observation |
|---|---|
| Harness route | `/spike/staking-methods` |
| Build guard | `VITE_ENABLE_STAKING_SPIKE=true` required outside development |
| Target network | Testnet only |
| SDK package | `@nimiq/mini-app-sdk` `0.1.0` from lockfile; host SDK build unresolved |
| Nimiq Pay version | Unresolved: no device |
| Device and OS | Unresolved: no device |
| Provider injection | Unresolved: no device |
| Connected address | Unresolved; redact all but the necessary test fixture form if later captured |
| Testnet RPC URL | Unresolved for this device run |
| Test date/time | Fill during device run |
| Operator | Fill during device run |

## Static Return Semantics Baseline

The installed declaration documents this common shape:

```ts
Promise<string | ErrorResponse>

interface ErrorResponse {
  error: {
    type: string
    message: string
  }
}
```

The declaration comments describe the successful `string` as serialized transaction data, not a transaction hash. The harness displays the exact JavaScript `typeof` and raw returned value and deliberately does not label a string as a hash. A device run must resolve whether the string is serialized bytes, a hash, or another value, and whether the provider has already broadcast it.

## Per-Method Evidence Template

For every method, copy the exact result from the harness. Do not replace unresolved fields with assumptions.

### `sendNewStakerTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ delegation, value }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved; do not derive until format is proven |
| RPC lookup request/result | Unresolved; record `getTransactionByHash` or other follow-up and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved: `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`, RPC metadata |
| After staker state | Unresolved: same fields plus read timestamp/block |
| Observed transition/timing | Unresolved: no staker -> pending/active delegated staker |
| Waiting-period behavior | Unresolved / not applicable |

### `sendStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ value }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved; do not derive until format is proven |
| RPC lookup request/result | Unresolved; record follow-up method and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved: `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`, RPC metadata |
| After staker state | Unresolved: same fields plus read timestamp/block |
| Observed transition/timing | Unresolved: existing staker -> increased stake |
| Waiting-period behavior | Unresolved |

### `sendSetActiveStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ newActiveBalance }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved; do not derive until format is proven |
| RPC lookup request/result | Unresolved; record follow-up method and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved: `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`, RPC metadata |
| After staker state | Unresolved: same fields plus read timestamp/block |
| Observed transition/timing | Unresolved: active/inactive balances -> requested active balance |
| Waiting-period behavior | Unresolved |

### `sendUpdateStakerTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ newDelegation, reactivateAllStake }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved; do not derive until format is proven |
| RPC lookup request/result | Unresolved; record follow-up method and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved: `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`, RPC metadata |
| After staker state | Unresolved: same fields plus read timestamp/block |
| Observed transition/timing | Unresolved: existing delegation -> new delegation, including reactivation behavior |
| Waiting-period behavior | Unresolved; reporting-window behavior must be captured |

### `sendRetireStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ retireStake }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved; do not derive until format is proven |
| RPC lookup request/result | Unresolved; record follow-up method and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved: `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`, RPC metadata |
| After staker state | Unresolved: same fields plus read timestamp/block |
| Observed transition/timing | Unresolved: active stake -> retiring/retired balance |
| Waiting-period behavior | Unresolved; record when removal becomes permitted |

### `sendRemoveStakeTransaction`

| Field | Observation |
|---|---|
| Method status | `Unresolved` / `Works` / `Fails` / `Unsupported` |
| Exact arguments | `{ value }` |
| Approval/cancel outcome | Unresolved |
| Exact `typeof` | Unresolved |
| Raw return value | Unresolved |
| Return semantics | Serialized transaction / tx hash / other / unresolved |
| Provider error type/message | Unresolved; capture exact cancel, insufficient-balance, and invalid-state cases |
| Thrown/rejected error raw value | Unresolved |
| Derived transaction hash | Unresolved; do not derive until format is proven |
| RPC lookup request/result | Unresolved; record follow-up method and exact response |
| Confirmation block/hash | Unresolved |
| `executionResult` | Unresolved |
| Before staker state | Unresolved: `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`, RPC metadata |
| After staker state | Unresolved: same fields plus read timestamp/block |
| Observed transition/timing | Unresolved: withdrawable retired stake -> removed stake/basic balance |
| Waiting-period behavior | Unresolved; exact withdrawable precondition is not established |

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
2. Whether the value is serialized transaction data, a hash, or another string, with evidence.
3. If serialized, the independently derived hash and derivation method/version.
4. Whether the transaction is visible in mempool or RPC immediately after approval, after reload, and after confirmation.
5. `getTransactionByHash` response, including `hash`, `blockNumber`, `executionResult`, `value`, `fee`, `senderData`, `recipientData`, and `validityStartHeight`.
6. A sanitized fixture at `tests/fixtures/rpc/staking/<method>.json`; omit private material and redact a user address if it is not needed for the test.

## Protocol State Transition Follow-Up

Capture before and after `getStakerByAddress` reads with RPC block metadata. At minimum record `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, and `retiredBalance`, plus the read timestamp and elapsed blocks. Mark `Withdrawable` only when the protocol evidence establishes the removal precondition; do not infer it from a missing release field. Record whether state changes are immediate, pending, election/reporting-window delayed, or otherwise delayed.

## Safe-for-Week-1 Decision

### Current decision

**No staking provider method is cleared for Week 1 production use from this spike.** The harness itself is safe to use as a guarded manual testnet tool. All six provider methods remain unresolved because there is no Pay device, no testnet account, no approval/cancel observation, no exact host return value, no independently resolved transaction, and no observed state transition.

### Method decision table

| Method | Safe for Week 1 production flow | Reason |
|---|---|---|
| `sendNewStakerTransaction` | No, unresolved | Device, return semantics, confirmation, and state transition absent |
| `sendStakeTransaction` | No, unresolved | Device, return semantics, confirmation, and state transition absent |
| `sendSetActiveStakeTransaction` | No, unresolved | Device and lifecycle preconditions absent |
| `sendUpdateStakerTransaction` | No, unresolved | Device and delegation/reactivation timing absent |
| `sendRetireStakeTransaction` | No, unresolved | Device and retirement timing absent |
| `sendRemoveStakeTransaction` | No, unresolved | Device and withdrawable precondition absent |

No production staking flow, intent/confirm endpoint, transaction broadcaster, or plan/board change is included in this spike.
