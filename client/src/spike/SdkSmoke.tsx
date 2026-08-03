import { useEffect, useRef, useState } from 'react'
import { init, type ErrorResponse, type NimiqProvider, type SignatureResult } from '@nimiq/mini-app-sdk'
import './SdkSmoke.css'

export const SDK_SMOKE_CHALLENGE = 'Steakout SDK smoke challenge 2026-08-02'

const SDK_INIT_TIMEOUT_MS = 10_000

type WarmupStatus = 'waiting' | 'warming' | 'ready' | 'unavailable'
type RunStatus = 'idle' | 'running' | 'complete' | 'failed'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProviderError(value: unknown): value is ErrorResponse {
  if (!isRecord(value) || !isRecord(value.error)) return false
  return typeof value.error.type === 'string' && typeof value.error.message === 'string'
}

function isSignatureResult(value: unknown): value is SignatureResult {
  return (
    isRecord(value) &&
    typeof value.publicKey === 'string' &&
    typeof value.signature === 'string'
  )
}

function getErrorMessage(value: unknown): string {
  if (isProviderError(value)) return value.error.message
  if (value instanceof Error) return value.message
  return 'The SDK smoke check failed.'
}

async function fetchBlockNumber(): Promise<number> {
  const response = await fetch('/api/spike/block-number')
  const payload: unknown = await response.json()

  if (!response.ok) {
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      throw new Error(payload.error.message)
    }
    throw new Error('The server block-number probe is unavailable.')
  }

  if (
    !isRecord(payload) ||
    !isRecord(payload.data) ||
    typeof payload.data.blockNumber !== 'number' ||
    !Number.isInteger(payload.data.blockNumber)
  ) {
    throw new Error('The server returned a malformed block-number probe result.')
  }

  return payload.data.blockNumber
}

function SdkSmoke() {
  const [providerPresent, setProviderPresent] = useState(() => typeof window.nimiq !== 'undefined')
  const [provider, setProvider] = useState<NimiqProvider | null>(null)
  const [warmupStatus, setWarmupStatus] = useState<WarmupStatus>('waiting')
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [network, setNetwork] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [signature, setSignature] = useState<SignatureResult | null>(null)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const warmupInFlight = useRef<Promise<NimiqProvider> | null>(null)

  const warmProvider = async (): Promise<NimiqProvider> => {
    setProviderPresent(typeof window.nimiq !== 'undefined')
    if (provider) return provider
    if (warmupInFlight.current) return warmupInFlight.current

    setWarmupStatus('warming')
    const warmup = init({ timeout: SDK_INIT_TIMEOUT_MS })
    warmupInFlight.current = warmup

    try {
      const detectedProvider = await warmup
      setProviderPresent(true)
      setProvider(detectedProvider)
      setWarmupStatus('ready')
      return detectedProvider
    } catch (cause) {
      setWarmupStatus('unavailable')
      throw cause
    } finally {
      if (warmupInFlight.current === warmup) warmupInFlight.current = null
    }
  }

  useEffect(() => {
    void warmProvider().catch(() => undefined)
  }, [])

  const runSmoke = async () => {
    setRunStatus('running')
    setError(null)
    setAccount(null)
    setSignature(null)
    setBlockNumber(null)

    try {
      const activeProvider = await warmProvider()
      await activeProvider.connect()
      setNetwork(activeProvider.getNetwork())

      const accountsResult = await activeProvider.listAccounts()
      if (isProviderError(accountsResult)) throw new Error(accountsResult.error.message)
      const firstAccount = accountsResult[0]
      if (!firstAccount) throw new Error('The provider returned no accounts.')
      setAccount(firstAccount)

      const signatureResult = await activeProvider.sign({
        message: SDK_SMOKE_CHALLENGE,
        isHex: false,
      })
      if (isProviderError(signatureResult)) throw new Error(signatureResult.error.message)
      if (!isSignatureResult(signatureResult)) throw new Error('The provider returned a malformed signature.')
      setSignature(signatureResult)

      setBlockNumber(await fetchBlockNumber())
      setRunStatus('complete')
    } catch (cause) {
      setRunStatus('failed')
      setError(getErrorMessage(cause))
    }
  }

  return (
    <main className="shell spike-shell">
      <header className="shell-header">
        <p className="eyebrow">P0-02 / Mini App SDK</p>
        <h1>SDK smoke</h1>
      </header>

      <section className="nq-card nq-card-lg shell-card spike-card" aria-labelledby="spike-title">
        <p className="card-kicker">Fixed challenge, no secrets</p>
        <h2 id="spike-title">Prove the wallet path before staking.</h2>
        <p className="spike-intro">
          This screen only reads the connected account, requests one fixed signature, and asks the
          server for the current block number. It never requests or stores keys or seed phrases.
        </p>

        <dl className="spike-results">
          <div><dt>Provider present</dt><dd>{providerPresent ? 'Yes' : 'No'}</dd></div>
          <div><dt>Provider warmup</dt><dd>{warmupStatus}</dd></div>
          <div><dt>Network</dt><dd>{network ?? 'Not checked'}</dd></div>
          <div><dt>Connected address</dt><dd>{account ?? 'Not checked'}</dd></div>
          <div><dt>Server block number</dt><dd>{blockNumber ?? 'Not checked'}</dd></div>
        </dl>

        <div className="spike-challenge">
          <span>Exact challenge</span>
          <code>{SDK_SMOKE_CHALLENGE}</code>
        </div>

        {signature && (
          <div className="spike-signature" aria-label="Signature result">
            <span>Signature result</span>
            <code>publicKey: {signature.publicKey}</code>
            <code>signature: {signature.signature}</code>
          </div>
        )}

        {error && <p className="spike-error" role="alert">{error}</p>}

        <button className="nq-button nq-button-primary" type="button" onClick={() => void runSmoke()} disabled={runStatus === 'running'}>
          {runStatus === 'running' ? 'Running smoke check...' : 'Run SDK smoke check'}
        </button>
        <p className="spike-status" aria-live="polite">Run status: {runStatus}</p>
      </section>
    </main>
  )
}

export default SdkSmoke
