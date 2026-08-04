#!/usr/bin/env node
/**
 * Probe-stakes account toolkit
 * ----------------------------
 * Create one basic Nimiq account per listed validator, track them in
 * roster JSON/CSV, and optionally fund them from a treasury key you control.
 *
 * Account type: basic Ed25519/Schnorr keypair accounts (same as a normal
 * Nimiq Wallet / Hub basic address). NOT validators, vesting, HTLC, or
 * multi-sig. Each address can later stake to exactly one validator.
 *
 * This is an offline ops tool. It is NOT part of the Steakout product API
 * and never runs inside the server. Private keys stay on your machine only.
 *
 * Usage (run in YOUR terminal so keys never appear in chat):
 *   npm run probe:wizard
 *   node scripts/probe-stakes/probe-accounts.mjs wizard
 *
 * Non-interactive:
 *   node scripts/probe-stakes/probe-accounts.mjs create --out-dir ./probe-data
 *   node scripts/probe-stakes/probe-accounts.mjs fund \
 *     --out-dir ./probe-data \
 *     --treasury-key-file ./treasury.private-key.hex \
 *     --amount-nim 1000
 *   node scripts/probe-stakes/probe-accounts.mjs fund ... --broadcast
 *   node scripts/probe-stakes/probe-accounts.mjs status --out-dir ./probe-data
 *
 * See scripts/probe-stakes/README.md for the full walkthrough.
 */

import { randomBytes } from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { dirname, join, resolve } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  Address,
  KeyPair,
  PrivateKey,
  TransactionBuilder,
} from '@nimiq/core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

/** 1 NIM = 100_000 Luna (protocol constant). */
const LUNA_PER_NIM = 100_000n

/** Nimiq Albatross network ids (observed on mainnet txs: 24). */
const NETWORK_IDS = {
  main: 24,
  test: 5,
}

const DEFAULT_API = 'https://steakout-production.up.railway.app'
const DEFAULT_RPC_MAIN = 'https://rpc.nimiqwatch.com'
const DEFAULT_RPC_TEST = 'https://rpc.nimiq-testnet.com'

const ROSTER_JSON = 'roster.json'
const ROSTER_CSV = 'roster.csv'
const SECRETS_JSON = 'secrets.json'
const FUND_PLAN_JSON = 'fund-plan.json'
const TREASURY_KEY_FILE = 'treasury.private-key.hex'
const TREASURY_PUBLIC_JSON = 'treasury.public.json'
const STAKE_PLAN_JSON = 'stake-plan.json'

/** Protocol minimum stake (100 NIM). */
const MIN_STAKE_LUNA = 100n * LUNA_PER_NIM
/** Default free balance left on each probe after staking (covers future dust/fees). */
const DEFAULT_LEAVE_LUNA = 1n * LUNA_PER_NIM

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Steakout probe-stakes toolkit

★ Prefer the wizard in YOUR own terminal (I never see the output):
  npm run probe:wizard
  node scripts/probe-stakes/probe-accounts.mjs wizard

Commands (1 → 2 → 3):
  wizard             Interactive full pipeline
  generate-treasury  (prep) New basic treasury key + public address
  create             1) One basic probe account per listed validator
  fund               2) Send NIM from treasury → each probe
  stake              3) Stake each probe to its mapped validator
  status             Read balances + staker state (RPC)

Typical flow when the official wallet cannot export a private key:
  0. generate-treasury  → public NQ… address + local key file
  1. create             → 24 probe accounts + roster
  2. Send NIM from official wallet → treasury, then fund probes
  3. stake              → createStaker + delegate to each validator

Common options:
  --out-dir <path>     Working directory for roster/secrets (default: ./probe-data)
  --network main|test  Network for addresses/txs (default: main)
  --quiet              Less per-probe log noise on fund
  --help               Show this help

create options:
  --api <url>          Steakout API base (default: ${DEFAULT_API})
  --listed-only        Only listed validators (default: true)
  --all-observable     Include unlisted observable validators
  --force              Overwrite existing roster/secrets (dangerous)

generate-treasury options:
  --force              Overwrite existing treasury key files in --out-dir
  --show-private-key   Also print private key to the terminal (default: no —
                       key is only written to treasury.private-key.hex)

fund options:
  --amount-nim <n>     NIM to send to EACH probe (required)
  --treasury-key-file  File containing treasury private key hex (64 hex chars)
  --treasury-key-env   Env var name holding treasury private key hex
                       (default if neither file/env set: PROBE_TREASURY_PRIVATE_KEY)
  --fee-luna <n>       Per-tx fee in Luna (default: 0)
  --rpc <url>          Nimiq JSON-RPC URL
  --delay-ms <n>       Pause between broadcasts (default: 750)
  --dry-run            Build plan only; do not broadcast (DEFAULT)
  --broadcast          Actually send transactions (requires explicit flag)
  --skip-funded        Skip probes that already have fundStatus=broadcast

stake options:
  --amount-nim <n>     Stake this much per probe (default: almost all free balance)
  --leave-nim <n>      NIM to leave unstaked on each probe (default: 1)
  --fee-luna <n>       Per-tx fee in Luna (default: 0)
  --skip-staked        Skip probes already stakeStatus=broadcast
  --dry-run / --broadcast   Same safety model as fund

status options:
  --rpc <url>          Nimiq JSON-RPC URL

Security:
  - Run wizard/create/fund/stake in your local terminal — do not ask an agent to run them.
  - secrets.json holds private keys. It is chmod 600 and must never be committed.
  - fund/stake default to dry-run. Pass --broadcast only after reviewing the plan file.
  - Steakout product code never sees these keys.
`)
}

function parseArgs(argv) {
  const args = {
    command: null,
    outDir: resolve(process.cwd(), 'probe-data'),
    network: 'main',
    api: DEFAULT_API,
    listedOnly: true,
    force: false,
    amountNim: null,
    leaveNim: '1',
    treasuryKeyFile: null,
    treasuryKeyEnv: 'PROBE_TREASURY_PRIVATE_KEY',
    feeLuna: 0n,
    rpc: null,
    delayMs: 2_000,
    dryRun: true,
    broadcast: false,
    skipFunded: false,
    skipStaked: false,
    quiet: false,
    showPrivateKey: false,
    help: false,
  }

  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    if (token === '--force') {
      args.force = true
      continue
    }
    if (token === '--listed-only') {
      args.listedOnly = true
      continue
    }
    if (token === '--all-observable') {
      args.listedOnly = false
      continue
    }
    if (token === '--dry-run') {
      args.dryRun = true
      args.broadcast = false
      continue
    }
    if (token === '--broadcast') {
      args.broadcast = true
      args.dryRun = false
      continue
    }
    if (token === '--skip-funded') {
      args.skipFunded = true
      continue
    }
    if (token === '--skip-staked') {
      args.skipStaked = true
      continue
    }
    if (token === '--quiet') {
      args.quiet = true
      continue
    }
    if (token === '--show-private-key') {
      args.showPrivateKey = true
      continue
    }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = argv[i + 1]
      if (value == null || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`)
      }
      i += 1
      switch (key) {
        case 'out-dir':
          args.outDir = resolve(process.cwd(), value)
          break
        case 'network':
          if (value !== 'main' && value !== 'test') {
            throw new Error('--network must be main or test')
          }
          args.network = value
          break
        case 'api':
          args.api = value.replace(/\/$/, '')
          break
        case 'amount-nim':
          args.amountNim = value
          break
        case 'leave-nim':
          args.leaveNim = value
          break
        case 'treasury-key-file':
          args.treasuryKeyFile = resolve(process.cwd(), value)
          break
        case 'treasury-key-env':
          args.treasuryKeyEnv = value
          break
        case 'fee-luna':
          args.feeLuna = BigInt(value)
          break
        case 'rpc':
          args.rpc = value
          break
        case 'delay-ms':
          args.delayMs = Number(value)
          break
        default:
          throw new Error(`Unknown option --${key}`)
      }
      continue
    }
    positional.push(token)
  }

  args.command = positional[0] ?? null
  if (!args.rpc) {
    args.rpc = args.network === 'test' ? DEFAULT_RPC_TEST : DEFAULT_RPC_MAIN
  }
  return args
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function networkId(network) {
  return NETWORK_IDS[network]
}

