/**
 * Stake-flow + non-custodial review copy (P1-13).
 * Neutral language only (METHODOLOGY §8). No yield promises, no "guaranteed",
 * no fee claims, no em dashes.
 */

/** Short non-custodial explainer on amount entry and review. */
export const STAKE_NON_CUSTODIAL =
  'Your NIM stays in a protocol account controlled by your wallet. Steakout never holds keys or seed phrases.'

/** Review-before-confirm invariant, plain language. */
export const STAKE_REVIEW_BEFORE_CONFIRM =
  'Review every detail below. Your wallet asks for approval only after you tap Confirm here. Nothing is sent if you cancel.'

/** Mainnet amounts are real (product may run on mainnet; spike was testnet-only). */
export const STAKE_MAINNET_REAL_AMOUNTS =
  'On mainnet, amounts and fees are real network value. Only continue with amounts you intend to stake.'

/** Illustrative estimate disclaimer — nothing on the review sheet is a yield claim. */
export const STAKE_NO_ILLUSTRATIVE_ON_REVIEW =
  'This review does not show yield estimates. Any network estimate elsewhere is illustrative only and not a prediction.'

/** Waiting period note for stake create/add (no protocol wait for these ops). */
export const STAKE_NO_WAITING_PERIOD =
  'Creating a staker or adding stake does not use a protocol waiting period. Retire and remove do, and those are separate actions.'

/** Change-validator: not retire/remove wait; reporting window / reactivate note. */
export const UPDATE_WAITING_PERIOD_NOTE =
  'Changing validator is not the multi-step retire/remove wait. Delegation updates on confirmation. Stake may sit inactive until reactivated after the current network reporting window.'

/** Change-validator with reactivate requested. */
export const UPDATE_REACTIVATE_NOTE =
  'Changing validator is not the multi-step retire/remove wait. Delegation updates on confirmation. Reactivate is requested so stake aims to stay (or become) active after the current network reporting window; exact timing follows the protocol, not Steakout.'

/** Change-validator flow titles. */
export const UPDATE_AMOUNT_TITLE = 'Change validator'
export const UPDATE_AMOUNT_LEDE =
  'You will review the new validator and the position transition, then approve in your wallet. No stake amount is moved; only the delegation target changes.'
export const UPDATE_REVIEW_TITLE = 'Review change'
export const UPDATE_SUCCESS_TITLE = 'Validator change confirmed'
export const UPDATE_SUCCESS_BODY =
  'The server matched the transaction to your intent. Delegation and position details below come from chain data, not a client estimate.'
export const UPDATE_SAME_VALIDATOR =
  'You already delegate to this validator. Pick a different validator to change to, or use Stake more to add stake here.'
export const UPDATE_NEED_POSITION =
  'Change validator requires an Active or Inactive staker position. Create a staker first if you are not staked yet.'
export const UPDATE_CONTINUE_REVIEW = 'Continue to review'
export const UPDATE_CONFIRM_CTA = 'Confirm in wallet'

/** Generic cancel after wallet dismissal. */
export const STAKE_CANCELLED =
  'Wallet confirmation was cancelled. No staking transaction was submitted from this step.'

/** Provider / wallet error, neutral. */
export const STAKE_PROVIDER_ERROR =
  'The wallet could not complete this request. No change was confirmed by Steakout.'

/** Confirm timeout — check later. */
export const STAKE_CONFIRM_TIMEOUT =
  'Confirmation is taking longer than expected. Steakout only marks success from chain data. Check Activity later, or try again if nothing appears.'

/** TX mismatch / failed from server. */
export const STAKE_TX_MISMATCH =
  'The on-chain transaction did not match the recorded intent. Steakout did not mark this as confirmed.'

export const STAKE_TX_FAILED =
  'The transaction was observed as failed on chain. Steakout did not mark this as confirmed.'

/** Intent expired or missing. */
export const STAKE_INTENT_GONE =
  'This staking intent is no longer available. Start again from the amount step.'

/** Duplicate-submit guard. */
export const STAKE_IN_PROGRESS =
  'A staking step is already in progress. Wait for it to finish or cancel before starting another.'

/** Already delegated to another validator. */
export const STAKE_OTHER_VALIDATOR =
  'This wallet already has a staker delegated to a different validator. Adding stake here would go to your current delegation. Change-validator is a separate action.'

/** Need wallet connection first. */
export const STAKE_CONNECT_FIRST =
  'Connect your wallet to stake. You will review the exact amount and validator before any wallet approval.'

/** Amount step title. */
export const STAKE_AMOUNT_TITLE = 'Choose stake amount'

/** Amount step lede. */
export const STAKE_AMOUNT_LEDE =
  'Enter how much NIM to stake, or pick a preset. Maximum safe leaves room so you do not stake your entire balance.'

/** Preset labels. */
export const STAKE_PRESET_25 = '25% safe'
export const STAKE_PRESET_50 = '50% safe'
export const STAKE_PRESET_MAX = 'Maximum safe'
export const STAKE_PRESET_CUSTOM = 'Custom'

/** Continue to intent / review. */
export const STAKE_CONTINUE_REVIEW = 'Continue to review'

