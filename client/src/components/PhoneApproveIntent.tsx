/**
 * Inside Nimiq Pay: load a desktop-created staking intent and run provider + confirm.
 * Deep link: ?approveIntent=<intentId>
 */

import { useCallback, useEffect, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  clearApproveIntentFromLocation,
  getStakingIntent,
  pollConfirmStakingIntent,
  readApproveIntentIdFromLocation,
  type StakingIntentView,
  type StakingOperation,
} from '../api/staking'
import { fetchStakingPosition, type StakingPositionData } from '../api/position'
import {
  sendNewStakerTransaction,
  sendRemoveStakeTransaction,
  sendRetireStakeTransaction,
  sendStakeTransaction,
  sendUpdateStakerTransaction,
} from '../nimiq'
import ReviewSheet from '../staking/ReviewSheet'
import './OpenInNimiqPayQr.css'

export interface PhoneApproveIntentProps {
  enabled: boolean
  walletConnected: boolean
  connecting?: boolean
  nimiq: NimiqProvider | null
  onConnect: () => void
  onDone?: (position: StakingPositionData | null) => void
}

export default function PhoneApproveIntent({
  enabled,
  walletConnected,
  connecting = false,
  nimiq,
  onConnect,
  onDone,
}: PhoneApproveIntentProps) {
  const [intentId] = useState(() => readApproveIntentIdFromLocation())
  const [view, setView] = useState<StakingIntentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')

  useEffect(() => {
    if (!enabled || !intentId || !walletConnected) return
    let cancelled = false
    setLoadState('loading')
    void (async () => {
      try {
        const loaded = await getStakingIntent(intentId)
        if (cancelled) return
        if (loaded.status !== 'pending') {
          setError(
            loaded.status === 'confirmed'
              ? 'This stake was already confirmed.'
              : `This intent is ${loaded.status}. Start again from desktop.`,
          )
          setLoadState('missing')
          return
        }
        setView(loaded)
        setLoadState('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load stake to approve.')
          setLoadState('missing')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, intentId, walletConnected])

  const runApprove = useCallback(async () => {
    if (!view || busy) return
    setBusy(true)
    setError(null)
    try {
      const op = view.operation as StakingOperation
      let outcome
      if (op === 'new-staker') {
        outcome = await sendNewStakerTransaction(
          {
            delegation: view.params.delegation || view.summary.validatorAddress || '',
            value: view.params.valueLuna ?? view.summary.amountLuna ?? 0,
          },
          nimiq,
        )
      } else if (op === 'stake') {
        outcome = await sendStakeTransaction(
          { value: view.params.valueLuna ?? view.summary.amountLuna ?? 0 },
          nimiq,
        )
      } else if (op === 'update-staker') {
        outcome = await sendUpdateStakerTransaction(
          {
            newDelegation:
              view.params.newDelegation || view.summary.validatorAddress || '',
            reactivateAllStake: view.params.reactivateAllStake ?? true,
          },
          nimiq,
        )
      } else if (op === 'retire') {
        outcome = await sendRetireStakeTransaction(
          {
            retireStake: view.params.retireStakeLuna ?? view.summary.amountLuna ?? 0,
          },
          nimiq,
        )
      } else if (op === 'remove') {
        outcome = await sendRemoveStakeTransaction(
          { value: view.params.valueLuna ?? view.summary.amountLuna ?? 0 },
          nimiq,
        )
      } else {
        throw new Error('Unsupported operation on phone approve.')
      }

      if (outcome.kind === 'error') {
        throw new Error(outcome.message || 'Wallet could not complete the request.')
      }
      const txHash = outcome.kind === 'hash' ? outcome.hash : outcome.value
      const confirmed = await pollConfirmStakingIntent({
        intentId: view.intentId,
        txHash,
      })
      setDone(true)
      clearApproveIntentFromLocation()
      let position: StakingPositionData | null = confirmed.position
      try {
        const env = await fetchStakingPosition()
        position = env.data
      } catch {
        /* use confirm payload */
      }
      onDone?.(position)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed.')
    } finally {
      setBusy(false)
    }
  }, [view, busy, nimiq, onDone])

  if (!enabled || !intentId) return null

  return (
    <section className="open-in-pay-qr" aria-labelledby="phone-approve-title">
      <h2 id="phone-approve-title" className="open-in-pay-qr-title">
        Approve stake from desktop
      </h2>
      <p className="open-in-pay-qr-lede">
        Desktop prepared a staking action. Connect this Pay wallet (same address), review, then
        approve the native Pay sheet.
      </p>

      {!walletConnected ? (
        <div className="open-in-pay-qr-actions">
          <button
            type="button"
            className="nq-pill-blue open-in-pay-qr-btn"
            disabled={connecting}
            onClick={onConnect}
          >
            {connecting ? 'Connecting…' : 'Connect in Pay'}
          </button>
        </div>
      ) : null}

      {loadState === 'loading' ? (
        <p className="open-in-pay-qr-pair-status" role="status">
          Loading stake details…
        </p>
      ) : null}

      {error ? (
        <p className="home-error" role="alert">
          {error}
        </p>
      ) : null}

      {done ? (
        <p className="open-in-pay-qr-pair-status" role="status">
          Stake confirmed. You can return to the desktop browser — it should update shortly.
        </p>
      ) : null}

      {view && loadState === 'ready' && !done ? (
        <ReviewSheet
          summary={view.summary}
          busy={busy}
          onConfirm={() => {
            void runApprove()
          }}
          onCancel={() => {
            clearApproveIntentFromLocation()
            window.location.hash = '#/'
          }}
        />
      ) : null}
    </section>
  )
}
