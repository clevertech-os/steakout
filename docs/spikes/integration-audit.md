# Nimiq Integration Audit

**Audit date:** 2026-08-02
**Scope:** P0-02, P0-03, and P0-04 integration decisions; local VeriLock reuse
**Status:** Static/package and live-mainnet audit only. No Nimiq Pay device run was available.

## Evidence labels

| Label | Meaning |
|---|---|
| Verified local | Read directly from the checked-out VeriLock source, lockfile, or installed declaration. |
| Verified live | Observed from `https://rpc.nimiqwatch.com` during this audit. Live values are time-sensitive. |
| Protocol source | Read from the Nimiq `core-rs-albatross` RPC interface/types source. This is stronger than a product assumption but is not a device result. |
| Hypothesis | A reasonable implementation expectation that still needs confirmation. |
| Unknown | Not answerable without a device, testnet transaction, or additional RPC evidence. |

## Executive findings

| Question | Finding | Confidence |
|---|---|---|
| SDK version in VeriLock | `@nimiq/mini-app-sdk` resolves to `0.1.0`. | Verified local |
| Provider transaction return type | All six staking methods are declared as `Promise<string \| ErrorResponse>` and documented as returning the serialized transaction. | Verified local |
| Actual provider return value | The exact raw value, whether it is hex, and whether the wallet has already broadcast it were not observed. | Unknown; P0-03 device test required |
| RPC envelope | JSON-RPC response data is under `result.data`; stateful methods also return `result.metadata` with `blockNumber` and `blockHash`. | Verified live and Protocol source |
| Transaction list pagination | `getTransactionsByAddress(address, max, startAt)` returns newest first; `startAt` is an exclusive transaction hash cursor. | Verified live and Protocol source |
| Staker read fields | `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, and `retiredBalance` are available. | Verified live and Protocol source |
| Withdrawable timing | The RPC `Staker` shape does not expose `inactiveRelease` or a timestamp. `Withdrawable` cannot be safely derived from the current evidence alone. | Protocol source; unresolved |
| Restake analytics | The raw staker balance is readable for a known staker, but reliability across all lifecycle states and networks is unproven. | Verified live for one mainnet address; P0-04 remains open |

## Sources inspected

### Steakout

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/TESTING.md`
- `docs/DATA-MODEL.md`
- `plan/phase-0-spike.md`, including the P0-02, P0-03, and P0-04 cards
- `plan/README.md` and `plan/TEAMS.md` for ownership and dependencies

### VeriLock

- `package.json`
- `client/package.json` and `client/package-lock.json`
- `server/package.json` and `server/package-lock.json`
- `client/src/nimiq.ts`
- `client/src/nimiq-globals.d.ts`
- `client/src/journey/useJourneyWallet.ts`
- `client/src/session.ts`, `client/src/addresses.ts`, and `client/src/explorer.ts`
- `server/src/nimiq-rpc.ts`
- `server/src/hub-signature.ts`, `server/src/auth-wallet.ts`, `server/src/rate-limit.ts`, and `server/src/http-headers.ts`

### Installed Nimiq packages

- `client/node_modules/@nimiq/mini-app-sdk/package.json`, `README.md`, and `dist/provider.d.ts`
- `client/node_modules/@nimiq/rpc/package.json` and `types/index.d.ts`
- `client/node_modules/@nimiq/core/package.json` and `types/wasm/web.d.ts`
- `client/node_modules/@nimiq/hub-api/package.json`
- Lockfile resolutions: Mini App SDK `0.1.0`, RPC `0.4.1`, Core `2.7.1`, Hub API `1.14.0`, and Fastspot API `1.10.3`

### Authoritative Nimiq sources

