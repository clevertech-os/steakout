/**
 * Stake flow orchestration (P1-12): amount → intent → ReviewSheet → provider →
 * confirm poll → position refresh.
 *
 * Invariant #3: no provider method runs without ReviewSheet Confirm.
 * Invariant #2: success only after server confirm match.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { formatDisplayAddress, shortAddress } from '../addresses'
import { ApiError } from '../api/http'
import {
  createStakingIntent,
  pollConfirmStakingIntent,
  type IntentSummary,
  type StakingOperation,
} from '../api/staking'
import type { PositionState, StakingPositionData } from '../api/position'
import { fetchStakingPosition } from '../api/position'
import Amount from '../components/Amount'
import { humanizeFetchError } from '../components/humanizeError'
import { formatNimFromLuna, lunaToNim } from '../luna'
import {
  sendNewStakerTransaction,
  sendStakeTransaction,
} from '../nimiq'
import {
  isStakeAmountAllowed,
  maxSafeStakeLuna,
  parseNimInputToLuna,
  presetStakeLuna,
  type AmountPresetId,
} from './amounts'
import {
  STAKE_AMOUNT_LEDE,
  STAKE_AMOUNT_TITLE,
  STAKE_BACK_HOME,
  STAKE_CANCEL,
  STAKE_CANCELLED,
  STAKE_CONFIRM_TIMEOUT,
  STAKE_CONNECT_FIRST,
  STAKE_CONTINUE_REVIEW,
  STAKE_DONE,
  STAKE_FEE_HEADROOM_NOTE,
  STAKE_IN_PROGRESS,
  STAKE_INTENT_GONE,
  STAKE_NON_CUSTODIAL,
  STAKE_OTHER_VALIDATOR,
  STAKE_PENDING_BODY,
  STAKE_PENDING_TITLE,
  STAKE_PRESET_25,
  STAKE_PRESET_50,
  STAKE_PRESET_CUSTOM,
  STAKE_PRESET_MAX,
  STAKE_PROVIDER_ERROR,
  STAKE_SUCCESS_BODY,
  STAKE_SUCCESS_TITLE,
  STAKE_TX_FAILED,
  STAKE_TX_MISMATCH,
} from './copy'
import {
  clearPendingIntent,
  loadPendingIntent,
  savePendingIntent,
} from './pendingIntent'
import ReviewSheet from './ReviewSheet'
import './StakeFlow.css'

export interface StakeFlowProps {
  /** Target validator (user-friendly NQ address). */
  validatorAddress: string
  validatorName: string | null
  /** Connected wallet address; null → prompt connect. */
  walletAddress: string | null
  /** Optional Pay provider instance from useWallet. */
  nimiq?: NimiqProvider | null
  /** Current position state when known. */
  positionState?: PositionState | null
  /** Account liquid balance in Luna (for presets). */
  availableLuna?: number | null
  /** Current delegation if already a staker. */
  currentDelegation?: string | null
  /** Open with deep-link auto-start (still requires amount + review). */
  autoOpen?: boolean
  onClose: () => void
  onConnectedRequest?: () => void
  onSuccess?: (position: StakingPositionData) => void
}

type Phase =
  | 'amount'
  | 'creating-intent'
  | 'review'
  | 'wallet'
  | 'polling'
  | 'success'
  | 'error'
  | 'resume'

interface ReviewState {
  intentId: string
  expiresAt: string
  summary: IntentSummary
}

