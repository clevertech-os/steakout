/**
 * Stake flow orchestration (P1-12 / P2-11 / P3-01): amount (or change-prep) →
 * intent → ReviewSheet → provider → confirm poll → position refresh.
 *
 * Modes:
 * - `stake` (default): create-staker / add-stake with amount entry
 * - `update`: change-validator via sendUpdateStakerTransaction (no amount)
 * - `retire`: retire stake amount → sendRetireStakeTransaction
 * - `remove`: remove withdrawable retired stake → sendRemoveStakeTransaction
 *
 * Invariant #3: no provider method runs without ReviewSheet Confirm.
 * Invariant #2: success only after server confirm match.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { formatDisplayAddress, shortAddress } from '../addresses'
import { ApiError } from '../api/http'
import {
  APPROVE_INTENT_PARAM,
  cancelPendingStakingIntents,
  createStakingIntent,
  getStakingIntent,
  pollConfirmStakingIntent,
  type IntentSummary,
  type StakingOperation,
} from '../api/staking'
import type { PositionState, StakingPositionData } from '../api/position'
import { fetchStakingPosition } from '../api/position'
import Amount from '../components/Amount'
import OpenInNimiqPayQr from '../components/OpenInNimiqPayQr'
import { humanizeFetchError } from '../components/humanizeError'
import { formatNimFromLuna, lunaToNim } from '../luna'
import {
  getPhoneReachableMiniAppUrl,
  isNimiqPayHost,
  sendNewStakerTransaction,
  sendRemoveStakeTransaction,
  sendRetireStakeTransaction,
  sendStakeTransaction,
  sendUpdateStakerTransaction,
} from '../nimiq'
import {
  isPoolAmountAllowed,
  isStakeAmountAllowed,
  maxRemoveLuna,
  maxRetireLuna,
  maxSafeStakeLuna,
  parseNimInputToLuna,
  presetPoolLuna,
  presetStakeLuna,
  type AmountPresetId,
} from './amounts'
import {
  OPERATION_LABELS,
  REMOVE_AMOUNT_LEDE,
  REMOVE_AMOUNT_TITLE,
  REMOVE_NEED_WITHDRAWABLE,
  REMOVE_POOL_NOTE,
  REMOVE_PRESET_MAX,
  REMOVE_SUCCESS_BODY,
  REMOVE_SUCCESS_TITLE,
  REMOVE_WAITING_PERIOD_NOTE,
  RETIRE_AMOUNT_LEDE,
  RETIRE_AMOUNT_TITLE,
  RETIRE_NEED_POSITION,
  RETIRE_POOL_NOTE,
  RETIRE_PRESET_MAX,
  RETIRE_SUCCESS_BODY,
  RETIRE_SUCCESS_TITLE,
  RETIRE_WAITING_PERIOD_NOTE,
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
  STAKE_WALLET_BUDGET_NOTE,
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
  UPDATE_AMOUNT_LEDE,
  UPDATE_AMOUNT_TITLE,
  UPDATE_NEED_POSITION,
  UPDATE_REACTIVATE_NOTE,
  UPDATE_SAME_VALIDATOR,
  UPDATE_SUCCESS_BODY,
  UPDATE_SUCCESS_TITLE,
  UPDATE_WAITING_PERIOD_NOTE,
} from './copy'
import {
  clearPendingIntent,
  loadPendingIntent,
  savePendingIntent,
} from './pendingIntent'
import ReviewSheet from './ReviewSheet'
import './StakeFlow.css'

export type StakeFlowMode = 'stake' | 'update' | 'retire' | 'remove'

export interface StakerBalanceSnapshot {
  activeLuna: number
  inactiveLuna: number
  retiredLuna: number
}

export interface StakeFlowProps {
  /**
   * Target / current validator (user-friendly NQ address).
   * For remove with no delegation, may be empty; review shows "not specified".
   */
  validatorAddress: string
  validatorName: string | null
  /** Connected wallet address; null → prompt connect. */
  walletAddress: string | null
  /** Optional Pay provider instance from useWallet. */
  nimiq?: NimiqProvider | null
  /** Current position state when known. */
  positionState?: PositionState | null
  /**
   * Stake budget in Luna (presets + max-safe). Prefer Pay-aligned wallet total
   * (free + open HTLC as sender) so we can test whether Pay funds stake from contracts.
   */
  availableLuna?: number | null
  /** Free basic-account balance (display only when stake budget includes HTLCs). */
  freeBalanceLuna?: number | null
  /** Open HTLC-as-sender balance included in availableLuna (display only). */
  htlcBalanceLuna?: number | null
  /** Current delegation if already a staker. */
  currentDelegation?: string | null
  /** Staker bucket balances for retire/remove pool sizes. */
  stakerBalances?: StakerBalanceSnapshot | null
  /**
   * `stake` (default): create/add stake with amount.
   * `update`: change-validator (no amount; sendUpdateStakerTransaction).
   * `retire` / `remove`: lifecycle amounts from staker buckets (P3-01).
   */
  mode?: StakeFlowMode
  /** Open with deep-link auto-start (still requires amount + review for stake). */
  autoOpen?: boolean
  onClose: () => void
  onConnectedRequest?: () => void
  onSuccess?: (position: StakingPositionData) => void
}