- [Nimiq Developer Center](https://www.nimiq.com/developers/), which identifies Mini Apps and RPC as supported integration paths.
- [Mini App SDK package source](https://github.com/nimiq/trust-web3-provider/tree/nimiq/packages/mini-app-sdk), branch `nimiq`, package version `0.1.0`.
- [Core RPC blockchain interface](https://github.com/nimiq/core-rs-albatross/blob/albatross/rpc-interface/src/blockchain.rs).
- [Core RPC data types](https://github.com/nimiq/core-rs-albatross/blob/albatross/rpc-interface/src/types.rs).
- [Core RPC policy interface](https://github.com/nimiq/core-rs-albatross/blob/albatross/rpc-interface/src/policy.rs).
- The RPC path linked from the current Core README, `https://www.nimiq.com/developers/build/set-up-your-own-node/rpc-docs/`, returned HTTP 404 during this audit. The Core source links the older JSON-RPC reference to the `core-js` wiki, so the source definitions and live endpoint were used instead of treating that page as current.

## SDK and provider API

### Installed versions

| Package | Declared in VeriLock | Resolved version | Relevance |
|---|---:|---:|---|
| `@nimiq/mini-app-sdk` | `^0.1.0` | `0.1.0` | `init`, host helpers, and provider type re-exports |
| `@nimiq/rpc` | `^0.4.1` | `0.4.1` | Installed client package; VeriLock's server RPC wrapper uses `fetch` instead of this package |
| `@nimiq/core` | server `^2.7.1` | `2.7.1` | Address, transaction, and protocol types; also present in the client install |
| `@nimiq/hub-api` | `1.14.0` | `1.14.0` | VeriLock desktop/Hub fallback |

### Mini App SDK exports

Verified from `@nimiq/mini-app-sdk` 0.1.0:

```ts
init(options?: { timeout?: number }): Promise<NimiqProvider>
getHostLanguage(): string | undefined
requestDeviceIdentifier(options: { reason: string }): Promise<string>
```

`init()` waits for `window.nimiq` injection. The installed implementation defaults to a 10-second timeout and rejects if the provider is not injected. The provider is also globally typed as `window.nimiq`. `window.nimiqPay` contains the read-only host context and `requestDeviceIdentifier`; the SDK documentation says that identifier is device-scoped, not a user identity.

### Provider identity and signing

The installed provider declaration exports `NimiqProvider`, `SignatureResult`, `TransactionInfo`, `ErrorResponse`, and `INimiqProviderConfig` through the SDK provider entrypoint.

```ts
connect(): Promise<void>
disconnect(): void
getNetwork(): string
connected: boolean
listAccounts(): Promise<string[] | ErrorResponse>
sign(message: string | { message: string; isHex?: boolean }):
  Promise<SignatureResult | ErrorResponse>
isConsensusEstablished(): Promise<boolean>
getBlockNumber(): Promise<number>
```

```ts
interface SignatureResult {
  publicKey: string
  signature: string
}

interface ErrorResponse {
  error: {
    type: string
    message: string
  }
}
```

VeriLock's `connectNimiq()` calls `connect()` and then `listAccounts()`, taking the first returned account. Its `signChallenge()` calls `sign({ message: nonce, isHex: false })`, then reads `publicKey` and `signature`. `getProviderErrorMessage()` extracts `error.message` from the provider error envelope.

The provider declaration includes `getBlockNumber()`, but Steakout's architecture correctly assigns server-side reads to RPC. The P0-02 card still requires a server probe so the browser provider is not the source of server verification truth.

### Native staking methods

All numeric amounts are documented by the installed declaration as Luna, where 1 NIM is 100,000 Luna. Every method also accepts optional `fee` and `validityStartHeight` fields.

```ts
sendNewStakerTransaction(tx: {
  delegation: string
  value: number
  fee?: number
  validityStartHeight?: number
}): Promise<string | ErrorResponse>

sendStakeTransaction(tx: {
  value: number
  fee?: number
  validityStartHeight?: number
}): Promise<string | ErrorResponse>

sendSetActiveStakeTransaction(tx: {
  newActiveBalance: number
  fee?: number
  validityStartHeight?: number
}): Promise<string | ErrorResponse>

sendUpdateStakerTransaction(tx: {
  newDelegation: string
  reactivateAllStake?: boolean
  fee?: number
  validityStartHeight?: number
}): Promise<string | ErrorResponse>

sendRetireStakeTransaction(tx: {
  retireStake: number
  fee?: number
  validityStartHeight?: number
}): Promise<string | ErrorResponse>

sendRemoveStakeTransaction(tx: {
  value: number
  fee?: number
  validityStartHeight?: number
}): Promise<string | ErrorResponse>
```

## Transaction return semantics

### Verified facts

- The installed `provider.d.ts` documents the result of all six methods as `string | ErrorResponse`.
- The comments for the staking methods describe the string as the serialized transaction, not a transaction hash.
- The provider's basic transaction methods have the same serialized-transaction wording.
- VeriLock's Hub path separately handles `SignedTransaction.hash` and `SignedTransaction.serializedTx`; that is not evidence about the native Pay staking methods.
- No native staking method is called anywhere in the inspected VeriLock source.

### Likely implementation behavior

**Hypothesis:** a successful native staking call returns serialized transaction data, probably a hex string, while a rejected or failed provider request returns `{ error: { type, message } }`. Steakout should not treat the returned string as a hash until P0-03 proves that behavior on the shipped Pay version.

If the device confirms a serialized transaction, the next agent should derive the hash with the installed Core transaction parser (`Transaction.fromAny(serialized).hash()`) or use the provider's documented conversion if one is supplied. Whether the provider has already broadcast the serialized transaction, merely signed it, or does both is still **Unknown**. The result must be checked with `getTransactionByHash` and, if necessary, the mempool method before the app tells the user that a transaction is pending or confirmed.

### Required device observations

For each method, record the exact `typeof` result and raw value in a redacted fixture, then independently resolve the resulting hash through RPC. Do not put seed phrases, private keys, or secrets in the fixture. Record the method arguments, provider version, Pay app version, network, account address, approval/cancel outcome, error object, and state transition.

## RPC request and response shapes

### Common JSON-RPC envelope

The request is a JSON-RPC 2.0 POST. VeriLock's wrapper uses this shape:

```json
{
  "jsonrpc": "2.0",
  "method": "getBlockNumber",
  "params": [],
  "id": 1
}
```

Successful responses observed from the public endpoint have this shape:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "data": {},
    "metadata": {}
  },
  "id": 1
}
```

For methods whose source return type has `metadata = ()`, the live endpoint returned `"metadata": null`. For stateful reads, `metadata` is:

```ts
{
  blockNumber: number
  blockHash: string
}
```

Error responses observed:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Transaction not found: ..."
  },
  "id": 1
}
```

Invalid parameters returned code `-32602`, message `Invalid params`, and a detail in `data`. The server should classify known absence errors separately from transport errors instead of retrying every RPC error.

### P0-04 methods

| Method | Request params | `result.data` shape | Metadata |
|---|---|---|---|
| `getBlockNumber` | `[]` | `number` (`u32`) | `null` observed |
| `getValidatorByAddress` | `[address]` | `Validator` | `{ blockNumber, blockHash }` |
| `getActiveValidators` | `[]` | `Validator[]` | `{ blockNumber, blockHash }` |
| `getAccountByAddress` | `[address]` | `Account` | `{ blockNumber, blockHash }` |
| `getStakerByAddress` | `[address]` | `Staker` | `{ blockNumber, blockHash }` |
| `getTransactionsByAddress` | `[address, max?, startAt?]` | `ExecutedTransaction[]` | `null` observed |
| `getTransactionByHash` | `[hash]` | `ExecutedTransaction` | `null` observed |

Addresses and hashes are passed as strings. The live endpoint accepted user-friendly NQ addresses with spaces and lowercase hexadecimal transaction hashes.

### Validator

Protocol source defines the JSON field names through `camelCase` serialization:

```ts
interface Validator {
  address: string
  signingKey: string
  votingKey: string
  rewardAddress: string
  signalData: string | null
  balance: number
  numStakers: number
  inactivityFlag: number | null
  retired: boolean
  jailedFrom: number | null
}
```

The live `getValidatorByAddress` and `getActiveValidators` responses matched these fields. The live active-validator sample also included `metadata.blockNumber` and `metadata.blockHash`.

### Account

Protocol source defines the common fields as:

```ts
interface Account {
  address: string
  balance: number
  type: "basic" | "vesting" | "htlc" | "staking"
}
```

The `vesting` and `htlc` variants carry additional fields. The `staking` variant is the staking contract account. A live basic-account response was:

```json
{
  "address": "NQ11 ... C4H2",
  "balance": 2,
  "type": "basic"
}
```

Do not use `account.balance` as the user's stake. The staker read is the source for active, inactive, and retired stake balances.

### Staker

Protocol source and a live known-staker query agree on this shape:

```ts
interface Staker {
  address: string
  balance: number
  delegation: string | null
  inactiveBalance: number
  inactiveFrom: number | null
  retiredBalance: number
}
```

The installed Core web-client type additionally documents `inactiveRelease`, but the RPC `Staker` struct in the authoritative RPC source does not contain that field, and the live response did not contain it. This is a material version/surface distinction. Do not map `inactiveRelease` into the API contract until P0-04 proves that the chosen RPC source returns it.

The installed Core type comments state that retired funds are immediately available to withdraw once retired. That comment is not enough to derive the exact client-visible `Withdrawable` transition from RPC: the RPC response has no explicit release timestamp or block field for retired stake.

### Executed transaction

Protocol source defines the transaction fields as:

```ts
interface ExecutedTransaction {
  hash: string
  blockNumber?: number
  timestamp?: number
  confirmations?: number
  size: number
  relatedAddresses: string[]
  from: string
  fromType: number
  to: string
  toType: number
  value: number
  fee: number
  senderData: string
  recipientData: string
  flags: number
  validityStartHeight: number
  proof: string
  networkId: number
  executionResult: boolean
}
```

The source uses hex serialization for sender data, recipient data, and proof. A live address-history response included all of these fields, returned newest first, and included reward transfers. Live timestamps were Unix milliseconds.

### Pagination and absence behavior

The RPC source documents `getTransactionsByAddress` as:

- `max` optional, default 500, bounded by the server's integer type (`u16` in the source).
- `startAt` optional, exclusive transaction hash.
- Results newest to oldest.
- An unknown cursor or a cursor not belonging to the address returns an empty list according to the source.

The live probe requested `[address, 3, null]` and received three records. Repeating with the first hash as `startAt` returned the next three older records and excluded the cursor, confirming the exclusive behavior.

The live probe for a missing transaction returned `-32603 / Internal error` with `data: "Transaction not found: ..."`. The live probe for an address with no staker returned `-32603 / Internal error` with `data: "No staker with address: ..."`. These are observed endpoint behaviors, not idealized API guarantees.

## VeriLock reuse map

| VeriLock module | Relevant exports or behavior | Port guidance |
|---|---|---|
| `client/src/nimiq.ts` | `WalletMode`, `getProviderErrorMessage`, `getWalletMode`, `isNimiqPayHost`, `probeNimiqPay`, `warmNimiqProvider`, `ensureNimiqProvider`, `connectNimiq`, `signChallenge`, `isHubCancelError`, `setupHubRedirectHandlers`, `connectViaHub`, and URL/deep-link helpers | Port provider detection, Pay connection, sign flow, and Hub fallback. Strip seal, attestation, top-up, document, and journey-specific functions including `relaySignedTransaction`, `finalizeHubLockTransaction`, payload builders, and credit top-up methods. |
| `client/src/journey/useJourneyWallet.ts` | `UseJourneyWalletResult`, `useJourneyWallet()`; Pay/Hub connection state, session restore, cancellation, and mobile handling | Port the connection state machine to `client/src/wallet/useWallet.ts`. Remove journey account types, document API calls, and document login coupling. |
| `client/src/nimiq-globals.d.ts` | `window.nimiq?: NimiqProvider`, `window.nimiqPay?: NimiqPayHostContext` | Port the global provider types. Keep the device identifier explicitly out of wallet identity. |
| `client/src/session.ts` | `StoredSession`, `saveSession`, `loadSession`, `clearSession` | Port with a Steakout storage key. The implementation is session-only and does not store keys. |
| `client/src/addresses.ts` | `normalizeAddress`, `isValidNimiqAddress`, `shortAddress`, `formatDisplayAddress` | Port normalization, but verify checksum validation against the shared helper requirement before using it for security decisions. |
| `client/src/explorer.ts` | `buildNimiqExplorerUrl`, `buildNimiqAddressExplorerUrl` | Port URL builders and add active-network selection if the explorer differs by network. |
| `server/src/nimiq-rpc.ts` | `NimiqTransaction`, `formatRpcError`, `isTransactionNotFoundError`, `normalizeTxHash`, `getBlockNumber`, `getWalletBalanceLuna`, `fetchTransactionsByAddress`, `fetchTransaction`, retry/backoff wrapper | Port the RPC transport, error formatting, hash normalization, retries, and transaction normalization. Add typed validator/account/staker methods from P0-04. Drop attestation payload, service-wallet broadcast, credit, and document verification code. |
| `server/src/hub-signature.ts` | `verifyHubSignedMessage` with the Nimiq signed-message prefix | Port for Hub authentication. It is separate from the Pay signature verification path and must be tested with the P0-02 fixture. |
| `server/src/auth-wallet.ts` | `addressFromPublicKeyHex`, `assertPublicKeyMatchesAddress`, `publicKeyBindingResult` | Port public-key-to-address binding; retain server-side address binding and do not accept a client address claim alone. |
| `server/src/rate-limit.ts` | `rateLimit(max, windowMs)` | Port for challenge, verify, intent, confirm, and RPC-facing controls. |
| `server/src/http-headers.ts` | `applySecurityHeaders(app)` | Port the security-header baseline. |

VeriLock's server RPC wrapper currently sends `[address, limit, start]` for address history and maps `hash/from/to` directly. That matches the observed current RPC shape. Its fallback to `getTransactionFromMempool` and the light client is useful for pending transactions but should be isolated from Steakout's read-only chain verification and tested separately.

## Concrete unknowns requiring real-device or testnet testing

| ID | Unknown | Why it matters | Required evidence |
|---|---|---|---|
| U-01 | Exact Nimiq Pay app version and provider build used by the competition environment | Package types alone do not prove the host implementation matches them | Pay app version, SDK version, device OS, and network in the report |
| U-02 | Whether `init()` injection, `connect()`, and `listAccounts()` behave identically on Android, iOS, and browser fallback | The flow is WebView and host dependent | One successful and one cancel/reload run per available platform |
| U-03 | Exact `sign()` result and rejection shape for fixed plain-text challenge | Auth fixture and server verification depend on byte interpretation | Raw `{ publicKey, signature }` plus exact challenge and `isHex:false` |
| U-04 | Whether each staking method returns serialized transaction bytes, a hash, or another string | Intent confirmation cannot choose hash derivation or broadcast behavior safely | Raw return value and independent RPC lookup for all six methods |
| U-05 | Whether the native method has already broadcast the returned transaction | Determines whether Steakout should broadcast anything and how to recover after reload | Observe mempool/chain visibility immediately after approval and after app restart |
| U-06 | Minimum accepted stake, wallet safety floor, and fee behavior | Product presets and review validation must not produce unusable requests | Testnet amount matrix including zero, minimum, minimum plus fee, and insufficient balance |
| U-07 | Which lifecycle preconditions and transitions the host enforces | Retire, remove, set-active, and update are state dependent | Before/after `getStakerByAddress` fixtures and exact invalid-state errors |
| U-08 | Cancel error object for connection and every staking method | UI needs a neutral, actionable failure state | Exact provider error object, not only rendered message |
| U-09 | Testnet RPC method availability and field parity | The live probes were mainnet-only | Run every P0-04 method against testnet and compare field sets |
| U-10 | Whether `inactiveRelease` or an equivalent withdrawal deadline is exposed by the production RPC | Required for `Withdrawable` and countdown UI | Known active, inactive, released-inactive, retired, and withdrawable staker reads |
| U-11 | Whether inactive/retired stake state is stable across consecutive reads and election boundaries | State transitions can be delayed by reporting/election windows | Capture the same address at multiple block heights, with metadata |
| U-12 | Rate-limit status codes, `Retry-After`, and public endpoint limits | Indexer scheduling and retry behavior depend on upstream policy | Controlled low-rate and bounded burst tests on testnet or an approved endpoint |
| U-13 | Whether a staker address can be found from the authenticated wallet before the first stake | Determines the no-staker path and fixture setup | `getAccountByAddress` plus `getStakerByAddress` for an unfunded/no-stake account |

## Proposed fixture names

All fixtures should be sanitized, immutable captures. Each fixture set should have a companion `_meta.json` containing endpoint, network, capture timestamp, block number if available, SDK/Pay versions where applicable, and the address/hash redaction policy.

### P0-02 wallet fixtures

- `tests/fixtures/wallet/p0-02-pay-testnet-list-accounts.json`
- `tests/fixtures/wallet/p0-02-pay-testnet-sign-fixed-challenge.json`
- `tests/fixtures/wallet/p0-02-pay-testnet-connect-cancel.json`
- `tests/fixtures/wallet/p0-02-meta.json`

The successful signature fixture must contain `address`, exact `message`, `isHex`, `signature`, and `publicKey`. It must not contain a seed phrase or private key.

### P0-02/P0-04 RPC smoke fixtures

- `tests/fixtures/rpc/p0-02-get-block-number-testnet.json`
- `tests/fixtures/rpc/p0-04-get-block-number-testnet.json`
- `tests/fixtures/rpc/p0-04-get-block-number-mainnet.json`

### P0-03 staking transaction fixtures

- `tests/fixtures/rpc/staking/p0-03-new-staker-confirmed.json`
- `tests/fixtures/rpc/staking/p0-03-stake-confirmed.json`
- `tests/fixtures/rpc/staking/p0-03-set-active-confirmed.json`
- `tests/fixtures/rpc/staking/p0-03-update-staker-confirmed.json`
- `tests/fixtures/rpc/staking/p0-03-retire-stake-confirmed.json`
- `tests/fixtures/rpc/staking/p0-03-remove-stake-confirmed.json`
- `tests/fixtures/rpc/staking/p0-03-method-results.json`
- `tests/fixtures/rpc/staking/_meta.json`

`p0-03-method-results.json` should store method name, submitted parameters with addresses sanitized as required, raw provider return classification, raw provider error for negative cases, derived hash if applicable, and RPC resolution status. The six confirmed files should be raw `getTransactionByHash` responses, not a client-normalized projection.

### P0-04 read fixtures

- `tests/fixtures/rpc/p0-04-validator-by-address-testnet.json`
- `tests/fixtures/rpc/p0-04-active-validators-testnet.json`
- `tests/fixtures/rpc/p0-04-account-basic-testnet.json`
- `tests/fixtures/rpc/p0-04-account-staking-testnet.json`
- `tests/fixtures/rpc/p0-04-staker-active-testnet.json`
- `tests/fixtures/rpc/p0-04-staker-inactive-testnet.json`
- `tests/fixtures/rpc/p0-04-staker-retired-testnet.json`
- `tests/fixtures/rpc/p0-04-staker-withdrawable-testnet.json`
- `tests/fixtures/rpc/p0-04-transactions-by-address-page-1-testnet.json`
- `tests/fixtures/rpc/p0-04-transactions-by-address-page-2-testnet.json`
- `tests/fixtures/rpc/p0-04-transaction-by-hash-confirmed-testnet.json`
- `tests/fixtures/rpc/p0-04-transaction-by-hash-missing-testnet.json`
- `tests/fixtures/rpc/p0-04-meta.json`

If a real inactive, retired, or withdrawable testnet address cannot be obtained, keep the fixture name out of the tree and record the absence explicitly rather than manufacturing a state. A mainnet comparison set may use the same names with `-mainnet` suffixes.

## Precise next-agent checklist

### P0-02

- [ ] Confirm P0-01 scaffold and guarded `/spike` route exist before adding integration code.
- [ ] Record the exact installed `@nimiq/mini-app-sdk` version and the Nimiq Pay app version on the test device.
- [ ] Run inside Nimiq Pay testnet, not only a desktop browser.
- [ ] Call `init({ timeout })`, `connect()`, and `listAccounts()`; record provider presence, network, account count, exact address format, and cancel behavior.
- [ ] Sign one fixed ASCII challenge with `sign({ message, isHex: false })`; record the exact result object and preserve the exact message bytes.
- [ ] Run the server `getBlockNumber` probe and record request, response, latency, network, and metadata.
- [ ] Save the two successful wallet fixtures and `_meta.json`; sanitize only private/user-sensitive data, not public validator addresses.
- [ ] End the spike with a report that distinguishes provider injection, account access, signing, and server RPC results.

### P0-03

- [ ] Use a funded testnet account and a known valid testnet validator; record the validator address and minimum safe amount.
- [ ] Before each provider call, render and capture the review state containing operation, Luna amount, validator, and intended transition.
- [ ] Exercise all six methods with valid state prerequisites, one method at a time.
- [ ] Record `typeof result`, raw result length/prefix, whether it parses as serialized Core transaction, derived hash, and immediate mempool/chain visibility.
- [ ] Follow at least one pending result through confirmation and record block number, `executionResult`, and confirmations.
- [ ] Exercise cancel, insufficient balance, invalid state, and malformed-parameter paths; retain exact `{ error: ... }` objects.
- [ ] Fetch every successful hash with `getTransactionByHash`; save one raw confirmed response per working method under `tests/fixtures/rpc/staking/`.
- [ ] Compare transaction `recipientData`/staking payload to the requested operation before marking a method supported.
- [ ] Mark each method `works`, `fails`, or `unsupported`; do not infer support from TypeScript declarations.
- [ ] Finish with an explicit Week 1 safe-method list and a hash-versus-serialized normalization decision.

### P0-04

- [ ] Select and record testnet and mainnet RPC URLs, network IDs, capture date, and request timeout.
- [ ] Probe all seven required methods: block number, validator, active validators, account, staker, address transactions, and transaction by hash.
- [ ] Save raw responses, not only normalized projections, with a metadata file for each network.
- [ ] Verify `getTransactionsByAddress` ordering, maximum page size, `startAt` exclusivity, unknown cursor behavior, and an empty result.
- [ ] Capture a known staker with active balance and obtain separate inactive, retired, and withdrawable examples if the network permits.
- [ ] Compare `getAccountByAddress` and `getStakerByAddress` at the same or recorded block context; never use account balance as stake balance.
- [ ] Determine whether the selected RPC exposes an explicit inactive-release/withdrawable height. If not, document `Withdrawable` as unavailable rather than deriving a countdown from an unsupported assumption.
- [ ] Record exact HTTP status, JSON-RPC code, message, and `Retry-After` behavior for timeout, malformed request, absent staker, absent transaction, and rate limit cases.
- [ ] Write a one-paragraph restake verdict: reliable fields, known missing fields, consistency across repeated reads, and whether P1-05/P3-02 may proceed.
- [ ] Add fixture-backed sanity tests only after the raw captures are reviewed; CI must not call the live RPC.

### Integration handoff

- [ ] Implement typed RPC methods from the captured shapes, including `metadata` and nullability.
- [ ] Normalize provider success to a confirmed transaction hash only after the P0-03 return semantics are proven.
- [ ] Keep provider writes client-side and chain verification server-side; never accept a client assertion as confirmation.
- [ ] Keep direct-payout monitoring viable if the P0-04 restake verdict is negative or incomplete.
- [ ] Update `docs/spikes/staking-methods.md` and `docs/spikes/rpc-reads.md` with the device/probe evidence; this audit is the pre-test integration map, not a substitute for either card's acceptance report.

## Blockers and scope decision

No code or test fixture was modified by this audit. The requested report is complete as a static integration audit, but these acceptance items remain blocked until human-assisted testing is available:

- P0-02 cannot prove Nimiq Pay testnet account access or signing without a device session.
- P0-03 cannot resolve native staking return semantics, method support, minimum amounts, cancellation errors, or confirmed staking transactions without a funded testnet device.
- P0-04 has live mainnet evidence but no testnet capture in this workspace, no controlled rate-limit experiment, and no complete lifecycle matrix for inactive/retired/withdrawable stakers.

Until those are resolved, the safe implementation assumption is: use the provider method declarations for compile-time call shapes, treat successful staking results as an opaque string, do not call it a hash, and ship no UI that claims `Withdrawable` timing or verified restake payout behavior.
