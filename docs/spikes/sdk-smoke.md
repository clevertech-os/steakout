# Mini App SDK Smoke Report

**Task:** P0-02
**Status:** Implementation complete; device verification pending
**Capture date:** 2026-08-02

This report is the evidence template for the guarded `/spike` route. It deliberately separates
local/package evidence from observations that require Nimiq Pay on a testnet device.

## Verified Locally

| Field | Result | Evidence |
|---|---|---|
| SDK dependency | `@nimiq/mini-app-sdk` `^0.1.0`, lockfile resolves `0.1.0` | `client/package.json`, `package-lock.json` |
| Route guard | Enabled in development; production requires `VITE_ENABLE_SDK_SPIKE=true` | `client/src/App.tsx` |
| Provider warmup | `init({ timeout: 10000 })` | `client/src/spike/SdkSmoke.tsx` |
| Fixed challenge | `Steakout SDK smoke challenge 2026-08-02` | `client/src/spike/SdkSmoke.tsx` |
| Signature mode | `sign({ message: SDK_SMOKE_CHALLENGE, isHex: false })` | `client/src/spike/SdkSmoke.tsx` |
| Server probe | `POST ${NIMIQ_RPC_URL}` with `getBlockNumber`, `params: []`, `id: 1` | `server/src/nimiq-rpc.ts` |
| Probe endpoint | `GET /api/spike/block-number` | `server/src/app.ts` |
| Live RPC helper check | Mainnet endpoint returned block `57873285` during verification; testnet endpoint in `.env.example` did not resolve | Manual verification, 2026-08-03 UTC |

## Device Results

Complete these fields from a run inside Nimiq Pay testnet. Do not enter private keys, seed phrases,
or any other secret. The account address, public key, and signature are public cryptographic data,
but should still be redacted if this report is shared outside the project.

| Field | Result | Status |
|---|---|---|
| Device OS/model | _pending_ | Unverified |
| Nimiq Pay app version | _pending_ | Unverified |
| SDK version in shipped app | _pending_ | Unverified |
| Network | _pending_ | Unverified |
| Provider injected? | _pending_ | Unverified |
| `connect()` result | _pending_ | Unverified |
| `listAccounts()` result and exact address format | _pending_ | Unverified |
| Fixed challenge signed | _pending_ | Unverified |
| `sign()` result shape | _pending_ | Unverified |
| Server block number | _pending_ | Unverified |
| Probe latency | _pending_ | Unverified |
| Connect/sign cancel behavior | _pending_ | Unverified |
| Screenshots | _pending_ | Unverified |

## Signature Fixture

No signature fixture is included yet. There is no Nimiq Pay device session available in this
workspace, so creating a fixture would manufacture evidence. When a safe device run is available,
save only this non-secret shape under `tests/fixtures/wallet/`:

```json
{
  "address": "<testnet account address>",
  "message": "Steakout SDK smoke challenge 2026-08-02",
  "isHex": false,
  "signature": "<provider signature>",
  "publicKey": "<provider public key>"
}
```

Add capture metadata for the device, Pay version, SDK version, network, timestamp, and redaction
policy. Never add private keys or seed phrases.

## Verification Commands

```bash
npm run build
npm test
```

Manual verification remains pending: open `/spike` inside Nimiq Pay testnet with the spike flag
enabled, run the check, and copy the exact displayed results into the device table above.
