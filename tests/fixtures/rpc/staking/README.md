# Staking method RPC fixtures (P0-03)

Placeholders for **confirmed** staking transactions captured after a real Nimiq Pay **testnet** device run of the harness at `/spike/staking-methods`.

## Rules

- **Do not invent fixtures.** Only add files after a device run produces a chain-visible tx hash.
- Prefer raw `getTransactionByHash` JSON-RPC envelopes (same shape as `tests/fixtures/rpc/p0-04-transaction-by-hash-mainnet.json`).
- Sanitize: no private keys, seeds, or mnemonics. User addresses may be redacted to deterministic `NQ00…` test forms if not required for matcher tests; validator addresses are public and may remain.
- Record network (`testnet`), capture date, RPC endpoint, and method name in `_meta.json`.
- One file per working provider method when possible:

| Suggested filename | Provider method |
|---|---|
| `send-new-staker-transaction.json` | `sendNewStakerTransaction` |
| `send-stake-transaction.json` | `sendStakeTransaction` |
| `send-set-active-stake-transaction.json` | `sendSetActiveStakeTransaction` |
| `send-update-staker-transaction.json` | `sendUpdateStakerTransaction` |
| `send-retire-stake-transaction.json` | `sendRetireStakeTransaction` |
| `send-remove-stake-transaction.json` | `sendRemoveStakeTransaction` |

## Capture checklist (after device)

1. From harness report: classification + derived/direct hash.
2. Call testnet RPC `getTransactionByHash` with that hash.
3. Save full response JSON as `<method-file>.json`.
4. Append an entry under `captures` in `_meta.json`.
5. Reference the hash + fixture path in `docs/spikes/staking-methods.md`.

## Status

No device captures yet. `_meta.json` is a template only.
