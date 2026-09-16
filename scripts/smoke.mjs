/*
 * Production-build smoke checks.
 *
 * With SMOKE_BASE_URL, checks an already-running deployment. Otherwise starts
 * the built server against a disposable SQLite database and seeds one public
 * validator row so profile + evidence routes are exercised deterministically.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const validatorAddress =
  process.env.SMOKE_VALIDATOR_ADDRESS || 'NQ260000000002A5YAK74QNF9MH0TE2BGVRU'
const externalBaseUrl = process.env.SMOKE_BASE_URL?.replace(/\/$/, '')
const localDataDir = externalBaseUrl ? null : mkdtempSync(join(tmpdir(), 'steakout-smoke-'))
const port = 31_000 + Math.floor(Math.random() * 2_000)
let child

function fail(message) {
  throw new Error(`Smoke check failed: ${message}`)
}

function seedLocalDatabase() {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--eval',
      `import { openDatabase } from './server/src/db.ts'; const db = openDatabase(process.env.DATA_DIR + '/steakout.sqlite'); db.prepare("INSERT INTO validators (address, name, payout_schedule_declared, schedule_every_hours, is_listed, registry_updated_at) VALUES (?, ?, ?, ?, 1, ?)").run(process.env.SMOKE_VALIDATOR_ADDRESS, 'Smoke validator', 'weekly', 168, new Date().toISOString()); db.close();`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        DATA_DIR: localDataDir,
        SMOKE_VALIDATOR_ADDRESS: validatorAddress,
      },
      encoding: 'utf8',
    },
  )
  if (result.status !== 0) {
    fail(`unable to seed disposable database: ${result.stderr || result.stdout}`)
  }
}

async function get(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  return { response, text }
}

async function getJson(url) {
  const { response, text } = await get(url, {
    headers: { accept: 'application/json' },
  })
  let body
  try {
    body = JSON.parse(text)
  } catch {
    fail(`${url} returned non-JSON (${response.status})`)
  }
  return { response, body }
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15_000
  let lastError = 'not started'
  while (Date.now() < deadline) {
    try {
      const { response, body } = await getJson(`${baseUrl}/api/health`)
      if (response.ok && body?.ok === true) return body
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  fail(`health did not become ready (${lastError})`)
}

async function run() {
  if (!existsSync(join(root, 'client/dist/index.html'))) {
    fail('client/dist/index.html is missing; run npm run build first')
  }

  let baseUrl = externalBaseUrl
  if (!baseUrl) {
    seedLocalDatabase()
    child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATA_DIR: localDataDir,
        SMOKE_VALIDATOR_ADDRESS: validatorAddress,
        NIMIQ_RPC_URL: '',
        NIMIQ_RPC_URL_FALLBACK: '',
        VALIDATORS_SYNC_ENABLED: 'false',
        INDEXER_ENABLED: 'false',
        PAYMENT_FLOOR_REFRESH_ENABLED: 'false',
        DIAGNOSTICS_TOKEN: '',
        CORS_ORIGIN: '',
        SESSION_SECRET: 'smoke-only-session-secret-not-for-production-use',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`))
    child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`))
    baseUrl = `http://127.0.0.1:${port}`
  }

  const health = await waitForHealth(baseUrl)
  const spa = await get(`${baseUrl}/`)
  if (!spa.response.ok || !/Steakout/i.test(spa.text)) {
    fail(`SPA boot returned HTTP ${spa.response.status}`)
  }

  const list = await getJson(`${baseUrl}/api/validators?listed=true`)
  if (!list.response.ok || !Array.isArray(list.body?.data?.validators)) {
    fail(`validator list returned unexpected HTTP ${list.response.status}`)
  }
  const selected = process.env.SMOKE_VALIDATOR_ADDRESS || list.body.data.validators[0]?.address
  if (!selected) {
    fail('validator list is empty; set SMOKE_VALIDATOR_ADDRESS when checking a deployment')
  }

  const encoded = encodeURIComponent(selected)
  const profile = await getJson(`${baseUrl}/api/validators/${encoded}`)
  if (!profile.response.ok || !profile.body?.data?.address) {
    fail(`public validator profile returned HTTP ${profile.response.status}`)
  }
  const evidence = await getJson(`${baseUrl}/api/validators/${encoded}/observations`)
  if (!evidence.response.ok || !evidence.body?.data?.observationStatus) {
    fail(`validator evidence returned HTTP ${evidence.response.status}`)
  }

  const spike = await get(`${baseUrl}/api/spike/block-number`)
  if (spike.response.status !== 404) fail(`production spike API returned HTTP ${spike.response.status}`)

  console.log(
    JSON.stringify({
      smoke: 'ok',
      baseUrl,
      network: health.network ?? null,
      mode: health.mode ?? null,
      validator: selected,
      checks: ['spa', 'health', 'validator-profile', 'validator-evidence', 'spike-disabled'],
    }),
  )
}

try {
  await run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (child) child.kill('SIGTERM')
  if (localDataDir) rmSync(localDataDir, { recursive: true, force: true })
}
