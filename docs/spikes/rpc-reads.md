# RPC Read-Layer Probe

**Task:** P0-04
**Capture:** 2026-08-03T05:17:54Z (fixture metadata)
**Live evidence:** mainnet only
**Status:** Mainnet read shapes captured; testnet and lifecycle gaps remain unresolved.

## Probe

The probe is kept at `server/scripts/probe-rpc.ts` and uses the validated JSON-RPC
2.0 POST envelope:

```json
{
  "jsonrpc": "2.0",
  "method": "getBlockNumber",
  "params": [],
  "id": 1
}
```

It validates the response envelope before writing the response, writes only raw
RPC responses, and records request/latency/status metadata in `_meta.json`.
Inputs are environment-configured. Example mainnet invocation (use public or
sanitized test inputs only):

```bash
NIMIQ_RPC_URL=https://rpc.nimiqwatch.com \
NIMIQ_NETWORK=mainnet \
RPC_VALIDATOR_ADDRESS='NQ..' \
RPC_ACCOUNT_ADDRESS='NQ..' \
RPC_STAKER_ADDRESS='NQ..' \
RPC_TRANSACTIONS_ADDRESS='NQ..' \
npx tsx server/scripts/probe-rpc.ts
```

`RPC_TRANSACTION_HASH` and `RPC_TRANSACTION_CURSOR` are optional when the first
transaction page is non-empty; the probe derives both from page 1. It uses
`RPC_TRANSACTIONS_MAX` (default `3`) and `RPC_TIMEOUT_MS` (default `10000`).

## Captured Evidence

Fixtures are in `tests/fixtures/rpc/` and are sanitized. Validator addresses and
public validator keys remain because they are public chain data. The configured
account/staker input was replaced with deterministic `NQ00` test addresses in
responses and metadata. The probe refuses to write fields whose names indicate a
seed, mnemonic, private key, passphrase, or secret.

The mainnet endpoint was `https://rpc.nimiqwatch.com/`. All eight captures returned
HTTP 200 and no `Retry-After` header. The stateful responses carried block metadata
with block numbers in the `57873326` to `57873327` range; block and transaction
methods returned `metadata: null`.

| Method | Result shape observed | Result metadata |
|---|---|---|
| `getBlockNumber` | `number` | `null` |
| `getValidatorByAddress` | `Validator` object | `{ blockNumber, blockHash }` |
| `getActiveValidators` | `Validator[]` | `{ blockNumber, blockHash }` |
| `getAccountByAddress` | `Account` object: `address`, `balance`, `type` | `{ blockNumber, blockHash }` |
| `getStakerByAddress` | Positive shape is `address`, `balance`, `delegation`, `inactiveBalance`, `inactiveFrom`, `retiredBalance`; this capture exercised the no-staker error | Positive shape has `{ blockNumber, blockHash }` in prior live evidence |
| `getTransactionsByAddress` | `ExecutedTransaction[]` | `null` |
| `getTransactionByHash` | `ExecutedTransaction` object | `null` |

The validator fields captured were `address`, `signingKey`, `votingKey`,
`rewardAddress`, `signalData`, `balance`, `numStakers`, `inactivityFlag`,
`retired`, and `jailedFrom`. Transaction fields included `hash`, optional
`blockNumber`, `timestamp`, `confirmations`, `size`, `relatedAddresses`, `from`,
`fromType`, `to`, `toType`, `value`, `fee`, `senderData`, `recipientData`,
`flags`, `validityStartHeight`, `proof`, `networkId`, and `executionResult`.

The account capture was a basic account with `balance: 0`. This is not stake:
active, inactive, and retired stake must come from the staker read.

## Pagination

`getTransactionsByAddress` was called as `[address, 3, null]`, then again with the
first page's first transaction hash as `startAt`. The first page was newest-first.
The second page began with the next older transaction and did not contain the
cursor hash, confirming that `startAt` is an exclusive transaction-hash cursor.

The protocol/source audit also establishes these semantics:

- `max` is optional, defaults to 500, and is bounded by the RPC `u16` range.
- Results are newest to oldest.
- An unknown cursor or a cursor belonging to another address returns an empty list.
- Pagination is cursor-based, not block-number-based.

The probe does not assume a page is complete merely because it has fewer than
`max` records; callers should stop on an empty page or exhausted history.

## Errors And Limits

The live endpoint returned JSON-RPC errors in an HTTP 200 response. Observed error
envelopes include:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "No staker with address: ..."
  },
  "id": 1
}
```

The static/live integration audit also observed:

- Missing transaction: `-32603`, `Internal error`, with `data` beginning `Transaction not found:`.
- Invalid parameters: `-32602`, `Invalid params`, with detail in `data`.
- Normal low-rate calls: HTTP 200 with no `Retry-After` header.

No controlled rate-limit burst was run. No HTTP 429 or upstream retry policy was
verified, so production retry, caching, rate limiting, and a second source remain
P1/P3 work. This probe is intentionally not the production RPC client.

## Verdict And Gaps

The RPC exposes the fields needed to read active, inactive, and retired balances
for a known staker, and a prior mainnet read confirmed that positive staker shape.
This checked-in capture intentionally includes the no-staker path, but does not
claim a complete lifecycle matrix. The RPC `Staker` response does not expose an
inactive-release timestamp or an equivalent withdrawable height. Therefore
`Withdrawable` timing cannot be derived safely from this read surface, and no
countdown should be implemented from `inactiveFrom` alone.

The restake verdict is **partially supported for known stakers, not yet reliable
enough for a complete v1 lifecycle claim**: balance and delegation fields are
readable, but this capture does not prove consistency across active, inactive,
retired, and withdrawable states or across election boundaries. P1-05/P3-02 must
keep the missing-state limitation explicit and may use direct-payout monitoring as
the fallback.

Unresolved gaps:

- The configured testnet hostname `rpc.testnet.nimiq.com` did not resolve from this
  workspace, so no testnet fixture or testnet field-parity result is claimed.
- No real inactive, retired, or withdrawable testnet staker was available for
  capture; those fixture names remain intentionally absent.
- No device or Nimiq Pay run was performed. Device behavior belongs to P0-02/P0-03,
  including the provider version, staking lifecycle, and testnet account state.
- No controlled HTTP 429/rate-limit experiment was performed.
- Repeated reads across election boundaries and an explicit withdrawal deadline
  remain unverified.

The fixture shape/sanity test is `tests/unit/server/rpc-fixtures.test.ts` and never
uses the live network.
