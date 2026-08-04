# Probe-stakes account toolkit

Local ops scripts to support **canary / probe staking**: one NIM address per validator, funded from a treasury you control, tracked in CSV/JSON so you can later validate payouts.

This is **not** part of the Steakout product server. Keys never go to Railway, Steakout API, or git.

## Run it yourself (recommended)

So an AI agent (or chat) never sees private keys, balances, or tx hashes, run these in **your own terminal**.

### Official wallet cannot export a private key?

That’s normal. Generate a **dedicated treasury** with the script, then send NIM to it from the official wallet:

```bash
# from the steakout repo root
npm run probe:treasury
```

It prints a **public** `NQ…` address and writes:

| File | Contents |
|---|---|
| `probe-data/treasury.public.json` | Public address only (safe to open) |
| `probe-data/treasury.private-key.hex` | Private key (`chmod 600`) — never commit or paste into chat |

Then in the official Nimiq Wallet: **Send** NIM → that public address (e.g. 24 000 + buffer for 1000 NIM × 24 probes).

Then run the full wizard (reuses the treasury file):

```bash
npm run probe:wizard
```

### Full pipeline (1 → 2 → 3)

| Step | Command | What happens |
|---|---|---|
| 0 (if needed) | `npm run probe:treasury` | Create treasury address; send NIM from official wallet |
| **1 Create** | (wizard or `create`) | One basic account per listed validator → roster + secrets |
| **2 Fund** | (wizard or `fund`) | Treasury → each probe (dry-run, then `BROADCAST`) |
| **3 Stake** | (wizard or `npm run probe:stake`) | Each probe stakes to its mapped validator (dry-run, then type `STAKE`) |

After step 3, public `roster.csv` / `roster.json` is enough to build site-side monitoring (no secrets required for reads).

### Site monitoring (public roster)

The production app loads **public** probe metadata from:

`server/config/probe-roster.public.json`

That file is committed (addresses + stake metadata only — **no private keys**). After recreating probes, refresh it:

```bash
node --input-type=module -e "
import { readFile, writeFile } from 'fs/promises';
const r = JSON.parse(await readFile('./probe-data/roster.json','utf8'));
const out = {
  version: 1,
  kind: 'steakout-probe-roster-public',
  batchId: r.batchId,
  network: r.network ?? 'main',
  createdAt: r.createdAt,
  description: 'Steakout canary probe stakes — public addresses only. No private keys.',
  probes: r.accounts.map((a) => ({
    probeId: a.probeId,
    probeAddress: a.probeAddress,
    probeAddressCompact: a.probeAddressCompact,
    validatorName: a.validatorName,
    validatorAddress: a.validatorAddress,
    validatorAddressCompact: a.validatorAddressCompact,
    declaredFee: a.declaredFee,
    payoutType: a.payoutType,
    payoutSchedule: a.payoutSchedule,
    stakeAmountNim: a.stakeAmountNim,
    stakeAmountLuna: a.stakeAmountLuna != null ? Number(a.stakeAmountLuna) : null,
    stakedAt: a.stakedAt,
    stakeTxHash: a.stakeTxHash,
  })),
};
await writeFile('./server/config/probe-roster.public.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote', out.probes.length, 'probes');
"
```

Validator list cards show a **Canary** chip; profiles show a **Probe monitoring** section with pending fields until the indexer records payments / staker snapshots.

### Wizard steps

1. Create probes (or reuse roster)
2. Generate or reuse treasury; wait for funding if needed
3. Fund dry-run → optional `BROADCAST`
4. Stake dry-run → optional `STAKE`
5. Optional status (free balance + staked + delegation)

Do **not** paste `secrets.json`, treasury keys, or wizard output into chat.

### Stake only (after fund)

```bash
# dry-run (default): stake almost all free balance, leave 1 NIM
node scripts/probe-stakes/probe-accounts.mjs stake --out-dir ./probe-data

# for real
node scripts/probe-stakes/probe-accounts.mjs stake --out-dir ./probe-data --broadcast
```

---

## What kind of accounts are these?

| Question | Answer |
|---|---|
| Account type | **Basic** Nimiq address (Schnorr `KeyPair.generate()` via `@nimiq/core`) |
| Same as… | A normal Nimiq Wallet / Hub **basic** address |
| Not | Validator operator keys, vesting contracts, HTLC, multi-sig, seed-phrase wallets |
| Why one per validator? | Nimiq allows **one active validator delegation per address** |
| Staked after create? | **No** — create only generates empty addresses; fund then stake separately |

Private keys are 32-byte hex (64 hex chars). There is no BIP-39 seed phrase in this tool.

## Files written (`--out-dir`, default `./probe-data`)

| File | Contains secrets? | Purpose |
|---|---|---|
| `roster.json` | **No** | Full tracking record (addresses, validator mapping, fund/stake status) |
| `roster.csv` | **No** | Same rows for spreadsheets |
| `secrets.json` | **YES** | Private keys per probe (`chmod 600`) — backup offline, never commit |
| `fund-plan.json` | No (hashes only) | Dry-run or broadcast log for the fund step |

`probe-data/` is gitignored at the repo root.

## Prerequisites