/** Review sheet title. */
export const STAKE_REVIEW_TITLE = 'Review stake'

/** Confirm CTA. */
export const STAKE_CONFIRM_CTA = 'Confirm in wallet'

/** Cancel. */
export const STAKE_CANCEL = 'Cancel'

/** Pending / polling. */
export const STAKE_PENDING_TITLE = 'Waiting for confirmation'
export const STAKE_PENDING_BODY =
  'Your wallet returned a transaction reference. Steakout is matching it to the recorded intent on chain. This can take a short while.'

/** Success. */
export const STAKE_SUCCESS_TITLE = 'Stake confirmed'
export const STAKE_SUCCESS_BODY =
  'The server matched the transaction to your intent. Position details below come from chain data, not a client estimate.'

/** Close / done. */
export const STAKE_DONE = 'Done'
export const STAKE_BACK_HOME = 'View position'

/** Fee headroom note under presets. */
export const STAKE_FEE_HEADROOM_NOTE =
  'Maximum safe reserves 1 NIM of available wallet balance so fees and leftover spending room are not zeroed out by accident.'

/**
 * Stake budget includes open Pay HTLCs (as sender). Hypothesis: Pay may resolve
 * contracts when funding a stake approval. If approve fails, free the NIM in Pay first.
 */
export const STAKE_WALLET_BUDGET_NOTE =
  'Amount uses wallet total (free on-address + open Pay payment contracts). If Nimiq Pay cannot fund the stake from contracts, free NIM on-address and try again.'

/** Retire stake flow (P3-01). */
export const RETIRE_AMOUNT_TITLE = 'Retire stake'
export const RETIRE_AMOUNT_LEDE =
  'Choose how much staked NIM to move into retirement. Retire does not return NIM to your account. After a protocol waiting period the position can become Withdrawable, and only then can you remove stake.'
export const RETIRE_REVIEW_TITLE = 'Review retire'
export const RETIRE_SUCCESS_TITLE = 'Retire confirmed'
export const RETIRE_SUCCESS_BODY =
  'The server matched the transaction to your intent. Funds are on the retirement path. Remove is not available until the position is Withdrawable.'
export const RETIRE_WAITING_PERIOD_NOTE =
  'Retire stake does not immediately return NIM. Funds move to a retired balance. Remove is only available after the protocol waiting period when the position is Withdrawable. This is not instant unstake.'
export const RETIRE_NEED_POSITION =
  'Retire stake requires Active, Inactive, or Retiring stake with an active or inactive balance. Fully Withdrawable positions use Remove instead.'
export const RETIRE_POOL_NOTE =
  'Amount is taken from active and inactive stake. Already retired balance is not retired again.'
export const RETIRE_PRESET_MAX = 'All retirable'

/** Remove stake flow (P3-01). */
export const REMOVE_AMOUNT_TITLE = 'Remove stake'
export const REMOVE_AMOUNT_LEDE =
  'Choose how much retired NIM to return to your available account balance. Remove is only for Withdrawable retired stake. It cannot skip the retire waiting period or remove Active stake.'
export const REMOVE_REVIEW_TITLE = 'Review remove'
export const REMOVE_SUCCESS_TITLE = 'Remove confirmed'
export const REMOVE_SUCCESS_BODY =
  'The server matched the transaction to your intent. Position details below come from chain data, not a client estimate.'
export const REMOVE_WAITING_PERIOD_NOTE =
  'Remove returns retired stake that is already Withdrawable to your available account balance. It does not skip the retire waiting period and cannot remove Active stake.'
export const REMOVE_NEED_WITHDRAWABLE =
  'Remove stake is available only when the position is Withdrawable (retired balance only). If you still have active or inactive stake, finish retire first and wait for the protocol waiting period.'
export const REMOVE_POOL_NOTE =
  'Amount is taken from retired stake only. Active and inactive balances are not removable here.'
export const REMOVE_PRESET_MAX = 'All removable'

/** Home progression copy when retiring / withdrawable. */
export const RETIRE_PROGRESS_RETIRING =
  'Retire is in progress. Retired balance is observed, but active or inactive stake remains. Remove is not available until the position is fully Withdrawable. Waiting period timing follows the protocol; Steakout does not invent a release time when the chain does not expose one.'
export const RETIRE_PROGRESS_WITHDRAWABLE =
  'This position is Withdrawable. You can remove retired stake to your available account balance. This is not the same as retiring active stake.'
export const RETIRE_PROGRESS_NO_TIMESTAMP =
  'No protocol release timestamp is available from the network for this position. Status is based on observed balances only.'

/** Operation labels (client fallback when summary is incomplete). */
export const OPERATION_LABELS: Record<string, string> = {
  'new-staker': 'Create staker and delegate',
  stake: 'Add stake',
  'set-active': 'Set active stake',
  'update-staker': 'Change validator',
  retire: 'Retire stake',
  remove: 'Remove stake',
}

/** State transition display fallback. */
export function formatStateTransition(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const a = (from ?? '').trim() || 'Not staked'
  const b = (to ?? '').trim() || 'Active'
  if (a === b) return `Position remains ${a}`
  return `${a} → ${b}`
}