function nimToLuna(nimString) {
  const trimmed = String(nimString).trim()
  if (!/^\d+(\.\d{1,5})?$/.test(trimmed)) {
    throw new Error(
      `Invalid NIM amount "${nimString}". Use a non-negative number with up to 5 decimals.`,
    )
  }
  const [whole, frac = ''] = trimmed.split('.')
  const fracPadded = (frac + '00000').slice(0, 5)
  return BigInt(whole) * LUNA_PER_NIM + BigInt(fracPadded)
}

function lunaToNimString(luna) {
  const negative = luna < 0n
  const abs = negative ? -luna : luna
  const whole = abs / LUNA_PER_NIM
  const frac = abs % LUNA_PER_NIM
  const fracStr = frac.toString().padStart(5, '0').replace(/0+$/, '')
  const body = fracStr ? `${whole}.${fracStr}` : `${whole}`
  return negative ? `-${body}` : body
}

function compactAddress(address) {
  return address.replace(/\s+/g, '').toUpperCase()
}

function csvEscape(value) {
  if (value == null) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Format Nimiq JSON-RPC errors. Public nodes often return:
 *   message: "Internal error", data: "No staker with address: NQ…"
 * so we must include `data` (matches server/src/nimiq-rpc.ts formatRpcError).
 */
function formatRpcErrorBody(error) {
  const message =
    error && typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'Nimiq RPC error'
  const data =
    error && typeof error.data === 'string' && error.data.trim()
      ? error.data.trim()
      : ''
  if (!data || message.toLowerCase().includes(data.toLowerCase())) return message
  return `${message}: ${data}`
}

function isStakerNotFoundMessage(message) {
  return /no staker with address/i.test(message)
}

function isRetriableRpcMessage(message) {
  return (
    /RPC HTTP 429/i.test(message) ||
    /RPC HTTP 503/i.test(message) ||
    /RPC HTTP 502/i.test(message) ||
    /too many requests/i.test(message) ||
    /rate limit/i.test(message) ||
    /timeout/i.test(message) ||
    /ECONNRESET|fetch failed|network/i.test(message)
  )
}

/**
 * Single RPC attempt. Throws Error with method context.
 */
async function rpcCallOnce(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after')
    const suffix = retryAfter ? ` retry-after=${retryAfter}` : ''
    throw new Error(`RPC HTTP ${response.status} for ${method}${suffix}`)
  }
  const payload = await response.json()
  if (payload.error) {
    throw new Error(
      `RPC ${method} error: ${formatRpcErrorBody(payload.error)}`,
    )
  }
  // Albatross RPC wraps results as { data, metadata } or returns bare values.
  const result = payload.result
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'data' in result
  ) {
    return result.data
  }
  return result
}

/**
 * RPC with retries on 429 / transient failures (public nodes rate-limit hard).
 */
