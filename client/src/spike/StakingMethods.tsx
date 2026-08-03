import { useRef, useState, type ReactNode } from 'react'
import { init, type ErrorResponse, type NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  normalizeProviderTxResult,
  providerTxClassification,
  type ProviderTxClassification,
  type ProviderTxOutcome,
} from '../nimiq'
import './StakingMethods.css'

const SDK_INIT_TIMEOUT_MS = 10_000

type MethodName =
  | 'sendNewStakerTransaction'
  | 'sendStakeTransaction'
  | 'sendSetActiveStakeTransaction'
  | 'sendUpdateStakerTransaction'
  | 'sendRetireStakeTransaction'
  | 'sendRemoveStakeTransaction'

type MethodInputs = {
  delegation: string
  newDelegation: string
  value: string
  newActiveBalance: string
  retireStake: string
  reactivateAllStake: boolean
}

type MethodResult = {
  status: 'success' | 'provider-error' | 'thrown-error' | 'validation-error'
  arguments: string
  resultType: string
  raw: string
  providerError?: string
  /** hash | serialized→hash | raw | error */
  classification: ProviderTxClassification
  /** Derived or direct 64-hex when available. */
  derivedHash?: string
  /** How hash was obtained when classification is hash-like. */
  hashSource?: 'hash' | 'serialized'
  /** Full normalized outcome for report JSON. */
  outcome: ProviderTxOutcome
  recordedAt: string
}

type ProviderState = 'waiting' | 'warming' | 'ready' | 'unavailable'

const METHOD_NAMES: MethodName[] = [
  'sendNewStakerTransaction',
  'sendStakeTransaction',
  'sendSetActiveStakeTransaction',
  'sendUpdateStakerTransaction',
  'sendRetireStakeTransaction',
  'sendRemoveStakeTransaction',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProviderError(value: unknown): value is ErrorResponse {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.type === 'string' &&
    typeof value.error.message === 'string'
  )
}