export default function StakeFlow(props: StakeFlowProps) {
  const {
    validatorAddress,
    validatorName,
    walletAddress,
    nimiq,
    positionState,
    availableLuna,
    currentDelegation,
    onClose,
    onConnectedRequest,
    onSuccess,
  } = props

  const [phase, setPhase] = useState<Phase>('amount')
  const [preset, setPreset] = useState<AmountPresetId>('25')
  const [nimInput, setNimInput] = useState('')
  const [review, setReview] = useState<ReviewState | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string | null>(null)
  const [confirmedPosition, setConfirmedPosition] = useState<StakingPositionData | null>(
    null,
  )
  const [debugRaw, setDebugRaw] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submitLock = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const providerCalledRef = useRef(false)
  const resumeStartedRef = useRef(false)
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  const maxSafe = maxSafeStakeLuna(availableLuna)
  const valueLuna = resolveValueLuna(preset, nimInput, availableLuna)

  const otherValidator =
    Boolean(currentDelegation) &&
    Boolean(walletAddress) &&
    normalizeCmp(currentDelegation) !== normalizeCmp(validatorAddress) &&
    positionState != null &&
    positionState !== 'NotStaked'

  // Resume pending confirm after reload (once per mount).
  useEffect(() => {
    if (resumeStartedRef.current) return
    const pending = loadPendingIntent()
    if (!pending) return
    if (
      pending.validatorAddress &&
      normalizeCmp(pending.validatorAddress) !== normalizeCmp(validatorAddress)
    ) {
      return
    }
    resumeStartedRef.current = true
    setPhase('resume')
    setPendingNote(STAKE_PENDING_BODY)
    if (pending.rawProviderReturn) setDebugRaw(pending.rawProviderReturn)
    const ac = new AbortController()
    abortRef.current = ac
    void (async () => {
      try {
        const confirmed = await pollConfirmStakingIntent({
          intentId: pending.intentId,
          txHash: pending.txHash,
          signal: ac.signal,
          onTick: ({ message }) => setPendingNote(message),
        })
        clearPendingIntent()
        setConfirmedPosition(confirmed.position)
        setPhase('success')
        onSuccessRef.current?.(confirmed.position)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'CONFIRM_ABORTED') return
        // Keep pending on timeout so a later open can retry; drop on hard errors.
        if (!(err instanceof ApiError && err.code === 'CONFIRM_TIMEOUT')) {
          clearPendingIntent()
        }
        setErrorMessage(mapConfirmError(err))
        setPhase('error')
      }
    })()
    return () => {
      ac.abort()
    }
  }, [validatorAddress])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const applyPreset = useCallback(
    (id: AmountPresetId) => {
      setPreset(id)
      if (id === 'custom') return
      const luna = presetStakeLuna(availableLuna, id)
      if (luna > 0) {
        setNimInput(String(lunaToNim(luna)))
      } else {
        setNimInput('')
      }
    },
    [availableLuna],
  )

  // Seed default 25% when balance known
  useEffect(() => {
    if (preset !== '25') return
    if (nimInput) return
    const luna = presetStakeLuna(availableLuna, '25')
    if (luna > 0) setNimInput(String(lunaToNim(luna)))
  }, [availableLuna, preset, nimInput])

  async function handleContinueToReview() {
    if (submitLock.current || busy) {
      setErrorMessage(STAKE_IN_PROGRESS)
      return
    }
    if (!walletAddress) {
      setErrorMessage(STAKE_CONNECT_FIRST)
      onConnectedRequest?.()
      return
    }
    if (valueLuna == null || !isStakeAmountAllowed(valueLuna, availableLuna)) {
      setErrorMessage(
        maxSafe <= 0
          ? 'Available balance is too low after reserving fee headroom, or balance is unavailable.'
          : `Enter an amount between the minimum and maximum safe (${formatNimFromLuna(maxSafe)} NIM).`,
      )
      setPhase('error')
      return
    }

    const operation = resolveOperation(positionState, currentDelegation, validatorAddress)
    if (operation === 'blocked-other') {
      setErrorMessage(STAKE_OTHER_VALIDATOR)
      setPhase('error')
      return
    }

    submitLock.current = true
    setBusy(true)
    setErrorMessage(null)
    setPhase('creating-intent')
    providerCalledRef.current = false

    try {
      const params =
        operation === 'new-staker'
          ? { valueLuna, delegation: validatorAddress }
          : { valueLuna }

      const res = await createStakingIntent({ operation, params })
      // If server omits display fields, fill from known client context for review only
      // when summary is partial (server is still source of truth for matching).
      const summary = enrichSummary(res.summary, {
        operation,
        valueLuna,
        validatorAddress,
        validatorName,
        positionState,
      })
      setReview({
        intentId: res.intentId,
        expiresAt: res.expiresAt,
        summary,
      })
      setPhase('review')
    } catch (err) {
      setErrorMessage(humanizeFetchError(err, 'Could not create staking intent. Try again.'))
      setPhase('error')
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  async function handleReviewConfirm() {
    if (!review || submitLock.current) return
    if (providerCalledRef.current) {
      setErrorMessage(STAKE_IN_PROGRESS)
      return
    }

    submitLock.current = true
    setBusy(true)
    setPhase('wallet')
    setErrorMessage(null)
    providerCalledRef.current = true

    const operation = review.summary.operation
    const amount = review.summary.amountLuna
    if (amount == null || !Number.isSafeInteger(amount) || amount <= 0) {
      setErrorMessage('Review summary is missing a valid amount. Start again.')
      setPhase('error')
      submitLock.current = false
      setBusy(false)
      providerCalledRef.current = false
      return
    }

    try {
      let outcome
      if (operation === 'new-staker') {
        const delegation =
          review.summary.validatorAddress?.trim() || validatorAddress
        outcome = await sendNewStakerTransaction(
          { delegation, value: amount },
          nimiq,
        )
      } else if (operation === 'stake') {
        outcome = await sendStakeTransaction({ value: amount }, nimiq)
      } else {
        setErrorMessage(
          'This stake flow only supports create-staker and add-stake. Other operations are not available here yet.',
        )
        setPhase('error')
        return
      }

      if (outcome.kind === 'error') {
        const cancelled = /cancel|denied|reject|dismiss/i.test(outcome.message)
        setErrorMessage(cancelled ? STAKE_CANCELLED : STAKE_PROVIDER_ERROR)
        if (!cancelled && outcome.message) {
          setErrorMessage(`${STAKE_PROVIDER_ERROR} (${outcome.message})`)
        }
        setDebugRaw(outcome.raw)
        setPhase('error')
        // Intent remains unused; user can restart
        providerCalledRef.current = false
        return
      }

      const txHash = outcome.kind === 'hash' ? outcome.hash : outcome.value
      setDebugRaw(outcome.kind === 'raw' ? outcome.raw : null)

      savePendingIntent({
        intentId: review.intentId,
        txHash,
        expiresAt: review.expiresAt,
        validatorAddress,
        operation,
        createdAt: new Date().toISOString(),
        rawProviderReturn: outcome.kind === 'raw' ? outcome.raw : undefined,
      })

      setPhase('polling')
      setPendingNote(STAKE_PENDING_BODY)
      const ac = new AbortController()
      abortRef.current = ac

      const confirmed = await pollConfirmStakingIntent({
        intentId: review.intentId,
        txHash,
        signal: ac.signal,
        onTick: ({ message }) => setPendingNote(message),
      })

      clearPendingIntent()
      setConfirmedPosition(confirmed.position)
      setPhase('success')
      onSuccess?.(confirmed.position)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFIRM_ABORTED') return
      // Keep pending record on timeout so reload can resume
      if (!(err instanceof ApiError && err.code === 'CONFIRM_TIMEOUT')) {
        clearPendingIntent()
      }
      setErrorMessage(mapConfirmError(err))
      setPhase('error')
      providerCalledRef.current = false
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  function handleCancelReview() {
    if (busy && phase === 'wallet') return
    setReview(null)
    setPhase('amount')
    providerCalledRef.current = false
  }

  function handleClose() {
    abortRef.current?.abort()
    onClose()
  }

  // Disconnect gate
  if (!walletAddress) {
    return (
      <div className="stake-flow-root" role="dialog" aria-modal="true" aria-labelledby="stake-flow-title">
        <button type="button" className="stake-flow-backdrop" aria-label="Close" onClick={handleClose} />
        <div className="stake-flow-panel">
          <h2 id="stake-flow-title" className="stake-flow-title">
            Connect to stake
          </h2>
          <p className="stake-flow-copy">{STAKE_CONNECT_FIRST}</p>
          <div className="stake-flow-actions">
            <button
              type="button"
              className="nq-pill-blue nq-pill-lg stake-flow-primary"
              onClick={() => onConnectedRequest?.()}
            >
              Connect wallet
            </button>
            <button type="button" className="nq-pill-secondary" onClick={handleClose}>
              {STAKE_CANCEL}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stake-flow-root" role="dialog" aria-modal="true" aria-labelledby="stake-flow-title">
      <button
        type="button"
        className="stake-flow-backdrop"
        aria-label="Close stake flow"
        disabled={phase === 'wallet' || phase === 'polling'}
        onClick={handleClose}
      />
      <div className="stake-flow-panel">
        {(phase === 'amount' || phase === 'creating-intent') && (
          <>
            <header className="stake-flow-header">
              <p className="card-kicker">Stake</p>
              <h2 id="stake-flow-title" className="stake-flow-title">
                {STAKE_AMOUNT_TITLE}
              </h2>
              <p className="stake-flow-copy">{STAKE_AMOUNT_LEDE}</p>
            </header>

            <div className="stake-flow-validator">
              <p className="nq-label">Validator</p>
              <p className="stake-flow-validator-name">
                {validatorName?.trim() || shortAddress(validatorAddress)}
              </p>
              <p className="stake-flow-validator-addr mono" title={validatorAddress}>
                {formatDisplayAddress(validatorAddress)}
              </p>
            </div>

            <div className="stake-flow-balance">
              <p className="nq-label">Available</p>
              <Amount luna={availableLuna ?? null} label="Available balance" />
              <p className="stake-flow-muted">
                Maximum safe:{' '}
                <span className="mono">{formatNimFromLuna(maxSafe)} NIM</span>
              </p>
            </div>

            {otherValidator ? (
              <p className="stake-flow-warn" role="status">
                {STAKE_OTHER_VALIDATOR}
              </p>
            ) : null}

            <div className="stake-flow-presets" role="group" aria-label="Amount presets">
              {(
                [
                  ['25', STAKE_PRESET_25],
                  ['50', STAKE_PRESET_50],
                  ['max-safe', STAKE_PRESET_MAX],
                  ['custom', STAKE_PRESET_CUSTOM],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={
                    preset === id
                      ? 'nq-pill-blue stake-flow-preset'
                      : 'nq-pill-secondary stake-flow-preset'
                  }
                  onClick={() => applyPreset(id)}
                  disabled={busy || (id !== 'custom' && maxSafe <= 0)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="stake-flow-muted stake-flow-headroom">{STAKE_FEE_HEADROOM_NOTE}</p>

            <label className="stake-flow-field">
              <span className="nq-label">Amount (NIM)</span>
              <input
                className="stake-flow-input mono"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={nimInput}
                disabled={busy}
                onChange={(e) => {
                  setPreset('custom')
                  setNimInput(e.target.value)
                }}
              />
            </label>

            <p className="stake-flow-trust">{STAKE_NON_CUSTODIAL}</p>

            {errorMessage && phase === 'creating-intent' ? (
              <p className="stake-flow-error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="stake-flow-actions">
              <button
                type="button"
                className="nq-pill-blue nq-pill-lg stake-flow-primary"
                disabled={
                  busy ||
                  otherValidator ||
                  valueLuna == null ||
                  !isStakeAmountAllowed(valueLuna, availableLuna)
                }
                onClick={() => void handleContinueToReview()}
              >
                {phase === 'creating-intent' ? 'Preparing review…' : STAKE_CONTINUE_REVIEW}
              </button>
              <button type="button" className="nq-pill-secondary" disabled={busy} onClick={handleClose}>
                {STAKE_CANCEL}
              </button>
            </div>
          </>
        )}

        {(phase === 'polling' || phase === 'resume') && (
          <>
            <h2 id="stake-flow-title" className="stake-flow-title">
              {STAKE_PENDING_TITLE}
            </h2>
            <p className="stake-flow-copy">{pendingNote ?? STAKE_PENDING_BODY}</p>
            {debugRaw ? (
              <p className="stake-flow-debug mono" title="Provider return">
                Ref: {truncateMiddle(debugRaw, 48)}
              </p>
            ) : null}
            <p className="stake-flow-muted" role="status">
              Matching on chain…
            </p>
          </>
        )}

        {phase === 'wallet' && (
          <>
            <h2 id="stake-flow-title" className="stake-flow-title">
              Approve in wallet
            </h2>
            <p className="stake-flow-copy">
              Complete or cancel the request in Nimiq Pay. Steakout will not mark success until the
              server matches the transaction on chain.
            </p>
          </>
        )}

        {phase === 'success' && confirmedPosition && (
          <>
            <h2 id="stake-flow-title" className="stake-flow-title">
              {STAKE_SUCCESS_TITLE}
            </h2>
            <p className="stake-flow-copy">{STAKE_SUCCESS_BODY}</p>
            <div className="stake-flow-success-stats">
              <p className="nq-label">Position state</p>
              <p className="stake-flow-validator-name">{confirmedPosition.state}</p>
              <p className="nq-label">Total staked</p>
              <Amount luna={confirmedPosition.staker.totalLuna} size="lg" label="Total staked" />
            </div>
            <div className="stake-flow-actions">
              <a className="nq-pill-blue nq-pill-lg stake-flow-primary" href="#/" onClick={handleClose}>
                {STAKE_BACK_HOME}
              </a>
              <button type="button" className="nq-pill-secondary" onClick={handleClose}>
                {STAKE_DONE}
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <h2 id="stake-flow-title" className="stake-flow-title">
              Could not finish
            </h2>
            <p className="stake-flow-error" role="alert">
              {errorMessage}
            </p>
            {debugRaw ? (
              <p className="stake-flow-debug mono">Detail: {truncateMiddle(debugRaw, 64)}</p>
            ) : null}
            <div className="stake-flow-actions">
              <button
                type="button"
                className="nq-pill-blue nq-pill-lg stake-flow-primary"
                onClick={() => {
                  setErrorMessage(null)
                  setDebugRaw(null)
                  setReview(null)
                  providerCalledRef.current = false
                  setPhase('amount')
                }}
              >
                Try again
              </button>
              <button type="button" className="nq-pill-secondary" onClick={handleClose}>
                {STAKE_CANCEL}
              </button>
            </div>
          </>
        )}
      </div>

      {phase === 'review' && review ? (
        <ReviewSheet
          summary={review.summary}
          busy={busy}
          onConfirm={() => void handleReviewConfirm()}
          onCancel={handleCancelReview}
        />
      ) : null}
    </div>
  )
}

/** Load available balance for stake flow when parent did not pass it. */
export async function loadAvailableLunaForStake(): Promise<{
  availableLuna: number | null
  positionState: PositionState | null
  currentDelegation: string | null
}> {
  try {
    const env = await fetchStakingPosition()
    return {
      availableLuna: env.data.accountBalanceLuna,
      positionState: env.data.state,
      currentDelegation: env.data.staker.delegation,
    }
  } catch {
    return { availableLuna: null, positionState: null, currentDelegation: null }
  }
}

function resolveValueLuna(
  preset: AmountPresetId,
  nimInput: string,
  availableLuna: number | null | undefined,
): number | null {
  if (preset !== 'custom') {
    const fromPreset = presetStakeLuna(availableLuna, preset)
    if (fromPreset > 0) return fromPreset
  }
  return parseNimInputToLuna(nimInput)
}

function resolveOperation(
  positionState: PositionState | null | undefined,
  currentDelegation: string | null | undefined,
  targetValidator: string,
): StakingOperation | 'blocked-other' {
  if (!positionState || positionState === 'NotStaked') return 'new-staker'
  if (
    currentDelegation &&
    normalizeCmp(currentDelegation) !== normalizeCmp(targetValidator)
  ) {
    // Stake-more still uses sendStakeTransaction (same staker); surface warning in UI.
    // Do not block add-stake to existing staker; note that delegation does not change.
    return 'stake'
  }
  return 'stake'
}

function enrichSummary(
  summary: IntentSummary,
  ctx: {
    operation: StakingOperation
    valueLuna: number
    validatorAddress: string
    validatorName: string | null
    positionState?: PositionState | null
  },
): IntentSummary {
  return {
    ...summary,
    operation: summary.operation || ctx.operation,
    operationLabel:
      summary.operationLabel ||
      (ctx.operation === 'new-staker' ? 'Create staker and delegate' : 'Add stake'),
    amountLuna: summary.amountLuna ?? ctx.valueLuna,
    validatorAddress: summary.validatorAddress ?? ctx.validatorAddress,
    validatorName: summary.validatorName ?? ctx.validatorName,
    stateFrom: summary.stateFrom ?? ctx.positionState ?? 'NotStaked',
    stateTo: summary.stateTo ?? 'Active',
    hasWaitingPeriod: summary.hasWaitingPeriod ?? false,
    waitingPeriodNote: summary.waitingPeriodNote ?? null,
  }
}

function mapConfirmError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'TX_MISMATCH':
        return STAKE_TX_MISMATCH
      case 'TX_FAILED':
        return STAKE_TX_FAILED
      case 'INTENT_NOT_FOUND':
        return STAKE_INTENT_GONE
      case 'CONFIRM_TIMEOUT':
        return STAKE_CONFIRM_TIMEOUT
      case 'WALLET_NOT_CONNECTED':
        return STAKE_CONNECT_FIRST
      default:
        return humanizeFetchError(err, STAKE_PROVIDER_ERROR)
    }
  }
  return humanizeFetchError(err, STAKE_PROVIDER_ERROR)
}

function normalizeCmp(address: string | null | undefined): string {
  return (address ?? '').replace(/\s+/g, '').toUpperCase()
}

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value
  const half = Math.floor((max - 1) / 2)
  return `${value.slice(0, half)}…${value.slice(-half)}`
}