async function rpcCall(rpcUrl, method, params = [], options = {}) {
  const maxAttempts = options.maxAttempts ?? 8
  let delayMs = options.initialDelayMs ?? 1_500
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await rpcCallOnce(rpcUrl, method, params)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= maxAttempts || !isRetriableRpcMessage(message)) {
        throw error instanceof Error ? error : new Error(message)
      }
      // Honor Retry-After seconds if present
      const retryAfterMatch = message.match(/retry-after=(\d+)/i)
      const waitMs = retryAfterMatch
        ? Math.max(Number(retryAfterMatch[1]) * 1000, delayMs)
        : delayMs
      if (options.verbose) {
        console.warn(
          `  … ${method} attempt ${attempt}/${maxAttempts} failed (${message}); retry in ${waitMs}ms`,
        )
      }
      await sleep(waitMs)
      delayMs = Math.min(Math.floor(delayMs * 1.7), 60_000)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchListedValidators(apiBase, listedOnly) {
  const url = `${apiBase}/api/validators?listed=${listedOnly ? 'true' : 'false'}&sort=recommended`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Steakout API HTTP ${response.status}: ${url}`)
  }
  const payload = await response.json()
  const validators = payload?.data?.validators
  if (!Array.isArray(validators) || validators.length === 0) {
    throw new Error('Steakout API returned no validators')
  }
  const filtered = listedOnly
    ? validators.filter((v) => v.isListed === true)
    : validators
  if (filtered.length === 0) {
    throw new Error('No validators matched the listed filter')
  }
  return filtered
}

function generateBasicAccount() {
  // Basic account = Schnorr KeyPair.generate() → public key address.
  // Same account type as a standard Nimiq Wallet basic address.
  const keyPair = KeyPair.generate()
  const addressSpaced = keyPair.publicKey.toAddress().toUserFriendlyAddress()
  const privateKeyHex = keyPair.privateKey.toHex()
  const publicKeyHex = keyPair.publicKey.toHex()
  return {
    addressSpaced,
    addressCompact: compactAddress(addressSpaced),
    privateKeyHex,
    publicKeyHex,
    accountType: 'basic',
  }
}

function keyPairFromPrivateHex(hex) {
  const clean = hex.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(
      'Private key must be 64 hex characters (32 bytes). No seed phrases here.',
    )
  }
  return KeyPair.derive(PrivateKey.fromHex(clean))
}

function rosterPaths(outDir) {
  return {
    rosterJson: join(outDir, ROSTER_JSON),
    rosterCsv: join(outDir, ROSTER_CSV),
    secretsJson: join(outDir, SECRETS_JSON),
    fundPlanJson: join(outDir, FUND_PLAN_JSON),
    stakePlanJson: join(outDir, STAKE_PLAN_JSON),
    treasuryKeyFile: join(outDir, TREASURY_KEY_FILE),
    treasuryPublicJson: join(outDir, TREASURY_PUBLIC_JSON),
  }
}

function buildCsv(accounts) {
  const headers = [
    'probe_id',
    'probe_address',
    'probe_address_compact',
    'account_type',
    'network',
    'validator_name',
    'validator_address',
    'validator_address_compact',
    'is_listed',
    'declared_fee',
    'payout_type',
    'payout_schedule',
    'created_at',
    'fund_status',
    'fund_amount_nim',
    'fund_tx_hash',
    'funded_at',
    'stake_status',
    'stake_amount_nim',
    'stake_tx_hash',
    'staked_at',
    'notes',
  ]
  const lines = [headers.join(',')]
  for (const row of accounts) {
    lines.push(
      [
        row.probeId,
        row.probeAddress,
        row.probeAddressCompact,
        row.accountType,
        row.network,
        row.validatorName,
        row.validatorAddress,
        row.validatorAddressCompact,
        row.isListed,
        row.declaredFee,
        row.payoutType,
        row.payoutSchedule,
        row.createdAt,
        row.fundStatus,
        row.fundAmountNim,
        row.fundTxHash,
        row.fundedAt,
        row.stakeStatus,
        row.stakeAmountNim ?? '',
        row.stakeTxHash ?? '',
        row.stakedAt ?? '',
        row.notes,
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

async function getAccountBalanceLuna(rpcUrl, address) {
  const account = await rpcCall(rpcUrl, 'getAccountByAddress', [address])
  return BigInt(account?.balance ?? 0)
}

/**
 * Returns staker object or null if not found.
 * Public RPC returns HTTP 200 + error:
 *   { message: "Internal error", data: "No staker with address: NQ…" }
 * After formatRpcErrorBody that becomes "Internal error: No staker with address: …"
 */
async function getStakerOrNull(rpcUrl, address) {
  try {
    const staker = await rpcCall(rpcUrl, 'getStakerByAddress', [address])
    if (staker && typeof staker === 'object') return staker
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isStakerNotFoundMessage(message)) return null
    // Some nodes only say Internal error without data — for brand-new probe
    // addresses treat as no staker only when the free account still has type basic
    // and we already know this is a first-time stake path. Prefer explicit data.
    if (/internal error/i.test(message) && /staker/i.test(message)) return null
    throw error
  }
}

async function writeRosterArtifacts(outDir, roster, secrets) {
  const paths = rosterPaths(outDir)
  await mkdir(outDir, { recursive: true })
  await writeFile(paths.rosterJson, `${JSON.stringify(roster, null, 2)}\n`, 'utf8')
  await writeFile(paths.rosterCsv, buildCsv(roster.accounts), 'utf8')
  if (secrets) {
    await writeFile(paths.secretsJson, `${JSON.stringify(secrets, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    // Mode in writeFile is not always applied on all platforms; force chmod.
    await chmod(paths.secretsJson, 0o600)
  }
  return paths
}

async function loadRoster(outDir) {
  const paths = rosterPaths(outDir)
  if (!(await pathExists(paths.rosterJson))) {
    throw new Error(`Missing ${paths.rosterJson}. Run create first.`)
  }
  const roster = JSON.parse(await readFile(paths.rosterJson, 'utf8'))
  return { roster, paths }
}

async function loadSecrets(outDir) {
  const paths = rosterPaths(outDir)
  if (!(await pathExists(paths.secretsJson))) {
    throw new Error(`Missing ${paths.secretsJson}. Run create first.`)
  }
  return JSON.parse(await readFile(paths.secretsJson, 'utf8'))
}

async function loadTreasuryKey(args) {
  if (args.treasuryKeyFile) {
    const raw = (await readFile(args.treasuryKeyFile, 'utf8')).trim()
    return keyPairFromPrivateHex(raw)
  }
  const fromEnv = process.env[args.treasuryKeyEnv]
  if (fromEnv?.trim()) {
    return keyPairFromPrivateHex(fromEnv)
  }
  throw new Error(
    `Treasury private key not found. Pass --treasury-key-file <path> or set ${args.treasuryKeyEnv}.`,
  )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Generate a dedicated basic treasury account.
 * Official Nimiq Wallet typically cannot export private-key hex — so create a
 * key here, send NIM to the public address from the wallet, then fund probes.
 * Does NOT print the private key unless --show-private-key.
 */
async function commandGenerateTreasury(args) {
  const paths = rosterPaths(args.outDir)
  await mkdir(args.outDir, { recursive: true })

  if (
    !args.force &&
    ((await pathExists(paths.treasuryKeyFile)) ||
      (await pathExists(paths.treasuryPublicJson)))
  ) {
    throw new Error(
      `Treasury files already exist in ${args.outDir}. Backup first, then pass --force to replace.`,
    )
  }

  const generated = generateBasicAccount()
  const createdAt = new Date().toISOString()

  await writeFile(paths.treasuryKeyFile, `${generated.privateKeyHex}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await chmod(paths.treasuryKeyFile, 0o600)

  const publicMeta = {
    version: 1,
    kind: 'steakout-probe-treasury-public',
    WARNING:
      'PUBLIC only. Private key is in treasury.private-key.hex — never commit either.',
    accountType: 'basic',
    network: args.network,
    networkId: networkId(args.network),
    createdAt,
    address: generated.addressSpaced,
    addressCompact: generated.addressCompact,
    publicKeyHex: generated.publicKeyHex,
    keyFile: TREASURY_KEY_FILE,
    howToFund: [
      'Open the official Nimiq Wallet (or any wallet you already use).',
      `Send NIM to: ${generated.addressSpaced}`,
      'Wait for confirmation, then run fund / wizard with this --out-dir.',
    ],
  }
  await writeFile(
    paths.treasuryPublicJson,
    `${JSON.stringify(publicMeta, null, 2)}\n`,
    'utf8',
  )

  console.log('')
  console.log('Generated a NEW basic treasury account (same type as a normal wallet).')
  console.log('')
  console.log('  Public address (send NIM here from the official wallet):')
  console.log(`    ${generated.addressSpaced}`)
  console.log('')
  console.log(`  Private key file (chmod 600, do not commit):`)
  console.log(`    ${paths.treasuryKeyFile}`)
  console.log(`  Public metadata:`)
  console.log(`    ${paths.treasuryPublicJson}`)
  console.log('')
  if (args.showPrivateKey) {
    console.log('  Private key hex (--show-private-key):')
    console.log(`    ${generated.privateKeyHex}`)
    console.log('')
  } else {
    console.log('  Private key is ONLY in the key file (not printed).')
    console.log('  Pass --show-private-key if you need it on screen for a backup tool.')
    console.log('')
  }
  console.log('Next:')
  console.log('  1. Copy the public address above.')
  console.log('  2. In the official Nimiq Wallet, send enough NIM to that address.')
  console.log('     (e.g. 24 probes × 1000 NIM = 24000 NIM + a small buffer)')
  console.log('  3. Confirm the balance, then fund probes:')
  console.log(
    `       npm run probe:wizard`,
  )
  console.log('     or:')
  console.log(
    `       node scripts/probe-stakes/probe-accounts.mjs fund --out-dir ${args.outDir} --amount-nim 1000 --treasury-key-file ${paths.treasuryKeyFile}`,
  )
  console.log('')

  return {
    address: generated.addressSpaced,
    keyFile: paths.treasuryKeyFile,
    publicFile: paths.treasuryPublicJson,
  }
}

async function waitForTreasuryBalance(args, address, minLuna) {
  console.log(`Waiting for treasury balance ≥ ${lunaToNimString(minLuna)} NIM…`)
  console.log('(Ctrl+C to cancel; you can re-run fund later.)')
  for (;;) {
    try {
      const account = await rpcCall(args.rpc, 'getAccountByAddress', [address])
      const bal = BigInt(account?.balance ?? 0)
      console.log(
        `  ${new Date().toISOString()}  balance=${lunaToNimString(bal)} NIM`,
      )
      if (bal >= minLuna) return bal
    } catch (error) {
      console.log(
        `  RPC read failed: ${error instanceof Error ? error.message : error}`,
      )
    }
    await sleep(15_000)
  }
}

async function commandCreate(args) {
  const paths = rosterPaths(args.outDir)
  if (
    !args.force &&
    ((await pathExists(paths.rosterJson)) || (await pathExists(paths.secretsJson)))
  ) {
    throw new Error(
      `Refusing to overwrite existing files in ${args.outDir}. Pass --force to replace.`,
    )
  }

  console.log(`Fetching validators from ${args.api} (listedOnly=${args.listedOnly})…`)
  const validators = await fetchListedValidators(args.api, args.listedOnly)
  console.log(`Got ${validators.length} validators. Generating basic accounts…`)

  const createdAt = new Date().toISOString()
  const batchId = `probe-${createdAt.slice(0, 10)}-${randomBytes(3).toString('hex')}`

  const accounts = []
  const secretAccounts = []

  for (let i = 0; i < validators.length; i += 1) {
    const v = validators[i]
    const generated = generateBasicAccount()
    const probeId = `probe-${String(i + 1).padStart(2, '0')}`
    const validatorAddress =
      typeof v.address === 'string' ? v.address : String(v.address ?? '')
    const declared = v.declared ?? {}

    accounts.push({
      probeId,
      probeAddress: generated.addressSpaced,
      probeAddressCompact: generated.addressCompact,
      accountType: 'basic',
      network: args.network,
      validatorName: v.name ?? null,
      validatorAddress,
      validatorAddressCompact: compactAddress(validatorAddress),
      isListed: Boolean(v.isListed),
      declaredFee: declared.fee ?? null,
      payoutType: declared.payoutType ?? null,
      payoutSchedule: declared.payoutSchedule ?? null,
      createdAt,
      fundStatus: 'unfunded',
      fundAmountNim: null,
      fundAmountLuna: null,
      fundTxHash: null,
      fundedAt: null,
      stakeStatus: 'not-staked',
      stakeAmountNim: null,
      stakeAmountLuna: null,
      stakeTxHash: null,
      stakedAt: null,
      notes: '',
    })

    secretAccounts.push({
      probeId,
      probeAddress: generated.addressSpaced,
      probeAddressCompact: generated.addressCompact,
      privateKeyHex: generated.privateKeyHex,
      publicKeyHex: generated.publicKeyHex,
      accountType: 'basic',
    })
  }

  const roster = {
    version: 1,
    kind: 'steakout-probe-roster',
    batchId,
    network: args.network,
    networkId: networkId(args.network),
    accountType:
      'basic (Schnorr keypair / standard user address — not a validator key)',
    createdAt,
    sourceApi: args.api,
    listedOnly: args.listedOnly,
    count: accounts.length,
    accounts,
  }

  const secrets = {
    version: 1,
    kind: 'steakout-probe-secrets',
    WARNING:
      'PRIVATE KEYS. Never commit, never paste into chat, never upload. chmod 600.',
    batchId,
    network: args.network,
    createdAt,
    accounts: secretAccounts,
  }

  const written = await writeRosterArtifacts(args.outDir, roster, secrets)

  console.log('')
  console.log('Created basic probe accounts:')
  console.log(`  batchId:     ${batchId}`)
  console.log(`  count:       ${accounts.length}`)
  console.log(`  network:     ${args.network} (id ${networkId(args.network)})`)
  console.log(`  roster JSON: ${written.rosterJson}`)
  console.log(`  roster CSV:  ${written.rosterCsv}`)
  console.log(`  secrets:     ${written.secretsJson}  (mode 600 — DO NOT COMMIT)`)
  console.log('')
  console.log('What these accounts are:')
  console.log('  • Basic Nimiq addresses (same type as a normal wallet address).')
  console.log('  • One address per validator so each can stake to a single pool.')
  console.log('  • Not staked yet. Fund them next, then stake via Nimiq Pay / Hub.')
  console.log('')
  console.log('Next:')
  console.log(
    `  1. Backup ${SECRETS_JSON} offline (password manager / encrypted disk).`,
  )
  console.log(
    '  2. Put treasury private key hex in a local file (or env), never in git.',
  )
  console.log(
    '  3. Dry-run fund:',
  )
  console.log(
    `       node scripts/probe-stakes/probe-accounts.mjs fund --out-dir ${args.outDir} --amount-nim 1000 --treasury-key-file ./treasury.private-key.hex`,
  )
  console.log(
    '  4. If the plan looks right, re-run with --broadcast',
  )
}

async function commandFund(args) {
  if (args.amountNim == null) {
    throw new Error('--amount-nim is required for fund')
  }
  const amountLuna = nimToLuna(args.amountNim)
  if (amountLuna <= 0n) {
    throw new Error('--amount-nim must be > 0')
  }

  const { roster, paths } = await loadRoster(args.outDir)
  const secrets = await loadSecrets(args.outDir)
  const secretByProbeId = new Map(
    secrets.accounts.map((row) => [row.probeId, row]),
  )

  const treasury = await loadTreasuryKey(args)
  const treasuryAddress = treasury.publicKey
    .toAddress()
    .toUserFriendlyAddress()
  const treasuryCompact = compactAddress(treasuryAddress)

  console.log(`Treasury address: ${treasuryAddress}`)
  console.log(`Network:          ${args.network} (rpc ${args.rpc})`)
  console.log(`Amount per probe: ${args.amountNim} NIM (${amountLuna} Luna)`)
  console.log(`Fee per tx:       ${args.feeLuna} Luna`)
  console.log(`Mode:             ${args.broadcast ? 'BROADCAST' : 'DRY-RUN'}`)

  const blockNumber = Number(await rpcCall(args.rpc, 'getBlockNumber', []))
  if (!Number.isFinite(blockNumber) || blockNumber <= 0) {
    throw new Error(`Unexpected block number from RPC: ${blockNumber}`)
  }

  let treasuryBalanceLuna = 0n
  try {
    const account = await rpcCall(args.rpc, 'getAccountByAddress', [
      treasuryAddress,
    ])
    treasuryBalanceLuna = BigInt(account?.balance ?? 0)
  } catch (error) {
    throw new Error(
      `Could not read treasury balance: ${error instanceof Error ? error.message : error}`,
    )
  }

  console.log(
    `Treasury balance: ${lunaToNimString(treasuryBalanceLuna)} NIM (block ${blockNumber})`,
  )

  const targets = roster.accounts.filter((row) => {
    if (args.skipFunded && row.fundStatus === 'broadcast') return false
    return true
  })

  if (targets.length === 0) {
    console.log('No probes to fund (all already broadcast, or empty roster).')
    return
  }

  const totalValue = amountLuna * BigInt(targets.length)
  const totalFees = args.feeLuna * BigInt(targets.length)
  const totalNeeded = totalValue + totalFees

  console.log(
    `Will fund ${targets.length} probes → need ${lunaToNimString(totalNeeded)} NIM total (value+fees)`,
  )

  if (args.broadcast && treasuryBalanceLuna < totalNeeded) {
    throw new Error(
      `Treasury balance ${lunaToNimString(treasuryBalanceLuna)} NIM is less than required ${lunaToNimString(totalNeeded)} NIM`,
    )
  }
  if (!args.broadcast && treasuryBalanceLuna < totalNeeded) {
    console.warn(
      `WARNING: treasury balance is less than required total. Dry-run continues; broadcast would fail.`,
    )
  }

  const netId = networkId(args.network)
  const plan = {
    version: 1,
    kind: 'steakout-probe-fund-plan',
    createdAt: new Date().toISOString(),
    mode: args.broadcast ? 'broadcast' : 'dry-run',
    network: args.network,
    networkId: netId,
    rpc: args.rpc,
    blockNumber,
    treasuryAddress,
    treasuryAddressCompact: treasuryCompact,
    amountNim: String(args.amountNim),
    amountLuna: amountLuna.toString(),
    feeLuna: args.feeLuna.toString(),
    targetCount: targets.length,
    totalValueLuna: totalValue.toString(),
    totalFeesLuna: totalFees.toString(),
    totalNeededLuna: totalNeeded.toString(),
    treasuryBalanceLuna: treasuryBalanceLuna.toString(),
    transfers: [],
  }

  const sender = treasury.publicKey.toAddress()

  for (const row of targets) {
    const secret = secretByProbeId.get(row.probeId)
    if (!secret) {
      throw new Error(`No secret entry for ${row.probeId}`)
    }
    if (secret.probeAddressCompact !== row.probeAddressCompact) {
      throw new Error(
        `Roster/secrets mismatch for ${row.probeId}: address compact differs`,
      )
    }

    const recipient = Address.fromUserFriendlyAddress(row.probeAddress)
    const validityStartHeight = blockNumber
    const tx = TransactionBuilder.newBasic(
      sender,
      recipient,
      amountLuna,
      args.feeLuna,
      validityStartHeight,
      netId,
    )
    treasury.signTransaction(tx)
    const serialized = Buffer.from(tx.serialize()).toString('hex')
    const hash = tx.hash()

    const transfer = {
      probeId: row.probeId,
      toAddress: row.probeAddress,
      amountNim: String(args.amountNim),
      amountLuna: amountLuna.toString(),
      feeLuna: args.feeLuna.toString(),
      validityStartHeight,
      txHash: hash,
      status: args.broadcast ? 'pending-broadcast' : 'planned',
      error: null,
    }

    if (args.broadcast) {
      try {
        const accepted = await rpcCall(args.rpc, 'sendRawTransaction', [
          serialized,
        ])
        transfer.status = 'broadcast'
        transfer.acceptedHash = accepted ?? hash
        row.fundStatus = 'broadcast'
        row.fundAmountNim = String(args.amountNim)
        row.fundAmountLuna = amountLuna.toString()
        row.fundTxHash = typeof accepted === 'string' ? accepted : hash
        row.fundedAt = new Date().toISOString()
        if (!args.quiet) {
          console.log(
            `  ✓ ${row.probeId} → ${row.probeAddress}  tx ${row.fundTxHash}`,
          )
        }
        if (args.delayMs > 0) await sleep(args.delayMs)
      } catch (error) {
        transfer.status = 'error'
        transfer.error = error instanceof Error ? error.message : String(error)
        row.fundStatus = 'error'
        row.notes = [row.notes, `fund error: ${transfer.error}`]
          .filter(Boolean)
          .join(' | ')
        console.error(`  ✗ ${row.probeId}: ${transfer.error}`)
      }
    } else {
      row.fundStatus = 'planned'
      row.fundAmountNim = String(args.amountNim)
      row.fundAmountLuna = amountLuna.toString()
      row.fundTxHash = hash
      if (!args.quiet) {
        console.log(
          `  · plan ${row.probeId} → ${row.probeAddress}  ${args.amountNim} NIM  (hash ${hash})`,
        )
      }
    }

    plan.transfers.push(transfer)
  }

  await writeFile(paths.fundPlanJson, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  // Refresh roster artifacts without rewriting secrets.
  await writeRosterArtifacts(args.outDir, roster, null)

  console.log('')
  console.log(`Fund plan written: ${paths.fundPlanJson}`)
  console.log(`Roster updated:    ${paths.rosterJson} / ${paths.rosterCsv}`)
  if (!args.broadcast) {
    console.log('')
    console.log('Dry-run only — no NIM moved.')
    console.log('Review fund-plan.json, then re-run with the same args plus --broadcast.')
  } else {
    console.log('')
    console.log('Broadcast complete. Confirm txs in an explorer before staking.')
    console.log('Staking is a separate step (Nimiq Pay / Hub per probe address).')
  }
}

/**
 * Step 3: stake each probe to its roster-mapped validator.
 * Uses createStaker when no staker exists, else addStake.
 * Default amount = free balance − fee − leave buffer (min 100 NIM).
 */
async function commandStake(args) {
  const { roster, paths } = await loadRoster(args.outDir)
  const secrets = await loadSecrets(args.outDir)
  const secretByProbeId = new Map(
    secrets.accounts.map((row) => [row.probeId, row]),
  )

  const leaveLuna =
    args.leaveNim != null && String(args.leaveNim).trim() !== ''
      ? nimToLuna(args.leaveNim)
      : DEFAULT_LEAVE_LUNA

  const fixedStakeLuna =
    args.amountNim != null && String(args.amountNim).trim() !== ''
      ? nimToLuna(args.amountNim)
      : null

  if (fixedStakeLuna != null && fixedStakeLuna < MIN_STAKE_LUNA) {
    throw new Error(
      `--amount-nim must be at least 100 NIM (protocol minimum); got ${args.amountNim}`,
    )
  }

  // Public RPC (rpc.nimiqwatch.com) rate-limits aggressively; stake needs several
  // calls per probe (account + staker + maybe send). Default delay higher than fund.
  const stakeDelayMs =
    Number.isFinite(args.delayMs) && args.delayMs > 0
      ? Math.max(args.delayMs, 2_000)
      : 2_500

  console.log(`Network:     ${args.network} (rpc ${args.rpc})`)
  console.log(
    `Stake amount:${fixedStakeLuna != null ? ` ${args.amountNim} NIM fixed` : ' max free balance per probe'}`,
  )
  console.log(`Leave free:  ${lunaToNimString(leaveLuna)} NIM per probe`)
  console.log(`Fee per tx:  ${args.feeLuna} Luna`)
  console.log(`Mode:        ${args.broadcast ? 'BROADCAST' : 'DRY-RUN'}`)
  console.log(`Pace:        ${stakeDelayMs}ms between probes (retries on 429)`)

  const blockNumber = Number(
    await rpcCall(args.rpc, 'getBlockNumber', [], { verbose: true }),
  )
  if (!Number.isFinite(blockNumber) || blockNumber <= 0) {
    throw new Error(`Unexpected block number from RPC: ${blockNumber}`)
  }
  console.log(`Block:       ${blockNumber}`)

  const targets = roster.accounts.filter((row) => {
    if (args.skipStaked && row.stakeStatus === 'broadcast') return false
    // Allow re-planning after prior RPC errors
    if (
      args.skipStaked &&
      (row.stakeStatus === 'error' || row.stakeStatus === 'planned')
    ) {
      return true
    }
    return true
  })

  if (targets.length === 0) {
    console.log('No probes to stake (all already broadcast, or empty roster).')
    return
  }

  const netId = networkId(args.network)
  const plan = {
    version: 1,
    kind: 'steakout-probe-stake-plan',
    createdAt: new Date().toISOString(),
    mode: args.broadcast ? 'broadcast' : 'dry-run',
    network: args.network,
    networkId: netId,
    rpc: args.rpc,
    blockNumber,
    leaveLuna: leaveLuna.toString(),
    fixedStakeLuna: fixedStakeLuna?.toString() ?? null,
    feeLuna: args.feeLuna.toString(),
    targetCount: targets.length,
    stakes: [],
  }

  for (const row of targets) {
    const secret = secretByProbeId.get(row.probeId)
    if (!secret) {
      throw new Error(`No secret entry for ${row.probeId}`)
    }
    if (secret.probeAddressCompact !== row.probeAddressCompact) {
      throw new Error(
        `Roster/secrets mismatch for ${row.probeId}: address compact differs`,
      )
    }
    if (!row.validatorAddress) {
      throw new Error(`${row.probeId} has no validatorAddress in roster`)
    }

    const entry = {
      probeId: row.probeId,
      probeAddress: row.probeAddress,
      validatorName: row.validatorName,
      validatorAddress: row.validatorAddress,
      action: null,
      amountLuna: null,
      amountNim: null,
      freeBalanceLuna: null,
      txHash: null,
      status: 'pending',
      error: null,
    }

    try {
      const freeBalance = await getAccountBalanceLuna(args.rpc, row.probeAddress)
      entry.freeBalanceLuna = freeBalance.toString()

      let stakeLuna = fixedStakeLuna
      if (stakeLuna == null) {
        const spendable = freeBalance - args.feeLuna - leaveLuna
        stakeLuna = spendable > 0n ? spendable : 0n
      }

      if (stakeLuna < MIN_STAKE_LUNA) {
        entry.status = 'skipped'
        entry.error = `stake amount ${lunaToNimString(stakeLuna)} NIM < 100 NIM minimum (free bal ${lunaToNimString(freeBalance)} NIM)`
        entry.amountLuna = stakeLuna.toString()
        entry.amountNim = lunaToNimString(stakeLuna)
        row.stakeStatus = 'skipped-insufficient'
        row.notes = [row.notes, entry.error].filter(Boolean).join(' | ')
        console.log(`  · skip ${row.probeId}: ${entry.error}`)
        plan.stakes.push(entry)
        await sleep(stakeDelayMs)
        continue
      }

      if (freeBalance < stakeLuna + args.feeLuna) {
        entry.status = 'skipped'
        entry.error = `free balance ${lunaToNimString(freeBalance)} NIM < stake+fee ${lunaToNimString(stakeLuna + args.feeLuna)} NIM`
        row.stakeStatus = 'skipped-insufficient'
        row.notes = [row.notes, entry.error].filter(Boolean).join(' | ')
        console.log(`  · skip ${row.probeId}: ${entry.error}`)
        plan.stakes.push(entry)
        await sleep(stakeDelayMs)
        continue
      }

      // "No staker" is the normal case for new probes — not an error.
      const existing = await getStakerOrNull(args.rpc, row.probeAddress)
      const sender = Address.fromUserFriendlyAddress(row.probeAddress)
      const validator = Address.fromUserFriendlyAddress(row.validatorAddress)
      const keyPair = keyPairFromPrivateHex(secret.privateKeyHex)

      let tx
      if (!existing) {
        entry.action = 'createStaker'
        tx = TransactionBuilder.newCreateStaker(
          sender,
          validator,
          stakeLuna,
          args.feeLuna,
          blockNumber,
          netId,
        )
      } else {
        // Already a staker — add stake. Does not re-bind delegation if wrong validator.
        const currentDelegation =
          typeof existing.delegation === 'string' ? existing.delegation : null
        if (
          currentDelegation &&
          compactAddress(currentDelegation) !==
            compactAddress(row.validatorAddress)
        ) {
          entry.status = 'skipped'
          entry.error = `already staked to ${currentDelegation}; roster wants ${row.validatorAddress}. Fix manually (update staker) before probe stake.`
          row.stakeStatus = 'skipped-wrong-delegation'
          row.notes = [row.notes, entry.error].filter(Boolean).join(' | ')
          console.log(`  · skip ${row.probeId}: ${entry.error}`)
          plan.stakes.push(entry)
          await sleep(stakeDelayMs)
          continue
        }
        entry.action = 'addStake'
        tx = TransactionBuilder.newAddStake(
          sender,
          sender,
          stakeLuna,
          args.feeLuna,
          blockNumber,
          netId,
        )
      }

      keyPair.signTransaction(tx)
      const serialized = Buffer.from(tx.serialize()).toString('hex')
      const hash = tx.hash()
      entry.amountLuna = stakeLuna.toString()
      entry.amountNim = lunaToNimString(stakeLuna)
      entry.txHash = hash

      if (args.broadcast) {
        try {
          const accepted = await rpcCall(
            args.rpc,
            'sendRawTransaction',
            [serialized],
            { verbose: true },
          )
          entry.status = 'broadcast'
          entry.acceptedHash = accepted ?? hash
          row.stakeStatus = 'broadcast'
          row.stakeAmountNim = entry.amountNim
          row.stakeAmountLuna = entry.amountLuna
          row.stakeTxHash = typeof accepted === 'string' ? accepted : hash
          row.stakedAt = new Date().toISOString()
          if (!args.quiet) {
            console.log(
              `  ✓ ${row.probeId} ${entry.action} ${entry.amountNim} NIM → ${row.validatorName ?? row.validatorAddress}  tx ${row.stakeTxHash}`,
            )
          }
        } catch (error) {
          entry.status = 'error'
          entry.error = error instanceof Error ? error.message : String(error)
          row.stakeStatus = 'error'
          row.notes = [row.notes, `stake error: ${entry.error}`]
            .filter(Boolean)
            .join(' | ')
          console.error(`  ✗ ${row.probeId}: ${entry.error}`)
        }
      } else {
        entry.status = 'planned'
        row.stakeStatus = 'planned'
        row.stakeAmountNim = entry.amountNim
        row.stakeAmountLuna = entry.amountLuna
        row.stakeTxHash = hash
        if (!args.quiet) {
          console.log(
            `  · plan ${row.probeId} ${entry.action} ${entry.amountNim} NIM → ${row.validatorName ?? '?'}  (hash ${hash})`,
          )
        }
      }
    } catch (error) {
      entry.status = 'error'
      entry.error = error instanceof Error ? error.message : String(error)
      row.stakeStatus = 'error'
      row.notes = [row.notes, `stake error: ${entry.error}`]
        .filter(Boolean)
        .join(' | ')
      console.error(`  ✗ ${row.probeId}: ${entry.error}`)
    }

    plan.stakes.push(entry)
    // Always pace between probes — even dry-run does 2 RPC reads each.
    await sleep(stakeDelayMs)
  }

  await writeFile(paths.stakePlanJson, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  await writeRosterArtifacts(args.outDir, roster, null)

  console.log('')
  console.log(`Stake plan written: ${paths.stakePlanJson}`)
  console.log(`Roster updated:     ${paths.rosterJson} / ${paths.rosterCsv}`)
  if (!args.broadcast) {
    console.log('')
    console.log('Dry-run only — no stake txs sent.')
    console.log('Review stake-plan.json, then re-run with the same args plus --broadcast.')
  } else {
    console.log('')
    console.log('Broadcast complete. Confirm staker state with: status')
    console.log('After this, monitoring can use public roster addresses only.')
  }
}

async function commandStatus(args) {
  const { roster } = await loadRoster(args.outDir)
  console.log(
    `Roster ${roster.batchId} — ${roster.count} accounts — network ${roster.network}`,
  )
  console.log(`RPC ${args.rpc}`)
  console.log('')

  for (const row of roster.accounts) {
    let balanceNim = '?'
    let stakedNim = '—'
    let delegation = '—'
    try {
      const free = await getAccountBalanceLuna(args.rpc, row.probeAddress)
      balanceNim = lunaToNimString(free)
      const staker = await getStakerOrNull(args.rpc, row.probeAddress)
      if (staker) {
        const bal = BigInt(staker.balance ?? 0)
        stakedNim = lunaToNimString(bal)
        delegation = staker.delegation
          ? compactAddress(String(staker.delegation)).slice(0, 10) + '…'
          : 'none'
      }
    } catch {
      balanceNim = 'rpc-error'
    }
    console.log(
      [
        row.probeId.padEnd(10),
        (row.validatorName ?? '?').padEnd(20).slice(0, 20),
        `free=${String(balanceNim).padStart(8)}`,
        `staked=${String(stakedNim).padStart(8)}`,
        `del=${delegation.padEnd(12)}`,
        `fund=${row.fundStatus}`,
        `stake=${row.stakeStatus}`,
      ].join('  '),
    )
    if (args.delayMs > 0) await sleep(Math.min(args.delayMs, 200))
  }
}

// ---------------------------------------------------------------------------
// Interactive wizard (run locally — never hand this to an agent with keys)
// ---------------------------------------------------------------------------

async function promptLine(rl, question, defaultValue) {
  const suffix =
    defaultValue != null && defaultValue !== '' ? ` [${defaultValue}]` : ''
  const answer = (await rl.question(`${question}${suffix}: `)).trim()
  if (!answer && defaultValue != null) return String(defaultValue)
  return answer
}

async function promptYesNo(rl, question, defaultYes = false) {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase()
  if (!answer) return defaultYes
  return answer === 'y' || answer === 'yes'
}

/**
 * Guided flow so you do not need to memorize flags.
 * Prints only summaries to the terminal you control — do not paste output here into chat.
 */
async function commandWizard(args) {
  const rl = createInterface({ input, output })
  try {
    console.log('')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  Steakout probe-stakes wizard')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('')
    console.log('What this does:')
    console.log('  1. Creates one BASIC Nimiq address per listed validator')
    console.log('  2. Creates (or reuses) a BASIC treasury account you can fund')
    console.log('     from the official wallet (send NIM to the public address)')
    console.log('  3. Dry-runs funding X NIM from treasury → each probe')
    console.log('  4. Optionally broadcasts after you type BROADCAST')
    console.log('')
    console.log('Privacy: run this in your own terminal only.')
    console.log('         Do not paste secrets or private keys into chat.')
    console.log('')

    const outDirAnswer = await promptLine(
      rl,
      'Output directory for roster + secrets',
      args.outDir,
    )
    args.outDir = resolve(process.cwd(), outDirAnswer)

    const networkAnswer = await promptLine(rl, 'Network (main or test)', args.network)
    if (networkAnswer !== 'main' && networkAnswer !== 'test') {
      throw new Error('Network must be main or test')
    }
    args.network = networkAnswer
    args.rpc = args.network === 'test' ? DEFAULT_RPC_TEST : DEFAULT_RPC_MAIN

    const paths = rosterPaths(args.outDir)
    const rosterExists = await pathExists(paths.rosterJson)
    const secretsExist = await pathExists(paths.secretsJson)

    if (rosterExists && secretsExist) {
      console.log('')
      console.log(`Found existing roster at ${paths.rosterJson}`)
      const recreate = await promptYesNo(
        rl,
        'Generate a NEW set of probe accounts (overwrites probe keys — backup first)?',
        false,
      )
      if (recreate) {
        const sure = await promptYesNo(
          rl,
          'Type yes only if secrets.json is backed up. Overwrite now?',
          false,
        )
        if (!sure) {
          console.log('Keeping existing roster.')
        } else {
          args.force = true
          await commandCreate(args)
        }
      } else {
        console.log('Using existing roster.')
      }
    } else {
      console.log('')
      console.log('No roster yet — creating basic accounts for listed validators…')
      await commandCreate(args)
    }

    // --- Treasury ---
    console.log('')
    console.log('Treasury funding account')
    console.log('  The official Nimiq Wallet usually cannot export private-key hex.')
    console.log('  So we generate a dedicated basic account here, you SEND NIM to it')
    console.log('  from the official wallet, then this script spends from that key file.')
    console.log('')

    let keyPath = null
    const existingTreasury = await pathExists(paths.treasuryKeyFile)

    if (existingTreasury) {
      console.log(`Found existing treasury key: ${paths.treasuryKeyFile}`)
      if (await pathExists(paths.treasuryPublicJson)) {
        try {
          const pub = JSON.parse(await readFile(paths.treasuryPublicJson, 'utf8'))
          if (pub.address) {
            console.log(`  Address: ${pub.address}`)
          }
        } catch {
          /* ignore */
        }
      }
      const reuse = await promptYesNo(rl, 'Use this existing treasury?', true)
      if (reuse) {
        keyPath = paths.treasuryKeyFile
      } else {
        const regen = await promptYesNo(
          rl,
          'Generate a NEW treasury (overwrites key file — backup first)?',
          false,
        )
        if (regen) {
          args.force = true
          await commandGenerateTreasury(args)
          keyPath = paths.treasuryKeyFile
        }
      }
    } else {
      const gen = await promptYesNo(
        rl,
        'Generate a new treasury account now? (recommended if you cannot export a key)',
        true,
      )
      if (gen) {
        await commandGenerateTreasury(args)
        keyPath = paths.treasuryKeyFile
      }
    }

    if (!keyPath) {
      keyPath = await promptLine(
        rl,
        'Path to an existing treasury private key file',
        '',
      )
      if (!keyPath) {
        console.log('No treasury key — stop here. Re-run wizard when ready.')
        return
      }
      keyPath = resolve(process.cwd(), keyPath)
    }

    if (!(await pathExists(keyPath))) {
      throw new Error(`Treasury key file not found: ${keyPath}`)
    }
    args.treasuryKeyFile = keyPath

    const treasury = await loadTreasuryKey(args)
    const treasuryAddress = treasury.publicKey
      .toAddress()
      .toUserFriendlyAddress()
    console.log('')
    console.log(`Treasury public address: ${treasuryAddress}`)
    console.log('→ Send NIM to THIS address from the official Nimiq Wallet.')
    console.log('')

    console.log('')
    const fundNow = await promptYesNo(
      rl,
      'Continue to fund probes from this treasury? (only after it has enough NIM)',
      true,
    )
    if (!fundNow) {
      console.log('')
      console.log('Stopped. After funding the treasury address above:')
      console.log(`  npm run probe:wizard`)
      return
    }

    const amount = await promptLine(rl, 'NIM to send to EACH probe', '1000')
    args.amountNim = amount
    const amountLuna = nimToLuna(amount)

    // Reload roster for count
    const { roster } = await loadRoster(args.outDir)
    const probeCount = roster.accounts.length
    const totalNeeded = amountLuna * BigInt(probeCount)
    console.log(
      `Need about ${lunaToNimString(totalNeeded)} NIM on treasury for ${probeCount} probes (plus fees).`,
    )

    const wait = await promptYesNo(
      rl,
      'Wait here until treasury balance is high enough? (polls every 15s)',
      true,
    )
    if (wait) {
      await waitForTreasuryBalance(args, treasuryAddress, totalNeeded)
    }

    console.log('')
    console.log('── Step 2 dry-run: fund (no NIM moves) ──')
    args.broadcast = false
    args.dryRun = true
    args.quiet = true
    await commandFund(args)

    const planPath = rosterPaths(args.outDir).fundPlanJson
    console.log('')
    console.log(`Review the plan file if you want: ${planPath}`)
    console.log('')

    const doBroadcast = await promptYesNo(
      rl,
      'Broadcast FUND for REAL? This spends treasury NIM to every probe.',
      false,
    )
    if (!doBroadcast) {
      console.log('')
      console.log('No fund broadcast. Re-run wizard when ready.')
      console.log('You can also fund later, then stake with:')
      console.log(
        `  node scripts/probe-stakes/probe-accounts.mjs stake --out-dir ${args.outDir}`,
      )
      return
    }

    const confirmText = await promptLine(
      rl,
      'Type BROADCAST in capitals to confirm fund',
      '',
    )
    if (confirmText !== 'BROADCAST') {
      console.log('Confirmation text mismatch — aborting. No NIM sent.')
      return
    }

    console.log('')
    console.log('── Step 2 broadcast: fund ──')
    args.broadcast = true
    args.dryRun = false
    args.quiet = false
    args.skipFunded = true
    await commandFund(args)

    // --- Step 3: stake ---
    console.log('')
    console.log('── Step 3: stake each probe to its mapped validator ──')
    const stakeNow = await promptYesNo(
      rl,
      'Stake probes now? (needs confirmed free balance on each probe)',
      true,
    )
    if (!stakeNow) {
      console.log('')
      console.log('Stopped after fund. When balances are confirmed:')
      console.log(
        `  node scripts/probe-stakes/probe-accounts.mjs stake --out-dir ${args.outDir}`,
      )
      console.log('  …review stake-plan.json, then add --broadcast')
      return
    }

    const leave = await promptLine(
      rl,
      'NIM to leave unstaked on each probe (for fees/dust)',
      '1',
    )
    args.leaveNim = leave
    args.amountNim = null // max free balance minus leave

    console.log('')
    console.log('── Step 3 dry-run: stake ──')
    args.broadcast = false
    args.dryRun = true
    args.quiet = true
    args.skipStaked = true
    await commandStake(args)

    const stakeBroadcast = await promptYesNo(
      rl,
      'Broadcast STAKE for REAL? This locks NIM to each mapped validator.',
      false,
    )
    if (!stakeBroadcast) {
      console.log('No stake broadcast. Re-run stake when ready.')
      return
    }

    const confirmStake = await promptLine(
      rl,
      'Type STAKE in capitals to confirm',
      '',
    )
    if (confirmStake !== 'STAKE') {
      console.log('Confirmation text mismatch — aborting. No stake txs sent.')
      return
    }

    console.log('')
    console.log('── Step 3 broadcast: stake ──')
    args.broadcast = true
    args.dryRun = false
    args.quiet = false
    args.skipStaked = true
    await commandStake(args)

    console.log('')
    const showStatus = await promptYesNo(rl, 'Show live balances / staker state now?', true)
    if (showStatus) {
      await commandStatus(args)
    }

    console.log('')
    console.log('Pipeline complete (create → fund → stake).')
    console.log(`  • Backup ${join(args.outDir, SECRETS_JSON)} and ${TREASURY_KEY_FILE} offline`)
    console.log(`  • Public roster for monitoring: ${join(args.outDir, ROSTER_CSV)}`)
    console.log('  • Share only roster JSON/CSV (no secrets) when building site monitoring')
    console.log('')
  } finally {
    rl.close()
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    printHelp()
    process.exitCode = 1
    return
  }

  // Default to wizard when no command — easiest path for humans.
  if (!args.command && !args.help) {
    args.command = 'wizard'
  }

  if (args.help) {
    printHelp()
    process.exitCode = 0
    return
  }

  try {
    if (args.command === 'wizard') {
      await commandWizard(args)
    } else if (args.command === 'generate-treasury' || args.command === 'treasury') {
      await commandGenerateTreasury(args)
    } else if (args.command === 'create') {
      await commandCreate(args)
    } else if (args.command === 'fund') {
      await commandFund(args)
    } else if (args.command === 'stake') {
      await commandStake(args)
    } else if (args.command === 'status') {
      await commandStatus(args)
    } else {
      console.error(`Unknown command: ${args.command}`)
      printHelp()
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

// Avoid importing this as a library accidentally writing files.
const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}

export {
  buildCsv,
  compactAddress,
  generateBasicAccount,
  lunaToNimString,
  nimToLuna,
  networkId,
}