function formatRaw(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`

  const json = JSON.stringify(value, null, 2)
  return json ?? String(value)
}

function parseLuna(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a whole-number Luna amount.`)

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero and within the safe integer range.`)
  }

  return parsed
}

function requireAddress(value: string, label: string): string {
  const address = value.trim()
  if (!address) throw new Error(`${label} is required.`)
  return address
}

function getErrorMessage(value: unknown): string {
  if (isProviderError(value)) return value.error.message
  if (value instanceof Error) return value.message
  return formatRaw(value)
}

function outcomeToMethodFields(outcome: ProviderTxOutcome): Pick<
  MethodResult,
  'classification' | 'derivedHash' | 'hashSource' | 'outcome'
> {
  const classification = providerTxClassification(outcome)
  if (outcome.kind === 'hash') {
    return {
      classification,
      derivedHash: outcome.hash,
      hashSource: outcome.source,
      outcome,
    }
  }
  return { classification, outcome }
}

function StakingMethods() {
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [providerState, setProviderState] = useState<ProviderState>('waiting')
  const [network, setNetwork] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [testnetAcknowledged, setTestnetAcknowledged] = useState(false)
  const [reviewedMethods, setReviewedMethods] = useState<Partial<Record<MethodName, boolean>>>({})
  const [runningMethod, setRunningMethod] = useState<MethodName | null>(null)
  const [inputs, setInputs] = useState<MethodInputs>({
    delegation: '',
    newDelegation: '',
    value: '',
    newActiveBalance: '',
    retireStake: '',
    reactivateAllStake: false,
  })
  const [results, setResults] = useState<Partial<Record<MethodName, MethodResult>>>({})
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const warmupInFlight = useRef<Promise<NimiqProvider> | null>(null)

  const setInput = <K extends keyof MethodInputs>(key: K, value: MethodInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }))
  }

  const warmProvider = async (): Promise<NimiqProvider> => {
    if (provider) return provider
    if (warmupInFlight.current) return warmupInFlight.current

    setProviderState('warming')
    const warmup = init({ timeout: SDK_INIT_TIMEOUT_MS })
    warmupInFlight.current = warmup

    try {
      const detectedProvider = await warmup
      setProvider(detectedProvider)
      setProviderState('ready')
      return detectedProvider
    } catch (cause) {
      setProviderState('unavailable')
      throw cause
    } finally {
      if (warmupInFlight.current === warmup) warmupInFlight.current = null
    }
  }

  const buildReport = () => {
    const methodReports = METHOD_NAMES.map((method) => {
      const result = results[method]
      if (!result) {
        return { method, status: 'not-run' as const }
      }
      return {
        method,
        status: result.status,
        classification: result.classification,
        arguments: result.arguments,
        resultType: result.resultType,
        raw: result.raw,
        providerError: result.providerError ?? null,
        derivedHash: result.derivedHash ?? null,
        hashSource: result.hashSource ?? null,
        outcome: result.outcome,
        recordedAt: result.recordedAt,
      }
    })

    return {
      spike: 'P0-03',
      reportVersion: 1,
      generatedAt: new Date().toISOString(),
      note:
        'Device observations only. Do not invent results. Paste into docs/spikes/staking-methods.md.',
      context: {
        harnessRoute: '/spike/staking-methods',
        providerPresent: typeof window.nimiq !== 'undefined',
        providerState,
        network,
        // Address is needed for fixture form; redact in public paste if required.
        connectedAddress: account,
        testnetAcknowledged,
        sdkPackage: '@nimiq/mini-app-sdk (see lockfile for exact version)',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
      methods: methodReports,
    }
  }

  const copyReportJson = async () => {
    const json = JSON.stringify(buildReport(), null, 2)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json)
        setCopyStatus('Report JSON copied to clipboard. Paste into docs/spikes/staking-methods.md.')
      } else {
        setCopyStatus('Clipboard unavailable. Use Download report instead.')
      }
    } catch {
      setCopyStatus('Copy failed. Use Download report instead.')
    }
  }

  const downloadReportJson = () => {
    const json = JSON.stringify(buildReport(), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'steakout-p0-03-report.json'
    anchor.click()
    URL.revokeObjectURL(url)
    setCopyStatus('Downloaded steakout-p0-03-report.json')
  }

  const runMethod = async (method: MethodName) => {
    setRunningMethod(method)
    const placeholderOutcome = normalizeProviderTxResult({
      error: { type: 'pending', message: 'The method has not returned yet.' },
    })
    setResults((current) => ({
      ...current,
      [method]: {
        status: 'validation-error',
        arguments: 'Preparing provider call...',
        resultType: 'not available',
        raw: 'The method has not returned yet.',
        classification: 'error',
        outcome: placeholderOutcome,
        recordedAt: new Date().toISOString(),
      },
    }))

    let argumentSummary = 'Not available: provider call did not reach argument construction.'

    try {
      const activeProvider = await warmProvider()
      await activeProvider.connect()

      const activeNetwork = activeProvider.getNetwork()
      setNetwork(activeNetwork)
      if (activeNetwork.toLowerCase() !== 'testnet') {
        throw new Error(`Refusing to call ${method}: provider network is ${activeNetwork}, not testnet.`)
      }

      const accountsResult = await activeProvider.listAccounts()
      if (isProviderError(accountsResult)) throw accountsResult
      setAccount(accountsResult[0] ?? null)

      let result: string | ErrorResponse

      switch (method) {
        case 'sendNewStakerTransaction': {
          const args = {
            delegation: requireAddress(inputs.delegation, 'Validator delegation'),
            value: parseLuna(inputs.value, 'Stake value'),
          }
          argumentSummary = formatRaw(args)
          result = await activeProvider.sendNewStakerTransaction(args)
          break
        }
        case 'sendStakeTransaction': {
          const args = { value: parseLuna(inputs.value, 'Stake value') }
          argumentSummary = formatRaw(args)
          result = await activeProvider.sendStakeTransaction(args)
          break
        }
        case 'sendSetActiveStakeTransaction': {
          const args = { newActiveBalance: parseLuna(inputs.newActiveBalance, 'New active balance') }
          argumentSummary = formatRaw(args)
          result = await activeProvider.sendSetActiveStakeTransaction(args)
          break
        }
        case 'sendUpdateStakerTransaction': {
          const args = {
            newDelegation: requireAddress(inputs.newDelegation, 'New validator delegation'),
            reactivateAllStake: inputs.reactivateAllStake,
          }
          argumentSummary = formatRaw(args)
          result = await activeProvider.sendUpdateStakerTransaction(args)
          break
        }
        case 'sendRetireStakeTransaction': {
          const args = { retireStake: parseLuna(inputs.retireStake, 'Retire amount') }
          argumentSummary = formatRaw(args)
          result = await activeProvider.sendRetireStakeTransaction(args)
          break
        }
        case 'sendRemoveStakeTransaction': {
          const args = { value: parseLuna(inputs.value, 'Remove amount') }
          argumentSummary = formatRaw(args)
          result = await activeProvider.sendRemoveStakeTransaction(args)
          break
        }
      }

      const outcome = normalizeProviderTxResult(result)
      const fields = outcomeToMethodFields(outcome)

      if (isProviderError(result) || outcome.kind === 'error') {
        setResults((current) => ({
          ...current,
          [method]: {
            status: 'provider-error',
            arguments: argumentSummary,
            resultType: typeof result,
            raw: formatRaw(result),
            providerError:
              isProviderError(result)
                ? `${result.error.type}: ${result.error.message}`
                : outcome.kind === 'error'
                  ? outcome.message
                  : undefined,
            ...fields,
            recordedAt: new Date().toISOString(),
          },
        }))
      } else {
        setResults((current) => ({
          ...current,
          [method]: {
            status: 'success',
            arguments: argumentSummary,
            resultType: typeof result,
            raw: formatRaw(result),
            ...fields,
            recordedAt: new Date().toISOString(),
          },
        }))
      }
    } catch (cause) {
      const validationError =
        cause instanceof Error &&
        (cause.message.includes('must be') || cause.message.endsWith('is required.'))
      const providerError = isProviderError(cause)
      const outcome = providerError
        ? normalizeProviderTxResult(cause)
        : normalizeProviderTxResult({
            error: {
              type: validationError ? 'validation' : 'thrown',
              message: getErrorMessage(cause),
            },
          })
      const fields = outcomeToMethodFields(outcome)
      setResults((current) => ({
        ...current,
        [method]: {
          status: providerError ? 'provider-error' : validationError ? 'validation-error' : 'thrown-error',
          arguments: argumentSummary,
          resultType: typeof cause,
          raw: formatRaw(cause),
          providerError: providerError || !validationError ? getErrorMessage(cause) : undefined,
          ...fields,
          recordedAt: new Date().toISOString(),
        },
      }))
    } finally {
      setRunningMethod(null)
    }
  }

  const renderMethodCard = (
    method: MethodName,
    title: string,
    description: string,
    transition: string,
    fields: ReactNode,
  ) => {
    const result = results[method]
    const isReviewed = reviewedMethods[method] === true
    const isRunning = runningMethod === method

    return (
      <article className="nq-card staking-method-card" key={method}>
        <div className="staking-method-heading">
          <div>
            <p className="card-kicker">Provider method</p>
            <h3>{title}</h3>
          </div>
          <code>{method}</code>
        </div>
        <p>{description}</p>
        <p className="staking-transition"><strong>State transition to verify:</strong> {transition}</p>
        <div className="staking-fields">{fields}</div>
        <label className="staking-review-check">
          <input
            type="checkbox"
            checked={isReviewed}
            onChange={(event) => setReviewedMethods((current) => ({ ...current, [method]: event.target.checked }))}
          />
          <span>I reviewed these arguments and the state transition before calling the provider.</span>
        </label>
        <button
          className="nq-button nq-button-primary"
          type="button"
          onClick={() => void runMethod(method)}
          disabled={!testnetAcknowledged || !isReviewed || runningMethod !== null}
        >
          {isRunning ? 'Waiting for provider...' : `Run ${method}`}
        </button>
        {result && (
          <div className="staking-result" aria-live="polite">
            <p className="staking-result-status">Result: {result.status}</p>
            <dl className="staking-result-details">
              <div>
                <dt>Classification</dt>
                <dd>
                  <code className="staking-classification">{result.classification}</code>
                </dd>
              </div>
              {result.derivedHash && (
                <div>
                  <dt>Derived / direct hash</dt>
                  <dd>
                    <code>{result.derivedHash}</code>
                    {result.hashSource ? ` (source: ${result.hashSource})` : ''}
                  </dd>
                </div>
              )}
              <div><dt>Arguments</dt><dd><pre>{result.arguments}</pre></dd></div>
              <div><dt>Exact typeof</dt><dd><code>{result.resultType}</code></dd></div>
              {result.providerError && <div><dt>Provider error</dt><dd>{result.providerError}</dd></div>}
              <div><dt>Raw return or error</dt><dd><pre>{result.raw}</pre></dd></div>
            </dl>
            {result.status === 'success' && result.classification === 'raw' && (
              <p className="staking-result-note">
                String could not be classified as 64-hex or parseable serialized tx. Paste the raw value into the spike report; do not invent a hash.
              </p>
            )}
            {result.status === 'success' && result.classification === 'serialized→hash' && (
              <p className="staking-result-note">
                Package hypothesis: serialized tx. Hash was derived via Transaction.fromAny. Device + RPC must still confirm broadcast and chain visibility.
              </p>
            )}
            {result.status === 'success' && result.classification === 'hash' && (
              <p className="staking-result-note">
                Provider returned a 64-hex string treated as a direct hash. Still verify via getTransactionByHash on testnet RPC.
              </p>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <main className="shell staking-spike-shell">
      <header className="shell-header">
        <p className="eyebrow">P0-03 / testnet provider writes</p>
        <h1>Staking methods</h1>
      </header>

      <section className="nq-card nq-card-lg shell-card staking-warning" aria-labelledby="staking-warning-title">
        <p className="card-kicker">Manual device harness</p>
        <h2 id="staking-warning-title">TESTNET ONLY. Every enabled button can change staking state.</h2>
        <p>
          Use only a disposable testnet wallet and minimum safe amounts. The native Nimiq Pay confirmation remains required; this harness never requests, receives, stores, or displays keys or seed phrases, and it never submits a method automatically.
        </p>
        <label className="staking-warning-check">
          <input
            type="checkbox"
            checked={testnetAcknowledged}
            onChange={(event) => setTestnetAcknowledged(event.target.checked)}
          />
          <span>I understand this is a real testnet wallet action and I will verify the provider confirmation before approving it.</span>
        </label>
      </section>

      <section className="nq-card shell-card staking-context" aria-labelledby="staking-context-title">
        <p className="card-kicker">Provider context</p>
        <h2 id="staking-context-title">No method runs on load.</h2>
        <dl className="staking-context-results">
          <div><dt>Provider present</dt><dd>{typeof window.nimiq === 'undefined' ? 'No' : 'Yes'}</dd></div>
          <div><dt>Provider warmup</dt><dd>{providerState}</dd></div>
          <div><dt>Network after click</dt><dd>{network ?? 'Not checked'}</dd></div>
          <div><dt>Connected address</dt><dd>{account ?? 'Not checked'}</dd></div>
        </dl>
        <div className="staking-report-actions">
          <button className="nq-button nq-button-secondary" type="button" onClick={() => void copyReportJson()}>
            Copy report JSON
          </button>
          <button className="nq-button nq-button-secondary" type="button" onClick={downloadReportJson}>
            Download steakout-p0-03-report.json
          </button>
        </div>
        {copyStatus && <p className="staking-copy-status" role="status">{copyStatus}</p>}
        <p className="staking-result-note">
          Report includes every method result + classification (`hash` | `serialized→hash` | `raw` | `error`). Paste into `docs/spikes/staking-methods.md` after a real device run only.
        </p>
      </section>

      <section className="staking-method-list" aria-labelledby="staking-methods-title">
        <div className="staking-section-heading">
          <p className="card-kicker">One click per method</p>
          <h2 id="staking-methods-title">Review, then call exactly one provider method.</h2>
          <p>All amounts are integer Luna. No fee or validity height is supplied, so the exact arguments shown are the arguments sent.</p>
        </div>

        {renderMethodCard(
          'sendNewStakerTransaction',
          'Create staker',
          'Creates the staker account and delegates the supplied amount to a validator.',
          'No staker -> pending/active delegated staker; confirm the actual timing and balances through RPC.',
          <>
            <label>Validator delegation<input value={inputs.delegation} onChange={(event) => setInput('delegation', event.target.value)} placeholder="NQ..." autoComplete="off" /></label>
            <label>Stake value (Luna)<input type="number" min="1" step="1" inputMode="numeric" value={inputs.value} onChange={(event) => setInput('value', event.target.value)} /></label>
          </>,
        )}
        {renderMethodCard(
          'sendStakeTransaction',
          'Add stake',
          'Adds value to an existing staker account.',
          'Existing staker -> increased stake, subject to protocol activation timing.',
          <label>Stake value (Luna)<input type="number" min="1" step="1" inputMode="numeric" value={inputs.value} onChange={(event) => setInput('value', event.target.value)} /></label>,
        )}
        {renderMethodCard(
          'sendSetActiveStakeTransaction',
          'Set active stake',
          'Sets the requested active stake balance for an existing staker.',
          'Active/inactive stake balances -> requested active balance after protocol timing.',
          <label>New active balance (Luna)<input type="number" min="1" step="1" inputMode="numeric" value={inputs.newActiveBalance} onChange={(event) => setInput('newActiveBalance', event.target.value)} /></label>,
        )}
        {renderMethodCard(
          'sendUpdateStakerTransaction',
          'Change delegation',
          'Changes the staker delegation and optionally requests reactivation of all stake.',
          'Existing delegation -> new delegation, with reactivation behavior and reporting-window timing to verify.',
          <>
            <label>New validator delegation<input value={inputs.newDelegation} onChange={(event) => setInput('newDelegation', event.target.value)} placeholder="NQ..." autoComplete="off" /></label>
            <label className="staking-inline-check"><input type="checkbox" checked={inputs.reactivateAllStake} onChange={(event) => setInput('reactivateAllStake', event.target.checked)} /> Reactivate all stake</label>
          </>,
        )}
        {renderMethodCard(
          'sendRetireStakeTransaction',
          'Retire stake',
          'Moves the requested amount into the protocol retirement path; it is not an immediate removal.',
          'Active stake -> retiring/retired balance; capture waiting-period behavior and resulting RPC fields.',
          <label>Retire amount (Luna)<input type="number" min="1" step="1" inputMode="numeric" value={inputs.retireStake} onChange={(event) => setInput('retireStake', event.target.value)} /></label>,
        )}
        {renderMethodCard(
          'sendRemoveStakeTransaction',
          'Remove stake',
          'Removes retired stake that the protocol currently allows to be withdrawn.',
          'Withdrawable retired stake -> removed stake/basic balance; verify the precondition and timing.',
          <label>Remove amount (Luna)<input type="number" min="1" step="1" inputMode="numeric" value={inputs.value} onChange={(event) => setInput('value', event.target.value)} /></label>,
        )}
      </section>
    </main>
  )
}

export default StakingMethods
