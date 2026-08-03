/**
 * Pre-confirmation review bottom sheet (SECURITY.md §2, STYLING.md ReviewSheet).
 * Never invokes the provider. Parent only calls the wallet after Confirm.
 */

import { formatDisplayAddress, shortAddress } from '../addresses'
import Amount from '../components/Amount'
import type { IntentSummary } from '../api/staking'
import {
  formatStateTransition,
  OPERATION_LABELS,
  REMOVE_REVIEW_TITLE,
  RETIRE_REVIEW_TITLE,
  STAKE_CANCEL,
  STAKE_CONFIRM_CTA,
  STAKE_MAINNET_REAL_AMOUNTS,
  STAKE_NO_ILLUSTRATIVE_ON_REVIEW,
  STAKE_NON_CUSTODIAL,
  STAKE_NO_WAITING_PERIOD,
  STAKE_REVIEW_BEFORE_CONFIRM,
  STAKE_REVIEW_TITLE,
  UPDATE_REVIEW_TITLE,
} from './copy'
import './ReviewSheet.css'

export interface ReviewSheetProps {
  summary: IntentSummary
  /** True while parent is submitting after Confirm (disables double-tap). */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ReviewSheet({
  summary,
  busy = false,
  onConfirm,
  onCancel,
}: ReviewSheetProps) {
  const isUpdate = summary.operation === 'update-staker'
  const isRetire = summary.operation === 'retire'
  const isRemove = summary.operation === 'remove'
  const isLifecycle = isRetire || isRemove

  const operationLabel =
    summary.operationLabel?.trim() ||
    OPERATION_LABELS[summary.operation] ||
    summary.operation

  const reviewTitle = isUpdate
    ? UPDATE_REVIEW_TITLE
    : isRetire
      ? RETIRE_REVIEW_TITLE
      : isRemove
        ? REMOVE_REVIEW_TITLE
        : STAKE_REVIEW_TITLE

  const validatorLabel =
    summary.validatorName?.trim() ||
    (summary.validatorAddress
      ? shortAddress(summary.validatorAddress)
      : 'Validator not specified')

  const transition = formatStateTransition(summary.stateFrom, summary.stateTo)

  const waitingNote =
    summary.hasWaitingPeriod
      ? summary.waitingPeriodNote?.trim() ||
        'This operation includes a protocol waiting period before funds can move again.'
      : summary.waitingPeriodNote?.trim() || STAKE_NO_WAITING_PERIOD

  return (
    <div
      className="review-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-sheet-title"
    >
      <button
        type="button"
        className="review-sheet-backdrop"
        aria-label="Dismiss review"
        disabled={busy}
        onClick={onCancel}
      />
      <div className="review-sheet-panel">
        <header className="review-sheet-header">
          <p className="card-kicker">Review before wallet</p>
          <h2 id="review-sheet-title" className="review-sheet-title">
            {reviewTitle}
          </h2>
          <p className="review-sheet-lede">{STAKE_REVIEW_BEFORE_CONFIRM}</p>
        </header>

        <dl className="review-sheet-facts">
          <div className="review-sheet-fact">
            <dt className="nq-label">Action</dt>
            <dd>{operationLabel}</dd>
          </div>

          <div className="review-sheet-fact">
            <dt className="nq-label">Amount</dt>
            <dd className="review-sheet-amount">
              {isUpdate ? (
                <span className="review-sheet-no-amount">
                  No stake amount moves. Only the delegation target changes.
                </span>
              ) : (
                <>
                  <Amount
                    luna={summary.amountLuna}
                    size="lg"
                    label={
                      isRetire
                        ? 'Retire amount'
                        : isRemove
                          ? 'Remove amount'
                          : 'Stake amount'
                    }
                  />
                  {summary.amountLuna != null && Number.isFinite(summary.amountLuna) ? (
                    <span className="review-sheet-luna mono">
                      {summary.amountLuna.toLocaleString()} Luna
                    </span>
                  ) : null}
                </>
              )}
            </dd>
          </div>

          <div className="review-sheet-fact">
            <dt className="nq-label">
              {isUpdate ? 'New validator' : isLifecycle ? 'Delegated validator' : 'Validator'}
            </dt>
            <dd>
              <span className="review-sheet-validator-name">{validatorLabel}</span>
              {summary.validatorAddress ? (
                <span className="review-sheet-validator-addr mono" title={summary.validatorAddress}>
                  {formatDisplayAddress(summary.validatorAddress)}
                </span>
              ) : null}
            </dd>
          </div>

          <div className="review-sheet-fact">
            <dt className="nq-label">Position transition</dt>
            <dd>{transition}</dd>
          </div>

          <div className="review-sheet-fact">
            <dt className="nq-label">Waiting period</dt>
            <dd className="review-sheet-note">{waitingNote}</dd>
          </div>
        </dl>

        {summary.notes && summary.notes.length > 0 ? (
          <ul className="review-sheet-notes">
            {summary.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <div className="review-sheet-trust">
          <p>{STAKE_NON_CUSTODIAL}</p>
          <p>{STAKE_MAINNET_REAL_AMOUNTS}</p>
          <p>{STAKE_NO_ILLUSTRATIVE_ON_REVIEW}</p>
        </div>

        <div className="review-sheet-actions">
          <button
            type="button"
            className={
              isLifecycle
                ? 'nq-pill-red nq-pill-lg review-sheet-confirm'
                : 'nq-pill-blue nq-pill-lg review-sheet-confirm'
            }
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Opening wallet…' : STAKE_CONFIRM_CTA}
          </button>
          <button
            type="button"
            className="nq-pill-secondary review-sheet-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {STAKE_CANCEL}
          </button>
        </div>
      </div>
    </div>
  )
}