type Phase =
  | 'amount'
  | 'prep'
  | 'creating-intent'
  | 'review'
  | 'wallet'
  | 'phone-approve'
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
    freeBalanceLuna,
    htlcBalanceLuna,
    currentDelegation,
    stakerBalances,
    mode = 'stake',
    onClose,
    onConnectedRequest,
    onSuccess,
  } = props

  const isUpdate = mode === 'update'
  const isRetire = mode === 'retire'
  const isRemove = mode === 'remove'
  const isLifecycle = isRetire || isRemove
  const isAmountMode = mode === 'stake' || isLifecycle

  const [phase, setPhase] = useState<Phase>(isUpdate ? 'prep' : 'amount')
  const [preset, setPreset] = useState<AmountPresetId>(isLifecycle ? 'max-safe' : '25')
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

  const poolLuna = isRetire
    ? maxRetireLuna(stakerBalances)
    : isRemove
      ? maxRemoveLuna(stakerBalances?.retiredLuna)
      : 0

  const maxSafe = isLifecycle ? poolLuna : maxSafeStakeLuna(availableLuna)
  const valueLuna = resolveValueLuna(preset, nimInput, availableLuna, poolLuna, mode)

  const sameAsCurrentDelegation =
    Boolean(currentDelegation) &&
    normalizeCmp(currentDelegation) === normalizeCmp(validatorAddress)

  const otherValidator =
    mode === 'stake' &&
    Boolean(currentDelegation) &&
    Boolean(walletAddress) &&
    normalizeCmp(currentDelegation) !== normalizeCmp(validatorAddress) &&
    positionState != null &&
    positionState !== 'NotStaked'

  const displayValidator =
    validatorAddress.trim() ||
    currentDelegation?.trim() ||
    ''

  // Resume pending confirm after reload (once per mount).
  useEffect(() => {
    if (resumeStartedRef.current) return
    const pending = loadPendingIntent()
    if (!pending) return
    if (
      pending.validatorAddress &&
      displayValidator &&
      normalizeCmp(pending.validatorAddress) !== normalizeCmp(displayValidator)
    ) {
      return
    }
    // Only resume if the pending operation matches this flow mode.
    if (isUpdate && pending.operation !== 'update-staker') return
    if (isRetire && pending.operation !== 'retire') return
    if (isRemove && pending.operation !== 'remove') return
    if (
      mode === 'stake' &&
      (pending.operation === 'update-staker' ||
        pending.operation === 'retire' ||
        pending.operation === 'remove')
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
  }, [displayValidator, isUpdate, isRetire, isRemove, mode])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const applyPreset = useCallback(
    (id: AmountPresetId) => {
      setPreset(id)
      if (id === 'custom') return
      const luna = isLifecycle
        ? presetPoolLuna(poolLuna, id)
        : presetStakeLuna(availableLuna, id)
      if (luna > 0) {
        setNimInput(String(lunaToNim(luna)))
      } else {
        setNimInput('')
      }
    },
    [availableLuna, isLifecycle, poolLuna],
  )

  // Seed default amount when pool/balance known
  useEffect(() => {
    if (isUpdate) return
    if (nimInput) return
    if (isLifecycle) {
      if (preset !== 'max-safe') return
      const luna = presetPoolLuna(poolLuna, 'max-safe')
      if (luna > 0) setNimInput(String(lunaToNim(luna)))
      return
    }
    if (preset !== '25') return
    const luna = presetStakeLuna(availableLuna, '25')
    if (luna > 0) setNimInput(String(lunaToNim(luna)))
  }, [availableLuna, preset, nimInput, isUpdate, isLifecycle, poolLuna])

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

    if (isUpdate) {
      if (
        !positionState ||
        positionState === 'NotStaked' ||
        (positionState !== 'Active' && positionState !== 'Inactive')
      ) {
        setErrorMessage(
          positionState === 'Pending'
            ? 'A staking action is already pending. Wait for it to complete before changing validator.'
            : UPDATE_NEED_POSITION,
        )
        setPhase('error')
        return
      }
      if (sameAsCurrentDelegation) {
        setErrorMessage(UPDATE_SAME_VALIDATOR)
        setPhase('error')
        return
      }
    } else if (isRetire) {
      if (
        !positionState ||
        (positionState !== 'Active' &&
          positionState !== 'Inactive' &&
          positionState !== 'Retiring')
      ) {
        setErrorMessage(RETIRE_NEED_POSITION)
        setPhase('error')
        return
      }
      if (valueLuna == null || !isPoolAmountAllowed(valueLuna, poolLuna)) {
        setErrorMessage(
          poolLuna <= 0
            ? 'No active or inactive stake is available to retire.'
            : `Enter an amount up to the retirable maximum (${formatNimFromLuna(poolLuna)} NIM).`,
        )
        setPhase('error')
        return
      }
    } else if (isRemove) {
      if (positionState !== 'Withdrawable') {
        setErrorMessage(REMOVE_NEED_WITHDRAWABLE)
        setPhase('error')
        return
      }
      if (valueLuna == null || !isPoolAmountAllowed(valueLuna, poolLuna)) {
        setErrorMessage(
          poolLuna <= 0
            ? 'No retired stake is available to remove.'
            : `Enter an amount up to the removable maximum (${formatNimFromLuna(poolLuna)} NIM).`,
        )
        setPhase('error')
        return
      }
    } else {
      if (valueLuna == null || !isStakeAmountAllowed(valueLuna, availableLuna)) {
        setErrorMessage(
          maxSafe <= 0
            ? 'Available balance is too low after reserving fee headroom, or balance is unavailable.'
            : `Enter an amount between the minimum and maximum safe (${formatNimFromLuna(maxSafe)} NIM).`,
        )
        setPhase('error')
        return
      }
    }

    const operation = isUpdate
      ? ('update-staker' as const)
      : isRetire
        ? ('retire' as const)
        : isRemove
          ? ('remove' as const)
          : resolveStakeOperation(positionState, currentDelegation, validatorAddress)

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
        operation === 'update-staker'
          ? {
              newDelegation: validatorAddress,
              // Prefer staying/becoming active after the reporting window.
              reactivateAllStake: true,
            }
          : operation === 'new-staker'
            ? { valueLuna: valueLuna!, delegation: validatorAddress }
            : operation === 'retire'
              ? { retireStakeLuna: valueLuna! }
              : operation === 'remove'
                ? { valueLuna: valueLuna! }
                : { valueLuna: valueLuna! }

      const res = await createStakingIntent({ operation, params })
      const summary = enrichSummary(res.summary, {
        operation,
        valueLuna: operation === 'update-staker' ? null : valueLuna ?? null,
        validatorAddress: displayValidator,
        validatorName,
        positionState,
        reactivateAllStake: operation === 'update-staker',
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

    if (
      operation === 'new-staker' ||
      operation === 'stake' ||
      operation === 'retire' ||
      operation === 'remove'
    ) {
      const amount = review.summary.amountLuna
      if (amount == null || !Number.isSafeInteger(amount) || amount <= 0) {
        setErrorMessage('Review summary is missing a valid amount. Start again.')
        setPhase('error')
        submitLock.current = false
        setBusy(false)
        providerCalledRef.current = false
        return
      }
    }

    if (operation === 'update-staker') {
      const target =
        review.summary.validatorAddress?.trim() || validatorAddress
      if (!target) {
        setErrorMessage('Review summary is missing the new validator. Start again.')
        setPhase('error')
        submitLock.current = false
        setBusy(false)
        providerCalledRef.current = false
        return
      }
    }

    const inPay = isNimiqPayHost() || Boolean(nimiq) || Boolean(typeof window !== 'undefined' && window.nimiq)

    // Desktop browser: cannot sign staking writes — hand off to phone Pay via QR.
    if (!inPay) {
      setPhase('phone-approve')
      setBusy(false)
      submitLock.current = false
      providerCalledRef.current = false
      setPendingNote('Waiting for approval in Nimiq Pay on your phone…')
      // Poll until phone confirms the same intent.
      const ac = new AbortController()
      abortRef.current = ac
      void (async () => {
        const started = Date.now()
        const maxMs = 14 * 60_000
        try {
          while (!ac.signal.aborted && Date.now() - started < maxMs) {
            const status = await getStakingIntent(review.intentId)
            if (status.status === 'confirmed') {
              const pos = await fetchStakingPosition().catch(() => null)
              const data = pos?.data ?? null
              if (data) {
                setConfirmedPosition(data)
                setPhase('success')
                onSuccess?.(data)
              } else {
                setPhase('success')
              }
              return
            }
            if (status.status === 'failed' || status.status === 'expired') {
              setErrorMessage(
                status.status === 'expired'
                  ? 'Phone approve window expired. Start the stake again from desktop.'
                  : 'Staking intent failed. Start again from desktop.',
              )
              setPhase('error')
              return
            }
            await new Promise((r) => setTimeout(r, 2500))
          }
          if (!ac.signal.aborted) {
            setErrorMessage(
              'Still waiting for phone approval. Open the QR in Nimiq Pay, or cancel and try again.',
            )
            setPhase('error')
          }
        } catch (err) {
          if (ac.signal.aborted) return
          setErrorMessage(mapConfirmError(err))
          setPhase('error')
        }
      })()
      return
    }

    try {
      let outcome
      if (operation === 'new-staker') {
        const delegation =
          review.summary.validatorAddress?.trim() || validatorAddress
        outcome = await sendNewStakerTransaction(
          { delegation, value: review.summary.amountLuna! },
          nimiq,
        )
      } else if (operation === 'stake') {
        outcome = await sendStakeTransaction(
          { value: review.summary.amountLuna! },
          nimiq,
        )
      } else if (operation === 'update-staker') {
        const newDelegation =
          review.summary.validatorAddress?.trim() || validatorAddress
        outcome = await sendUpdateStakerTransaction(
          { newDelegation, reactivateAllStake: true },
          nimiq,
        )
      } else if (operation === 'retire') {
        outcome = await sendRetireStakeTransaction(
          { retireStake: review.summary.amountLuna! },
          nimiq,
        )
      } else if (operation === 'remove') {
        outcome = await sendRemoveStakeTransaction(
          { value: review.summary.amountLuna! },
          nimiq,
        )
      } else {
        setErrorMessage(
          'This flow does not support that operation. Set-active and other methods are not offered from this screen.',
        )
        setPhase('error')
        return
      }

      if (outcome.kind === 'error') {
        const cancelled = /cancel|denied|reject|dismiss/i.test(outcome.message)
        if (cancelled) {
          setErrorMessage(STAKE_CANCELLED)
        } else {
          const detail = outcome.message?.trim()
          setErrorMessage(
            detail
              ? `${STAKE_PROVIDER_ERROR} ${detail}`
              : STAKE_PROVIDER_ERROR,
          )
        }
        setDebugRaw(outcome.raw ?? outcome.message)
        setPhase('error')
        // Abandon unused intent so "already pending" does not block retry.
        void abandonReviewIntent()
        providerCalledRef.current = false
        return
      }

      const txHash = outcome.kind === 'hash' ? outcome.hash : outcome.value
      setDebugRaw(outcome.kind === 'raw' ? outcome.raw : null)

      savePendingIntent({
        intentId: review.intentId,
        txHash,
        expiresAt: review.expiresAt,
        validatorAddress: displayValidator || validatorAddress,
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

  async function abandonReviewIntent() {
    clearPendingIntent()
    try {
      await cancelPendingStakingIntents()
    } catch {
      // Best-effort; create path also supersedes abandoned intents.
    }
  }

  function handleCancelReview() {
    if (busy && phase === 'wallet') return
    void abandonReviewIntent()
    setReview(null)
    setPhase(isUpdate ? 'prep' : 'amount')
    providerCalledRef.current = false
  }

  function handleClose() {
    abortRef.current?.abort()
    // Closing without a chain tx frees the pending lock (not while phone may still approve).
    if (review && !providerCalledRef.current && phase !== 'phone-approve') {
      void abandonReviewIntent()
    }
    if (phase === 'phone-approve') {
      void abandonReviewIntent()
    }
    onClose()
  }

  const phoneApproveAppUrl = (() => {
    if (!review) return undefined
    try {
      const base = getPhoneReachableMiniAppUrl()
      const url = new URL(base)
      url.searchParams.set(APPROVE_INTENT_PARAM, review.intentId)
      url.hash = '#/'
      return url.href
    } catch {
      return undefined
    }
  })()


  function resetToEntry() {
    setErrorMessage(null)
    setDebugRaw(null)
    setReview(null)
    providerCalledRef.current = false
    setPhase(isUpdate ? 'prep' : 'amount')
  }

  async function handleClearPendingAndRetry() {
    setBusy(true)
    setErrorMessage(null)
    try {
      await abandonReviewIntent()
      setPhase(isUpdate ? 'prep' : 'amount')
      setReview(null)
      providerCalledRef.current = false
    } catch (err) {
      setErrorMessage(
        humanizeFetchError(err, 'Could not clear the pending staking action. Try again in a moment.'),
      )
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  const connectTitle = isUpdate
    ? 'Connect to change validator'
    : isRetire
      ? 'Connect to retire stake'
      : isRemove
        ? 'Connect to remove stake'
        : 'Connect to stake'

  // Disconnect gate
  if (!walletAddress) {
    return (
      <div className="stake-flow-root" role="dialog" aria-modal="true" aria-labelledby="stake-flow-title">
        <button type="button" className="stake-flow-backdrop" aria-label="Close" onClick={handleClose} />
        <div className="stake-flow-panel">
          <h2 id="stake-flow-title" className="stake-flow-title">
            {connectTitle}
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

  const entryPhase = isUpdate
    ? phase === 'prep' || phase === 'creating-intent'
    : phase === 'amount' || phase === 'creating-intent'

  const successTitle = isUpdate
    ? UPDATE_SUCCESS_TITLE
    : isRetire
      ? RETIRE_SUCCESS_TITLE
      : isRemove
        ? REMOVE_SUCCESS_TITLE
        : STAKE_SUCCESS_TITLE
  const successBody = isUpdate
    ? UPDATE_SUCCESS_BODY
    : isRetire
      ? RETIRE_SUCCESS_BODY
      : isRemove
        ? REMOVE_SUCCESS_BODY
        : STAKE_SUCCESS_BODY

  const maxLabel = isRetire
    ? RETIRE_PRESET_MAX
    : isRemove
      ? REMOVE_PRESET_MAX
      : STAKE_PRESET_MAX

  const amountAllowed = isLifecycle
    ? valueLuna != null && isPoolAmountAllowed(valueLuna, poolLuna)
    : valueLuna != null && isStakeAmountAllowed(valueLuna, availableLuna)

  const retireStateOk =
    positionState === 'Active' ||
    positionState === 'Inactive' ||
    positionState === 'Retiring'
  const removeStateOk = positionState === 'Withdrawable'
  const continueDisabled =
    busy ||
    (isUpdate &&
      (sameAsCurrentDelegation ||
        !positionState ||
        (positionState !== 'Active' && positionState !== 'Inactive'))) ||
    (mode === 'stake' && (otherValidator || !amountAllowed)) ||
    (isRetire && (!retireStateOk || !amountAllowed)) ||
    (isRemove && (!removeStateOk || !amountAllowed))

  return (
    <div className="stake-flow-root" role="dialog" aria-modal="true" aria-labelledby="stake-flow-title">
      <button
        type="button"
        className="stake-flow-backdrop"
        aria-label={
          isUpdate
            ? 'Close change-validator flow'
            : isRetire
              ? 'Close retire flow'
              : isRemove
                ? 'Close remove flow'
                : 'Close stake flow'
        }
        disabled={phase === 'wallet' || phase === 'polling'}
        onClick={handleClose}
      />
      <div className="stake-flow-panel">
        {entryPhase && isUpdate && (
          <>
            <header className="stake-flow-header">
              <p className="card-kicker">Change validator</p>
              <h2 id="stake-flow-title" className="stake-flow-title">
                {UPDATE_AMOUNT_TITLE}
              </h2>
              <p className="stake-flow-copy">{UPDATE_AMOUNT_LEDE}</p>
            </header>

            {currentDelegation ? (
              <div className="stake-flow-validator">
                <p className="nq-label">Current delegation</p>
                <p className="stake-flow-validator-addr mono" title={currentDelegation}>
                  {formatDisplayAddress(currentDelegation)}
                </p>
              </div>
            ) : null}

            <div className="stake-flow-validator">
              <p className="nq-label">New validator</p>
              <p className="stake-flow-validator-name">
                {validatorName?.trim() || shortAddress(validatorAddress)}
              </p>
              <p className="stake-flow-validator-addr mono" title={validatorAddress}>
                {formatDisplayAddress(validatorAddress)}
              </p>
            </div>

            {sameAsCurrentDelegation ? (
              <p className="stake-flow-warn" role="status">
                {UPDATE_SAME_VALIDATOR}
              </p>
            ) : null}

            <p className="stake-flow-muted">{UPDATE_REACTIVATE_NOTE}</p>
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
                disabled={continueDisabled}
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

        {entryPhase && isAmountMode && (
          <>
            <header className="stake-flow-header">
              <p className="card-kicker">
                {isRetire ? 'Retire' : isRemove ? 'Remove' : 'Stake'}
              </p>
              <h2 id="stake-flow-title" className="stake-flow-title">
                {isRetire
                  ? RETIRE_AMOUNT_TITLE
                  : isRemove
                    ? REMOVE_AMOUNT_TITLE
                    : STAKE_AMOUNT_TITLE}
              </h2>
              <p className="stake-flow-copy">
                {isRetire
                  ? RETIRE_AMOUNT_LEDE
                  : isRemove
                    ? REMOVE_AMOUNT_LEDE
                    : STAKE_AMOUNT_LEDE}
              </p>
            </header>

            {displayValidator ? (
              <div className="stake-flow-validator">
                <p className="nq-label">
                  {isLifecycle ? 'Delegated validator' : 'Validator'}
                </p>
                <p className="stake-flow-validator-name">
                  {validatorName?.trim() || shortAddress(displayValidator)}
                </p>
                <p className="stake-flow-validator-addr mono" title={displayValidator}>
                  {formatDisplayAddress(displayValidator)}
                </p>
              </div>
            ) : isLifecycle ? (
              <div className="stake-flow-validator">
                <p className="nq-label">Delegated validator</p>
                <p className="stake-flow-muted">No delegation observed on this position.</p>
              </div>
            ) : null}

            <div className="stake-flow-balance">
              <p className="nq-label">
                {isRetire
                  ? 'Retirable (active + inactive)'
                  : isRemove
                    ? 'Removable (retired)'
                    : 'Wallet balance (stake budget)'}
              </p>
              <Amount
                luna={isLifecycle ? poolLuna : (availableLuna ?? null)}
                label={
                  isRetire
                    ? 'Retirable stake'
                    : isRemove
                      ? 'Removable stake'
                      : 'Wallet balance'
                }
              />
              {!isLifecycle &&
              (htlcBalanceLuna ?? 0) > 0 &&
              freeBalanceLuna != null ? (
                <p className="stake-flow-muted">
                  Free on address{' '}
                  <span className="mono">{formatNimFromLuna(freeBalanceLuna)} NIM</span>
                  {' · '}
                  In Pay contracts{' '}
                  <span className="mono">
                    {formatNimFromLuna(htlcBalanceLuna ?? 0)} NIM
                  </span>
                </p>
              ) : null}
              <p className="stake-flow-muted">
                Maximum:{' '}
                <span className="mono">{formatNimFromLuna(maxSafe)} NIM</span>
              </p>
              {isLifecycle ? (
                <p className="stake-flow-muted">
                  {isRetire ? RETIRE_POOL_NOTE : REMOVE_POOL_NOTE}
                </p>
              ) : (
                <p className="stake-flow-muted">{STAKE_WALLET_BUDGET_NOTE}</p>
              )}
            </div>

            {otherValidator ? (
              <p className="stake-flow-warn" role="status">
                {STAKE_OTHER_VALIDATOR}
              </p>
            ) : null}

            {isRetire && !retireStateOk ? (
              <p className="stake-flow-warn" role="status">
                {RETIRE_NEED_POSITION}
              </p>
            ) : null}
            {isRemove && !removeStateOk ? (
              <p className="stake-flow-warn" role="status">
                {REMOVE_NEED_WITHDRAWABLE}
              </p>
            ) : null}

            <div className="stake-flow-presets" role="group" aria-label="Amount presets">
              {(
                [
                  ['25', STAKE_PRESET_25],
                  ['50', STAKE_PRESET_50],
                  ['max-safe', maxLabel],
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
            {!isLifecycle ? (
              <p className="stake-flow-muted stake-flow-headroom">{STAKE_FEE_HEADROOM_NOTE}</p>
            ) : (
              <p className="stake-flow-muted stake-flow-headroom">
                {isRetire ? RETIRE_WAITING_PERIOD_NOTE : REMOVE_WAITING_PERIOD_NOTE}
              </p>
            )}

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
                className={
                  isLifecycle
                    ? 'nq-pill-red nq-pill-lg stake-flow-primary'
                    : 'nq-pill-blue nq-pill-lg stake-flow-primary'
                }
                disabled={continueDisabled}
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
              Complete the native Nimiq Pay confirmation. Steakout marks success only after chain
              match.
            </p>
            <p className="stake-flow-muted" role="status">
              Waiting for Nimiq Pay…
            </p>
          </>
        )}

        {phase === 'phone-approve' && review && (
          <>
            <h2 id="stake-flow-title" className="stake-flow-title">
              Approve on your phone
            </h2>
            <p className="stake-flow-copy">
              Desktop prepared this stake. Scan the QR to open Steakout <strong>inside Nimiq Pay</strong>,
              connect the same wallet, then approve the Pay confirmation sheet. This browser waits
              until the server confirms the transaction.
            </p>
            <OpenInNimiqPayQr
              compact
              linkDesktopSession={false}
              appUrl={phoneApproveAppUrl}
            />
            <p className="stake-flow-muted" role="status">
              {pendingNote ?? 'Waiting for phone approval…'}
            </p>
            <div className="stake-flow-actions">
              <button
                type="button"
                className="nq-pill-secondary"
                onClick={() => {
                  abortRef.current?.abort()
                  void abandonReviewIntent()
                  setReview(null)
                  setPhase(isUpdate ? 'prep' : 'amount')
                  providerCalledRef.current = false
                  submitLock.current = false
                  setBusy(false)
                }}
              >
                {STAKE_CANCEL}
              </button>
            </div>
          </>
        )}

        {phase === 'success' && confirmedPosition && (
          <>
            <h2 id="stake-flow-title" className="stake-flow-title">
              {successTitle}
            </h2>
            <p className="stake-flow-copy">{successBody}</p>
            <div className="stake-flow-success-stats">
              <p className="nq-label">Position state</p>
              <p className="stake-flow-validator-name">{confirmedPosition.state}</p>
              {confirmedPosition.staker.delegation ? (
                <>
                  <p className="nq-label">Delegated validator</p>
                  <p className="stake-flow-validator-addr mono" title={confirmedPosition.staker.delegation}>
                    {formatDisplayAddress(confirmedPosition.staker.delegation)}
                  </p>
                </>
              ) : null}
              <p className="nq-label">Total staked</p>
              <Amount luna={confirmedPosition.staker.totalLuna} size="lg" label="Total staked" />
              {isLifecycle ? (
                <>
                  <p className="nq-label">Retired</p>
                  <Amount
                    luna={confirmedPosition.staker.retiredLuna}
                    label="Retired after confirm"
                  />
                </>
              ) : null}
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
              <p className="stake-flow-debug mono" title={debugRaw}>
                Wallet detail: {truncateMiddle(debugRaw, 120)}
              </p>
            ) : null}
            <p className="stake-flow-copy stake-flow-muted">
              Common fixes: switch Nimiq Pay to <strong>testnet</strong> (Steakout is testnet), use a
              smaller amount (e.g. 10–100 NIM, not max), leave fee headroom, and pick a testnet
              validator. No on-chain change was confirmed by Steakout.
            </p>
            {/Nimiq Pay wallet not found/i.test(errorMessage ?? '') ? (
              <OpenInNimiqPayQr compact linkDesktopSession={false} />
            ) : null}
            {/already pending/i.test(errorMessage ?? '') ? (
              <p className="stake-flow-copy">
                A previous review was left open without finishing in the wallet. Clear it to start
                again, or open Steakout in Nimiq Pay to complete a real stake.
              </p>
            ) : null}
            <div className="stake-flow-actions">
              {/already pending/i.test(errorMessage ?? '') ? (
                <button
                  type="button"
                  className="nq-pill-blue nq-pill-lg stake-flow-primary"
                  disabled={busy}
                  onClick={() => {
                    void handleClearPendingAndRetry()
                  }}
                >
                  {busy ? 'Clearing…' : 'Clear pending and try again'}
                </button>
              ) : (
                <button
                  type="button"
                  className="nq-pill-blue nq-pill-lg stake-flow-primary"
                  onClick={resetToEntry}
                >
                  Try again
                </button>
              )}
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

/**
 * Load stake budget + staker buckets for stake/retire/remove flows.
 * Stake budget prefers Pay-aligned wallet total (free + open HTLC as sender).
 */
export async function loadAvailableLunaForStake(): Promise<{
  availableLuna: number | null
  freeBalanceLuna: number | null
  htlcBalanceLuna: number
  positionState: PositionState | null
  currentDelegation: string | null
  validatorName: string | null
  stakerBalances: StakerBalanceSnapshot | null
  withdrawableAt: string | null
}> {
  try {
    const env = await fetchStakingPosition({ fresh: true })
    const free = env.data.accountBalanceLuna
    const htlc = env.data.htlcBalanceLuna ?? 0
    const wallet =
      env.data.walletBalanceLuna != null
        ? env.data.walletBalanceLuna
        : free == null
          ? null
          : free + htlc
    return {
      availableLuna: wallet,
      freeBalanceLuna: free,
      htlcBalanceLuna: htlc,
      positionState: env.data.state,
      currentDelegation: env.data.staker.delegation,
      validatorName: env.data.staker.validatorName,
      stakerBalances: {
        activeLuna: env.data.staker.activeLuna,
        inactiveLuna: env.data.staker.inactiveLuna,
        retiredLuna: env.data.staker.retiredLuna,
      },
      withdrawableAt: env.data.retire.withdrawableAt,
    }
  } catch {
    return {
      availableLuna: null,
      freeBalanceLuna: null,
      htlcBalanceLuna: 0,
      positionState: null,
      currentDelegation: null,
      validatorName: null,
      stakerBalances: null,
      withdrawableAt: null,
    }
  }
}

function resolveValueLuna(
  preset: AmountPresetId,
  nimInput: string,
  availableLuna: number | null | undefined,
  poolLuna: number,
  mode: StakeFlowMode,
): number | null {
  if (preset !== 'custom') {
    if (mode === 'retire' || mode === 'remove') {
      const fromPool = presetPoolLuna(poolLuna, preset)
      if (fromPool > 0) return fromPool
    } else if (mode === 'stake') {
      const fromPreset = presetStakeLuna(availableLuna, preset)
      if (fromPreset > 0) return fromPreset
    }
  }
  return parseNimInputToLuna(nimInput)
}

function resolveStakeOperation(
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
    valueLuna: number | null
    validatorAddress: string
    validatorName: string | null
    positionState?: PositionState | null
    reactivateAllStake?: boolean
  },
): IntentSummary {
  const defaultWaiting =
    ctx.operation === 'update-staker'
      ? ctx.reactivateAllStake
        ? UPDATE_REACTIVATE_NOTE
        : UPDATE_WAITING_PERIOD_NOTE
      : ctx.operation === 'retire'
        ? RETIRE_WAITING_PERIOD_NOTE
        : ctx.operation === 'remove'
          ? REMOVE_WAITING_PERIOD_NOTE
          : null

  const defaultStateTo =
    ctx.operation === 'update-staker'
      ? ctx.positionState === 'Inactive' && ctx.reactivateAllStake
        ? 'Active'
        : (ctx.positionState ?? 'Active')
      : ctx.operation === 'retire'
        ? 'Retiring'
        : ctx.operation === 'remove'
          ? 'NotStaked'
          : 'Active'

  return {
    ...summary,
    operation: summary.operation || ctx.operation,
    operationLabel:
      summary.operationLabel ||
      OPERATION_LABELS[ctx.operation] ||
      (ctx.operation === 'new-staker' ? 'Create staker and delegate' : 'Add stake'),
    amountLuna:
      summary.amountLuna ??
      (ctx.operation === 'update-staker' ? null : ctx.valueLuna),
    validatorAddress: summary.validatorAddress ?? (ctx.validatorAddress || null),
    validatorName: summary.validatorName ?? ctx.validatorName,
    stateFrom: summary.stateFrom ?? ctx.positionState ?? 'NotStaked',
    stateTo: summary.stateTo ?? defaultStateTo,
    hasWaitingPeriod:
      summary.hasWaitingPeriod ??
      (ctx.operation === 'retire' || ctx.operation === 'remove'),
    waitingPeriodNote: summary.waitingPeriodNote ?? defaultWaiting,
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
