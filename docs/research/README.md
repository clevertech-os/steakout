# Research templates

Manual + chain-assisted research for Steakout. **Registry declaration** values live here; **live observed floors** are also computed in production from the SQLite index.

## Min payout amounts

| File | Role |
|---|---|
| [`min-payout-amounts.json`](min-payout-amounts.json) | Source of truth for curated rows |
| [`min-payout-amounts.csv`](min-payout-amounts.csv) | Spreadsheet edit |
| `server/config/min-payout-declarations.json` | **Runtime copy** loaded by the API (must ship with deploys) |

Optional snapshot fields on each row (not served as live chain stats — production recomputes those):

- `observedMinNim` / `observedP5Nim` / `observedSampleSize` / `observedCheckedAt` / `observedSource`

### What “min payout” means

**Minimum payout** = threshold before a pool pays a staker (fixed NIM, none, stake-based, or N/A).

**Not** the protocol minimum stake (**100 NIM**).

### Labels

| Product field | Status tag | Source |
|---|---|---|
| Min payout (declared) | Registry declaration | This sheet → `server/config/min-payout-declarations.json` |
| Observed floor (p5) | Inferred | Live index: reward-address outflows (`paymentFloor.ts`) |

### `minPayoutKind` values

| Value | Meaning |
|---|---|
| `fixed` | Fixed NIM threshold → set `minPayoutNim` |
| `none` | No minimum / effective none |
| `stake-based` | Depends on stake size |
| `not_applicable` | No rewards paid |
| `unknown` | Not enough evidence |

### How to get the **latest** chain floors (production)

Production SQLite is on Railway (`steakout` service, volume `/data`, ~1.4M+ txs). Prefer **p5** over absolute min (dust under a hard floor, e.g. Pocket).

**Option A — server script (after deploy includes it):**

```bash
# SSH into production and run against the live volume
railway ssh --service steakout -- bash -lc \
  'DATA_DIR=/data node --import tsx server/scripts/min-payout-inference.ts'
```

**Option B — one-shot analysis (no new deploy):**

```bash
# From a machine with railway CLI linked to project "steakout"
railway ssh --service steakout -- bash -lc 'python3 -' < /tmp/your-analysis.py
```

See method details in [`docs/spikes/min-payout-inference.md`](../spikes/min-payout-inference.md).  
Last export: [`docs/spikes/local/min-payout-railway-2026-08-05.json`](../spikes/local/min-payout-railway-2026-08-05.json).

**Option C — local (thin DB only):**

```bash
DATA_DIR=./server/data npm run min-payout-inference --prefix server
```

### After updating this sheet

1. Edit JSON (or CSV, then convert) — keep JSON and CSV in sync.
2. Copy into runtime config:

```bash
cp docs/research/min-payout-amounts.json server/config/min-payout-declarations.json
```

3. Deploy so Railway picks up the new config (declarations are file-based, not DB).
4. Live **observed floor** does **not** require a sheet update — it refreshes from indexed `transactions` in the running app.

### Source priority for sheet `minPayoutKind`

1. Operator website / FAQ (high confidence)
2. Registry `payoutSchedule` text with explicit threshold
3. Strong chain floor (p5), medium confidence, note `chain:reward-outflows` in `sourceUrl` / notes
4. Leave `unknown` if thin sample or few recipients

Never invent. Prefer dual UI: sheet declaration + live observed p5.