- Node.js ≥ 22
- Repo dependencies installed (`npm install` at repo root so `@nimiq/core` resolves)
- Network access for create (Steakout API) and fund/status (Nimiq RPC)

## 1. Create accounts

Pulls the listed validator catalog from Steakout and generates one basic account each:

```bash
node scripts/probe-stakes/probe-accounts.mjs create --out-dir ./probe-data
```

Useful flags:

```bash
# Testnet catalog + test network id (only if you use testnet RPC later)
node scripts/probe-stakes/probe-accounts.mjs create --out-dir ./probe-data-test --network test

# Include unlisted observable validators (larger set)
node scripts/probe-stakes/probe-accounts.mjs create --out-dir ./probe-data --all-observable

# Point at a local Steakout API
node scripts/probe-stakes/probe-accounts.mjs create --api http://127.0.0.1:3000 --out-dir ./probe-data
```

Re-running `create` refuses to overwrite unless you pass `--force` (that destroys the previous key set if you have not backed up `secrets.json`).

### Roster columns (CSV / JSON)

Public tracking fields include:

- `probe_id`, `probe_address`, `probe_address_compact`
- `account_type` (`basic`), `network`
- `validator_name`, `validator_address`, declared fee / payout type / schedule
- `fund_status`, `fund_amount_nim`, `fund_tx_hash`, `funded_at`
- `stake_status` (filled manually or by a later tool; starts as `not-staked`)

## 2. Fund accounts (move X NIM from treasury → each probe)

### Prepare the treasury key (you control this)

The treasury is a **basic account** whose private key you already have (or a new one you fund first from an exchange/wallet).

Create a local file (never commit it):

```bash
# treasury.private-key.hex — single line, 64 hex chars, no 0x prefix
printf '%s\n' 'YOUR_64_CHAR_PRIVATE_KEY_HEX' > ./treasury.private-key.hex
chmod 600 ./treasury.private-key.hex
```

Or export:

```bash
export PROBE_TREASURY_PRIVATE_KEY='YOUR_64_CHAR_PRIVATE_KEY_HEX'
```

### Dry-run first (default)

Plans transfers of **1000 NIM to every probe**, checks treasury balance, writes `fund-plan.json`, updates roster statuses to `planned`. **Does not broadcast.**

```bash
node scripts/probe-stakes/probe-accounts.mjs fund \
  --out-dir ./probe-data \
  --amount-nim 1000 \
  --treasury-key-file ./treasury.private-key.hex
```

Review:

- Treasury address printed by the script matches the wallet you funded
- Total NIM required = `amount × probe_count` (+ fees)
- `probe-data/fund-plan.json` transfer list

### Broadcast for real

Same command plus **`--broadcast`**:

```bash
node scripts/probe-stakes/probe-accounts.mjs fund \
  --out-dir ./probe-data \
  --amount-nim 1000 \
  --treasury-key-file ./treasury.private-key.hex \
  --broadcast
```

Other fund options:

| Flag | Meaning |
|---|---|
| `--fee-luna 0` | Per-tx fee in Luna (default 0) |
| `--skip-funded` | Skip probes already marked `fundStatus=broadcast` |
| `--delay-ms 750` | Pause between RPC sends |
| `--rpc <url>` | Override RPC (default main: `https://rpc.nimiqwatch.com`) |
| `--network test` | Use testnet network id + default test RPC |

## 3. Check balances

```bash
node scripts/probe-stakes/probe-accounts.mjs status --out-dir ./probe-data
```

## 4. Stake (not automated here)

After funding, each probe still has a plain balance. Staking must attach that address to its **assigned validator** in the roster:

1. Import the probe private key into a wallet you trust **or** sign `createStaker` txs offline with a follow-up script.
2. Stake only to the mapped `validator_address` for that `probe_id`.
3. Update `stake_status` / notes in the roster when done.

Staking is intentionally separate so fund distribution stays simple and reviewable.

## Security checklist

- [ ] `probe-data/secrets.json` and treasury key files are **outside git** and backed up offline
- [ ] Never paste private keys into chat, tickets, or Steakout
- [ ] Always dry-run `fund` before `--broadcast`
- [ ] Confirm treasury address and total NIM before broadcasting
- [ ] After the experiment, rotate/empty probes if keys may have been exposed

## How this ties to fee / payout validation later

1. **Create** → known `probe_address` ↔ `validator_address` map  
2. **Fund** → known starting balance per probe  
3. **Stake** → each probe earns only from its assigned validator  
4. **Observe** → Steakout indexer + personal continuity / explorer receipts vs declared fee and schedule  

That path measures **your** deal with each pool without classifying every pool outflow.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Refusing to overwrite` | Roster already exists; use a new `--out-dir` or `--force` after backup |
| `Treasury private key not found` | Missing file/env; key not 64 hex chars |
| `Treasury balance … less than required` | Fund treasury first, or lower `--amount-nim` / probe count |
| RPC errors / 429 | Public RPC rate limit; retry with higher `--delay-ms` |
| Address mismatch on fund | `secrets.json` does not match `roster.json` (do not hand-edit one without the other) |

## Help

```bash
node scripts/probe-stakes/probe-accounts.mjs --help
```
