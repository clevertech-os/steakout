# Steakout

> **Stake in. Know who is paying you.**

Product specification and delivery plan for the Nimiq Mini Apps Competition, Cycle II.

**Competition:** Nimiq Mini Apps Competition, Cycle II  
**Competition window:** August 10 - September 4, 2026  
**Status:** Planning  
**Owner:** VeriLock / Sam Harms  
**Last updated:** 2026-08-02

---

## 1. Executive Summary

Steakout is a non-custodial Nimiq staking cockpit and validator accountability layer built for Nimiq Pay.

It solves two connected problems:

1. Nimiq Pay users cannot currently stake NIM from the app they use to hold and spend it.
2. Nimiq's official validator score measures block-production performance, but explicitly does not assess whether validators pay their stakers.

Steakout adds a mobile-first staking flow using Nimiq Pay's native staking transaction methods, then gives stakers a plain-language view of what happens after delegation:

- Which validator they delegated to
- What the validator claims about fees and payout timing
- Whether observed payouts follow that declared schedule
- How many stakers appear to receive each payout cycle
- When the user's position last received a reward or restake effect
- Which parts of the analysis are verified, inferred, or not yet observable

The product is not a custodial yield platform, investment product, or replacement for Nimiq Wallet. User funds remain in Nimiq protocol accounts and every staking operation is approved by the user's Nimiq Pay wallet.

The core thesis is simple:

> **Nimiq already lets validators produce blocks. Steakout helps stakers see whether the validator relationship is working.**

The app should launch free. Its primary ecosystem contribution is increased NIM staking and better information for delegation decisions, not extracting fees from users.

---

## 2. Product Name and Positioning

### Name

**Steakout**

The name deliberately combines:

- **Stake:** the user's NIM delegation
- **Steakout:** watching closely and checking what is happening

The brand should feel sharp, observant, and trustworthy rather than financial, casino-like, or aggressively adversarial.

### One-line description

**Stake NIM in Nimiq Pay, then see whether your validator is actually delivering.**

### Short pitch

Steakout is the first staking experience inside Nimiq Pay. Choose a validator, delegate NIM directly through your wallet, and monitor the observable payout record over time. Official validator scores tell you how well a validator produces blocks. Steakout adds the missing staker-side view: payout timing, recipient coverage, and your own position history.

### Positioning boundaries

Steakout is:

- Non-custodial staking UX
- Validator transparency and monitoring
- An analytics and education product
- A Nimiq-native use case for the staking provider API

Steakout is not:

- A promise of returns
- A validator, pool, broker, or custodian
- A guarantee that a payout was intended as a reward
- A public accusation engine
- A fee-rating system in v1
- A replacement for protocol consensus or the official Validator Trust Score

---

## 3. Why This Can Win Cycle II

### 3.1 It uses Nimiq as infrastructure, not decoration

The Mini App uses Nimiq at the center of the product:

- Nimiq Pay wallet identity determines the user's staking position
- Nimiq Pay native staking methods perform the actual protocol actions
- Nimiq validator and staker state powers the dashboard
- Nimiq transaction history is used to analyze payout behavior
- NIM is the asset being delegated and locked
- The product is more useful specifically because it runs inside Nimiq Pay

### 3.2 It uses an underused part of the Mini App SDK

The Nimiq provider exposes a complete staking write lifecycle:

- `sendNewStakerTransaction`
- `sendStakeTransaction`
- `sendSetActiveStakeTransaction`
- `sendUpdateStakerTransaction`
- `sendRetireStakeTransaction`
- `sendRemoveStakeTransaction`

Cycle 1 had one nominal staking entry, but that project did not integrate with Nimiq protocol staking. No Cycle 1 submission combined native staking controls with validator payout analysis.

### 3.3 It fills an explicitly documented gap

Nimiq documentation states that validators distribute staking rewards off-chain according to their own arrangements with stakers. The official Validator Trust Score evaluates validator block-production behavior and explicitly does not assess staking pool reliability or reward payment processes.

Steakout's accountability layer is therefore a meaningful extension rather than another generic validator leaderboard.

### 3.4 It has repeat value

Unlike a one-time payment or document-signing flow, users have reasons to return:

- Check current stake and delegation
- Monitor reward or restake activity
- See whether a payout window was missed
- Compare validators before changing delegation
- Track an unstaking countdown
- Review network concentration and validator health

### 3.5 It has a distribution loop

Validators and staking operators have a reason to share their Steakout profile if it shows a healthy, transparent payout record. Each validator profile can have a public URL suitable for X, Telegram, Discord, websites, and community posts.

The distribution loop is:

1. Steakout publishes an evidence-based validator profile.
2. A validator shares its profile to demonstrate transparency.
3. Existing and prospective stakers open the profile.
4. Users connect wallets and stake or monitor their position.
5. More observed positions improve the usefulness of the dataset.

The product should never allow validators to edit or suppress observed evidence.

---

## 4. Research Findings and Competitive Context

### 4.1 Cycle 1 saturation

Cycle 1 contained 62 submissions. The most crowded areas were:

| Cluster | Approximate entries | Strategic implication |
|---|---:|---|
| Bounties, tasks, and escrow | 6 core, several adjacent | Avoid another task marketplace |
| Games and wagered play | 6 | Avoid competing on generic game polish |
| Invoices and payment links | 5 | Avoid generic payment plumbing |
| Bill splitting and group settlement | 7 touching | Avoid another social payments wrapper |
| Rotating savings circles | 4 | Avoid another pooled savings app |
| Habit and accountability staking | 4 core, several adjacent | Avoid personal goal staking |
| Gifting and red packets | 4 | Avoid another claim-link product |
| AI content generation | 4 core, several adjacent | Avoid generic AI wrappers |
| Events and location rewards | 4 | Avoid another QR rewards app |

The white space relevant to Steakout was:

- Real protocol staking UX inside Nimiq Pay
- Validator payout verification
- Staker-side portfolio analytics
- Unlisted-validator transparency
- Historical payout datasets
- Staking operations that use the native provider methods

### 4.2 Existing Nimiq staking products

The Nimiq Wallet already provides a first-class staking experience and validator selection. Steakout should not claim to replace it.

The opportunity is different: Nimiq Pay has no comparable staking interface, while the Mini App provider exposes native staking writes. Steakout is the staking and accountability layer for the Nimiq Pay context.

The official validators API already provides registry metadata and Validator Trust Score data. Steakout should consume that data rather than rebuild the registry. Its differentiated work is the staker-side state and payout observation layer.

### 4.3 What the official score does and does not measure

The Validator Trust Score combines validator performance dimensions such as dominance, reliability, and availability. It is valuable and should be shown in Steakout.

It does not answer:

- Did the validator make the payout it advertised?
- How often does it make payouts?
- How many known stakers were included in a payout run?
- When was this user's position last paid or restaked?

Steakout should present the official score alongside, not instead of, its own payout observations.

---

## 5. Target Users

### Primary: existing NIM holders

They have NIM in Nimiq Pay and want a simple answer to: "What can I do with it, and who should I delegate to?"

### Secondary: current stakers

They already delegate through Nimiq Wallet or another route and want a clearer view of validator behavior and their own reward history.

### Secondary: validators and staking operators

They want a public, independently computed profile that demonstrates reliable payout operations and helps prospective stakers understand their policy.

### Tertiary: Nimiq community members

They need a shareable, understandable view of network health, validator concentration, and staking participation.

### User promise

After connecting a wallet, a user should understand their current staking state and the next useful action in under 60 seconds.

---

## 6. Core Product Experience

### 6.1 Home dashboard

The home screen changes based on wallet state.

#### Disconnected state

Primary message:

> **Your NIM may be idle. See what it could do.**

Actions:

- Connect Nimiq Pay wallet
- Explore validators without connecting
- View a short explanation of non-custodial staking

Do not display a return estimate as a guaranteed result. Use a calculator label such as "illustrative network estimate" and link to methodology.

#### Connected, not staked

Show:

- Available NIM balance, if available from the backend read layer
- Estimated illustrative annual network reward range
- Primary CTA: `Choose a validator`
- Secondary CTA: `How staking works`

#### Connected and staked

Show:

- Total staked NIM
- Active, inactive, and retired balances
- Delegated validator
- Position status: `Active`, `Pending`, `Inactive`, `Retiring`, or `Withdrawable`
- Last observed reward or restake event
- Personal monitoring status
- Primary CTA based on state, such as `View position`, `Stake more`, or `Change validator`

### 6.2 Validator directory

The directory should be useful without wallet connection.

Each card shows:

- Validator name and identicon/logo
- Official Validator Trust Score
- Stake amount and dominance percentage
- Number of listed stakers, where available
- Declared fee, payout type, and payout schedule
- Steakout observation status
- A clear `View record` action

Default sorting should not simply reward the largest validator. Provide explicit sort options:

- Recommended for transparency
- Official score
- Lowest dominance
- Largest by stake
- Direct payout
- Restake
- New or insufficient data

The recommended view must explain its inputs and must not pretend to be financial advice.

### 6.3 Validator profile

Each profile has two layers.

#### Summary layer

Readable status labels:

- `On schedule`
- `Mostly on schedule`
- `Irregular`
- `Not enough observed data`
- `Observation unavailable`

Metrics:

- Declared payout type
- Declared payout schedule
- Observed payout windows
- Observed recipient coverage
- Last observed payout activity
- Official validator score
- Stake dominance
- Reward address, with explorer link where appropriate

#### Evidence layer

The user can inspect:

- Payout window timestamps
- Number of recipient addresses in each observed run
- Transaction hashes and explorer links
- Data collection timestamp
- Methodology and limitations

No metric should be displayed without a definition and data freshness indicator.

### 6.4 Stake flow

The first-run flow should be a short, native-feeling sequence:

1. Choose a validator.
2. Read a compact validator summary.
3. Enter an amount or select a percentage/preset.
4. Review the exact operation and destination.
5. Trigger the native Nimiq Pay confirmation.
6. Show pending, confirmed, or failed state.
7. Return to the position dashboard.

Amount presets:

- `25% of available`
- `50% of available`
- `Maximum safe amount`
- Custom amount

The UI must leave room for fees and avoid making the user accidentally stake their entire balance. The actual minimum and wallet-specific constraints must be confirmed on testnet before final copy is locked.

### 6.5 Position management

Support the complete useful lifecycle where the provider is confirmed to work:

- Create a staker and delegate
- Add stake
- Change delegation
- Move active stake to inactive state
- Retire stake
- Remove withdrawable stake

Each action must explain its state transition in plain language. For example:

> **Retire stake** does not immediately return NIM. The protocol requires a waiting period before the retired amount can be removed.

The product must never call a transaction method without first showing the user the intended operation and amount.

### 6.6 Activity and alerts

V1 activity:

- Staking transactions
- Delegation changes
- Retire/remove state changes
- Observed direct payout transactions
- Observed restake balance changes

V1 alerts can be in-app only:

- Validator payout window observed
- Personal position changed
- Unstaking amount is withdrawable
- Validator observation status changed

Push notifications, email, and Telegram alerts are post-cycle features unless a low-complexity implementation becomes available.

---

## 7. Accountability Methodology

This section is central to product trust. Steakout must make conservative claims and show evidence.

### 7.1 Principles

1. Separate **declared policy** from **observed chain behavior**.
2. Never infer intent from a missing transaction.
3. Never publish an effective fee number in v1.
4. Display data freshness everywhere it matters.
5. Treat insufficient data as a valid result.
6. Link conclusions to raw transactions where possible.
7. Use neutral language: `observed`, `not observed`, `insufficient data`, `needs review`.

### 7.2 Direct payout validators

For direct payout validators, the service can observe transactions from the validator's authoritative on-chain reward address to staker addresses.

V1 signals:

#### Schedule adherence

Compare observed payout bursts with the validator's declared payout schedule.

Example:

- Declared: every 12 hours
- Observation window: 14 days
- Expected windows: 28
- Observed windows: 27
- Status: `Mostly on schedule`

Do not grade a validator when the schedule is free text or ambiguous. Show `Schedule cannot be normalized` and show raw observations instead.

#### Recipient coverage

For each payout run, count recipient addresses and compare it to the known staker set where available.

This is not a definitive measure of full payout correctness. A single address may receive a consolidated payment, a staker may be below a payout threshold, and the registry may be incomplete. Label this metric `Observed recipient coverage`, not `Paid everyone`.

#### Personal continuity

For a connected staker, show:

- Last observed payment to the staker address
- Number of consecutive observed payout windows containing the address
- Time since last observed payment
- Whether the address is currently included in the known staker set

### 7.3 Restake validators

For restake validators, rewards are not necessarily sent as ordinary direct payments to each staker address. V1 should use a different model:

- Read the user's staker account state
- Track active stake and total staker balance over time
- Show balance-change observations
- Compare changes against an illustrative expected range
- Clearly label the result as `Observed position growth`, not `Validator payout verified`

If reliable restake state cannot be retrieved from the chosen RPC/API within Week 1, ship direct-payout monitoring first and mark restake analytics as an explicit limitation rather than faking parity.

### 7.4 Metrics that are intentionally excluded

Do not ship these in v1:

- Effective validator fee
- Fraud score
- Scam labels
- Guaranteed APY
- Ranking that implies a validator is objectively best
- Claims that a missing payment proves wrongdoing

The research spike showed that validator outflows can include principal returns, treasury transfers, and unrelated movements. A naive gross-inflow versus outflow calculation can produce nonsensical results. Avoid reputationally harmful conclusions until intent classification is robust and reviewed.

### 7.5 Data status labels

Every accountability metric uses one of these states:

| State | Meaning |
|---|---|
| Verified observation | Derived from a confirmed on-chain transaction or account state |
| Registry declaration | Supplied by the validator registry, not independently verified |
| Inferred | Computed from observable patterns with stated assumptions |
| Insufficient data | Not enough history or a non-normalized policy |
| Unavailable | RPC/indexer/API did not provide the required data |

---

## 8. Technical Architecture

### 8.1 Deployment shape

Use the same pragmatic architecture as VeriLock:

- React + TypeScript + Vite client
- Express + TypeScript server
- SQLite for operational data and index state
- Railway deployment
- Single production service serving API and SPA
- Public mini app URL plus normal browser fallback

The product should be a new project under `/Users/sharms/_github_repos/round_ii/steakout`, not a second production UI inside VeriLock.

### 8.2 Client responsibilities

The client handles:

- Mobile-first UI
- Nimiq Pay provider initialization
- Wallet connection and account display
- Native staking transaction requests
- Input validation and review screens
- Polling the Steakout API for transaction status
- Public validator and evidence views
- Explorer links

The client must not:

- Store private keys
- Construct or sign arbitrary staking transactions outside the provider
- Treat a client-reported transaction as confirmed without server/RPC verification
- Display stale account state as current without a timestamp

### 8.3 Server responsibilities

The server handles:

- Wallet challenge and signed-message authentication
- Validator registry synchronization
- Nimiq RPC access and fallback handling
- Staker/account state reads
- Transaction confirmation and status normalization
- Validator reward-address resolution
- Payout history indexing
- Payout observation classification
- Rate limiting and caching
- Public validator profile APIs

### 8.4 Nimiq integration surface

#### Native provider writes

Use the Mini App SDK provider:

```ts
await nimiq.sendNewStakerTransaction({
  delegation: validatorAddress,
  value: valueInLuna,
})
```

Other lifecycle methods:

```ts
await nimiq.sendStakeTransaction({ value })
await nimiq.sendSetActiveStakeTransaction({ newActiveBalance })
await nimiq.sendUpdateStakerTransaction({
  newDelegation,
  reactivateAllStake,
})
await nimiq.sendRetireStakeTransaction({ retireStake })
await nimiq.sendRemoveStakeTransaction({ value })
```

Exact return semantics must be tested against the shipped Nimiq Pay version because the current documentation and package type comments disagree about whether transaction methods return a hash or serialized transaction.

#### Wallet identity

Use:

- `listAccounts()` for the connected address
- `sign()` for server challenge authentication
- Server-side signature verification using the Nimiq signed-message envelope

The app should not use `requestDeviceIdentifier()` as wallet identity. It may be useful for abuse throttling later, but the docs explicitly state that it is device-scoped and not an identity primitive.

#### Read APIs

The provider does not expose validator, staker, account, or transaction reads directly. Implement reads through a server-side RPC client.

Potential RPC methods to validate during the spike:

- `getBlockNumber`
- `getValidatorByAddress`
- `getActiveValidators`
- `getAccountByAddress`
- `getStakerByAddress`
- `getTransactionsByAddress`
- `getTransactionByHash`

The public RPC server should be treated as a development and fallback dependency. Production should have a plan for rate limits, uptime, and a second source or self-hosted node.

### 8.5 Reuse from VeriLock

#### Copy or adapt first

| VeriLock module | Steakout use |
|---|---|
| `client/src/nimiq.ts` | Pay + Hub wallet facade, provider warmup, transaction handling, explorer links |
| `client/src/journey/useJourneyWallet.ts` | Connection state and mobile/desktop wallet handling |
| `server/src/nimiq-rpc.ts` | RPC calls, retries, backoff, transaction verification |
| `server/src/hub-signature.ts` | Signed-message verification |
| `server/src/auth-wallet.ts` | Public-key to address binding |
| `client/src/session.ts` | Session persistence |
| `client/src/addresses.ts` | Address normalization and validation |
| `client/src/explorer.ts` | Nimiq explorer URLs |
| `server/src/rate-limit.ts` | API abuse protection |
| `server/src/http-headers.ts` | Security headers |
| `Dockerfile` and Railway configuration | Deployment baseline |

#### Do not carry over blindly

- Document-specific database tables
- PDF rendering and annotation code
- Credit and Stripe flows
- Document invitation and signature flows
- Large journey components
- Seal-specific transaction payloads

### 8.6 Proposed service modules

```text
server/src/
  index.ts
  auth.ts
  nimiq-rpc.ts
  validators-api.ts
  validatorSync.ts
  stakingState.ts
  payoutIndexer.ts
  payoutClassifier.ts
  observationScoring.ts
  explorer.ts
  db.ts
  rate-limit.ts
  security.ts

client/src/
  App.tsx
  nimiq.ts
  api.ts
  wallet/
  staking/
  validators/
  activity/
  components/
  styles/
```

### 8.7 Data model

Keep the initial schema small and append-only where possible.

```text
users
  id
  address
  public_key
  created_at
  last_seen_at

validators
  address
  name
  website
  description
  fee_declared
  payout_type_declared
  payout_schedule_declared
  reward_address
  official_score
  dominance_ratio
  registry_updated_at
  is_listed

validator_observations
  id
  validator_address
  observation_type
  status
  observed_at
  source_tx_hash
  block_number
  payload_json

transactions
  hash
  from_address
  to_address
  value_luna
  fee_luna
  block_number
  timestamp
  execution_result
  raw_json

staker_snapshots
  id
  user_address
  validator_address
  active_balance_luna
  inactive_balance_luna
  retired_balance_luna
  total_balance_luna
  observed_at
  source_block

index_cursors
  source
  address
  last_block
  last_tx_hash
  updated_at
```

Do not store private keys, seed phrases, or unnecessary personal data.

### 8.8 Indexer strategy

The indexer is the most time-sensitive technical asset because history accumulates with time.

#### Start with listed validators

The initial registry contains roughly 24 listed validators. Expand to all observable validators after the first stable version. The default validators API behavior must be overridden where necessary because `only-known=true` hides a substantial portion of network stake.

#### Index reward addresses, not every address blindly

For each validator:

1. Resolve the authoritative on-chain reward address.
2. Fetch address transactions incrementally.
3. Store only normalized fields needed for observations.
4. Deduplicate by transaction hash.
5. Advance the cursor only after a successful page.
6. Retry with exponential backoff.

#### Initial polling target

- Poll every 30-60 minutes in the first implementation.
- Fetch bounded pages.
- Use a queue with per-address concurrency limits.
- Keep RPC calls and response sizes observable.
- Add a fallback source only after the primary path is stable.

#### Backfill

Backfill enough history to support:

- At least 7 days for a useful first profile
- Ideally 14-30 days for validators with manageable history
- A visible `history depth` label on every profile

The app must not imply that a validator with one hour of data has a reliable long-term record.

---

## 9. API Design

### Public endpoints

```text
GET /api/health
GET /api/validators
GET /api/validators/:address
GET /api/validators/:address/observations
GET /api/network/summary
GET /api/explorer/transaction/:hash
```

### Authenticated endpoints

```text
POST /api/auth/challenge
POST /api/auth/verify
GET  /api/me
GET  /api/me/staking-position
GET  /api/me/activity
GET  /api/me/observations
```

### Client action endpoints

```text
POST /api/staking/intent
POST /api/staking/confirm
```

The server should never accept a client claim that a staking transaction succeeded. The confirmation endpoint must query the chain and match the transaction to the authenticated address, intended operation, amount, and validator where possible.

### API response rules

Every stateful response should include:

- `updatedAt`
- `source`
- `status`
- `dataFreshness`

Error responses should distinguish:

- Wallet not connected
- Signature rejected
- RPC unavailable
- Transaction pending
- Transaction failed
- State not yet indexed
- Insufficient history

---

## 10. Design Direction

### Visual language

Steakout should feel like a calm field instrument, not a casino dashboard or generic crypto terminal.

Suggested direction:

- Warm off-white or very light neutral background
- Charcoal text
- Steak-red or ember accent used sparingly for active states
- Mint/green only for verified positive observations
- Amber for incomplete or irregular data
- Blue/indigo reserved for links and neutral information
- Strong typography hierarchy with compact numeric displays
- Thin evidence lines, timestamps, and source labels
- Identicons used as visual address confirmation

Avoid:

- Neon crypto gradients
- Dense exchange-style tables on mobile
- Fake precision such as `99.83% trust` without methodology
- Badges that imply financial guarantees
- Dark-glass-everywhere layouts
- Aggressive red warning screens for ordinary uncertainty

### Main navigation

Use four primary destinations:

1. **Home** - position and next action
2. **Validators** - compare and inspect
3. **Activity** - personal and network observations
4. **Learn** - staking, methodology, and limitations

The app should retain a single dominant action per screen.

### Mobile requirements

- Works at 320px width
- Native confirmation flows never hidden behind scrolling
- Bottom navigation or compact top navigation
- Minimum 44px touch targets
- No hover-only explanations
- Charts optional; evidence lists must remain legible without them
- Full loading, empty, offline, and stale-data states

---

## 11. Scope and Priorities

### Must ship for Cycle II

- Nimiq Pay wallet connection
- Browser/Hub fallback where inherited safely from VeriLock
- Validator directory using official metadata
- Validator profile with official score and declared payout policy
- Native create-staker/delegate flow
- Add stake flow
- Position state read from backend
- At least one working position-management action beyond initial staking
- Direct-payout observation engine
- Evidence links to transactions
- Data freshness and limitations UI
- Public live demo
- Mobile-first polish
- Open-source MIT repository
- Demo video and submission description

### Should ship if the core is stable

- Change delegation
- Retire and remove flow
- Restake position growth
- Personal payout continuity
- Network concentration view including unlisted validators
- Shareable validator profile URLs
- In-app observation alerts

### Explicitly defer

- Effective fee calculations
- Automated accusations or public dispute system
- Custodial staking
- New token or reward token
- Paid subscription
- Push notifications
- Native validator chat
- Full validator onboarding/registry editing
- Social leaderboards that encourage reckless yield chasing
- HTLC, vesting, multisig, or unrelated protocol features

### Scope fallback

If native staking writes fail in Nimiq Pay during Week 1, switch to a read-only validator accountability Mini App plus signed wallet monitoring, but do not market it as a staking cockpit. If the read layer cannot reliably retrieve staker state, ship direct-payout validator monitoring with a clearly scoped `direct payout beta` label.

---

## 12. Four-Week Development Schedule

Cycle II is four weeks: August 10 through September 4. The schedule assumes a preparation spike begins immediately and that the indexer is started before UI polish.

## Week 0: De-risk and accumulate history

**Dates:** August 2-9  
**Goal:** Prove the protocol path and start collecting evidence before the competition begins.

### Day 1 - Product and protocol confirmation

- Create the Steakout repository under `round_ii/steakout`.
- Confirm the exact Nimiq Pay app version used for testing.
- Install/use the latest Mini App SDK package.
- Verify `listAccounts`, `sign`, and `getBlockNumber`.
- Confirm the Mini App runs inside Nimiq Pay with the intended production URL pattern.
- Ask the Nimiq team whether native staking is planned for Nimiq Pay during Cycle II.
- Confirm competition dates and submission requirements.

**Exit criteria:** wallet connection and signed challenge work in a minimal test app.

### Day 2 - Testnet staking spike

- Obtain testnet NIM through the Nimiq Pay testnet flow.
- Test `sendNewStakerTransaction` with the minimum safe amount.
- Test transaction return value and confirmation behavior.
- Test `sendStakeTransaction`.
- Test `sendUpdateStakerTransaction` against two test validators, if available.
- Test `sendSetActiveStakeTransaction`.
- Record exact error messages and state transitions.

**Exit criteria:** at least create-staker and add-stake work on a real testnet device; all unsupported methods are documented.

### Day 3 - Position read layer

- Confirm RPC methods for account and staker reads.
- Implement a small server probe for `getStakerByAddress`, `getAccountByAddress`, and validator lookup.
- Resolve protocol minimum versus wallet UI minimum.
- Store raw test responses as fixtures.
- Define normalized position states.

**Exit criteria:** a known test address renders active/inactive/retired state from the backend.

### Day 4 - Validator registry ingestion

- Integrate the validators API.
- Fetch both known-only and all-observable modes.
- Resolve reward addresses from chain data.
- Normalize fee, payout type, schedule, score, dominance, and data freshness.
- Handle missing fields and score `-1` as insufficient data.

**Exit criteria:** validator list API serves normalized records with source timestamps.

### Day 5 - Start the payout indexer

- Add SQLite tables for transactions, cursors, and observations.
- Begin polling listed validator reward addresses.
- Add deduplication, retry, and cursor advancement.
- Log request counts, latency, errors, and records indexed.
- Deploy the indexer to a persistent environment.

**Exit criteria:** history is accumulating continuously, independent of UI work.

### Day 6 - Direct payout classification spike

- Inspect real direct-payout validator transaction patterns.
- Implement payout-run grouping by time window.
- Compare observed runs to normalized schedules where possible.
- Produce a local report for at least one validator.
- Validate transaction links against at least one explorer.

**Exit criteria:** a local report can show observed payout runs without making fee or intent claims.

### Day 7 - Kill decision and architecture lock

- Review staking-method results with real testnet evidence.
- Review RPC reliability and indexer throughput.
- Decide whether restake analytics is in scope.
- Decide whether to start with 24 listed validators or expand immediately.
- Freeze v1 scope.
- Publish a build update in the competition community.

**Kill criteria:** if native staking is unavailable or unsafe, activate the read-only accountability fallback before Week 1.

---

## Week 1: Foundation and first usable stake

**Dates:** August 10-16  
**Goal:** A new Nimiq Pay user can connect, choose a validator, stake testnet NIM, and see the resulting position.

### Engineering

- Scaffold React/Vite/Express/SQLite project.
- Port only the required VeriLock wallet and RPC modules.
- Implement Pay-first connection and signed auth challenge.
- Add server session handling and address binding.
- Implement validator API sync and caching.
- Implement normalized position endpoint.
- Implement create-staker/delegate flow.
- Implement chain confirmation polling.
- Implement error states for cancellation, timeout, RPC failure, and rejected transactions.
- Continue indexer backfill and scheduled polling.

### Product/UI

- Build app shell and navigation.
- Build disconnected, connected, and staked home states.
- Build validator list and basic profile.
- Build stake review sheet.
- Show exact amount, validator, and expected protocol action before wallet confirmation.
- Add a visible non-custodial explanation.

### Testing

- Test on Android Nimiq Pay.
- Test on iOS Nimiq Pay if available.
- Test browser/Hub fallback.
- Test address normalization.
- Test duplicate submission protection.
- Test pending transaction reload.

### Week 1 deliverable

**A functional vertical slice:** connect wallet -> select validator -> native confirmation -> confirmed stake -> position displayed.

---

## Week 2: Accountability engine and production beta

**Dates:** August 17-23  
**Goal:** A real user can understand both the staking action and the validator's observed payout behavior.

### Engineering

- Implement direct payout run grouping.
- Implement schedule normalization for common schedules: hourly, every N hours, daily, and twice daily.
- Implement recipient coverage observations.
- Implement personal continuity for direct payout users.
- Implement evidence endpoint with transaction hashes and block timestamps.
- Add history-depth calculation.
- Add stale-data and insufficient-data states.
- Add validator profile share URLs.
- Add server-side caching and rate limiting.
- Add indexer health dashboard or protected diagnostics route.

### Product/UI

- Finish validator profile summary and evidence layers.
- Add official score versus Steakout observation distinction.
- Add `On schedule`, `Mostly on schedule`, `Irregular`, and `Not enough data` labels.
- Add position activity timeline.
- Add change delegation or the highest-confidence lifecycle action from Week 1 testing.
- Add learn/methodology screens.
- Complete mobile responsive pass.

### Distribution preparation

- Contact listed validators with a neutral beta invitation.
- Offer each validator a preview of its public observation page.
- Do not ask validators to approve or edit observations.
- Record feedback from at least three actual NIM holders.
- Publish a short build update and technical explanation.

### Week 2 deliverable

**Private beta:** a usable staking cockpit with at least one evidence-backed validator profile and no known blocker on the primary mobile path.

The private beta is the internal deadline. Do not wait until Week 3 to discover that the main journey is incomplete.

---

## Week 3: Public beta, polish, and distribution

**Dates:** August 24-30  
**Goal:** Public users can use the app without assistance, and the product looks submission-ready.

### Engineering

- Harden all native staking transitions.
- Implement retire/remove if testnet behavior is understood and safe.
- Add restake analytics only if the data model is reliable.
- Add fallback RPC behavior or graceful degraded mode.
- Add request timeouts and retry messaging.
- Add telemetry limited to disclosed product metrics.
- Run security review for auth, API access, and transaction matching.
- Remove development bypasses and test keys.

### Design and UX

- Finalize typography, colors, spacing, and iconography.
- Improve first-run copy and empty states.
- Add skeleton loading and offline states.
- Check all buttons and sheets at 320px, 375px, and 430px widths.
- Check long validator names, large balances, missing logos, and unknown addresses.
- Add accessible labels, focus states, and reduced-motion behavior.
- Make evidence understandable without crypto knowledge.

### Public beta

- Publish the live Mini App URL.
- Share the Nimiq Pay deep link.
- Ask community members to test with small amounts or testnet first.
- Collect issue reports in one public channel.
- Fix the top five usability problems within 48 hours.

### Marketing assets

- 60-90 second demo video
- Three mobile screenshots
- One validator profile screenshot
- One plain-language methodology graphic
- One X thread explaining the gap between validator performance and payout accountability
- One community post requesting real test users

### Week 3 deliverable

**Public beta with real wallet interactions and a credible evidence dataset.**

---

## Week 4: Launch, measure, and submit

**Dates:** August 31-September 4  
**Goal:** Maximize quality, unique wallet usage, storytelling, and submission completeness.

### Monday - Reliability freeze

- Freeze new product features.
- Fix transaction and auth failures first.
- Verify production environment variables.
- Verify no secrets or private keys are in the repository.
- Check API health, indexer health, and database persistence.

### Tuesday - Evidence and content

- Refresh validator data.
- Refresh observation calculations.
- Verify every public evidence link.
- Write the 250-word submission description.
- Write the README quick start and architecture explanation.
- Publish a build story with honest limitations.

### Wednesday - Community push

- Ask validators to share their public profiles.
- Publish the demo video.
- Post a concise launch thread.
- Join the competition community call or discussion.
- Respond to every tester and record wallet interaction count.

### Thursday - Final QA

- Test clean install/open path.
- Test connected and disconnected paths.
- Test staking cancellation.
- Test transaction pending and confirmation.
- Test stale indexer data.
- Test unavailable validator data.
- Test mobile screen sizes.
- Test all public share links.
- Run production build and automated smoke checks.

### Friday - Submission

- Confirm MIT license.
- Confirm public GitHub repository.
- Confirm live demo URL.
- Confirm demo video.
- Confirm description is within 250 words.
- Submit through the competition dashboard.
- Publish final launch post.
- Keep monitoring errors and user questions.

### Week 4 deliverable

**A polished, publicly usable, open-source Mini App with a clear story, real NIM usage, and measurable wallet adoption.**

---

## 13. Detailed Acceptance Checklist

### Wallet and staking

- [ ] App opens inside Nimiq Pay.
- [ ] Wallet connection succeeds on a clean session.
- [ ] User sees the correct Nimiq address.
- [ ] Signed challenge verifies server-side.
- [ ] Create-staker transaction can be requested.
- [ ] Native confirmation dialog clearly identifies the action.
- [ ] Successful transaction is confirmed from chain data.
- [ ] Rejected transaction returns to a useful state.
- [ ] Pending transaction survives reload.
- [ ] User can see current position state.
- [ ] At least one additional lifecycle action works reliably.
- [ ] No private key or seed phrase is ever requested.

### Validator data

- [ ] Registry data has a source timestamp.
- [ ] Official score is distinguished from Steakout observations.
- [ ] Unknown or unlisted validators are not silently omitted from network summaries.
- [ ] Missing score data is displayed as insufficient data.
- [ ] Reward address is resolved from chain data where possible.
- [ ] Declared payout schedule is not treated as verified behavior.

### Accountability

- [ ] Direct payout transactions can be indexed.
- [ ] Transactions are deduplicated.
- [ ] Index cursors recover after restart.
- [ ] Schedule grouping has tests.
- [ ] Recipient coverage has tests.
- [ ] Evidence links open the correct transaction.
- [ ] Data freshness is visible.
- [ ] Insufficient history is visible.
- [ ] Effective fee is not displayed.
- [ ] No accusatory labels are used.

### UX

- [ ] New user reaches validator selection in under 60 seconds.
- [ ] Primary action is obvious on every screen.
- [ ] App works at 320px width.
- [ ] Large balances do not overflow.
- [ ] Long names and missing logos are handled.
- [ ] Loading, empty, error, and offline states exist.
- [ ] Native wallet confirmations are preceded by a clear review state.
- [ ] Public validator profiles work without wallet connection.

### Submission

- [ ] Public MIT repository.
- [ ] No secrets committed.
- [ ] Live demo URL.
- [ ] README with setup and architecture.
- [ ] Demo video.
- [ ] Screenshots.
- [ ] Submission text within 250 words.
- [ ] Build story and community updates published.

---

## 14. Testing Strategy

### Unit tests

- Schedule parser and normalizer
- Payout-run grouping
- Recipient coverage calculation
- Observation status calculation
- Address normalization
- Luna/NIM conversion
- Position state normalization
- Transaction intent matching
- Index cursor advancement

### Integration tests

- Validator API fixture ingestion
- RPC response normalization
- Auth challenge and signature verification
- Transaction confirmation polling
- Indexer pagination and retry
- Duplicate transaction handling
- Public profile response

### Manual device tests

- Nimiq Pay Android
- Nimiq Pay iOS, if available
- Mobile browser fallback
- Desktop browser with Nimiq Hub
- Testnet staking flow
- Mainnet read-only monitoring

### Failure tests

- User rejects wallet connection
- User rejects native transaction
- Provider unavailable
- RPC timeout
- RPC returns malformed data
- Transaction is not found
- Transaction fails execution
- Indexer is stale
- Validator schedule is free text
- Validator has no payout history
- User has no staker account
- User has retired stake
- User switches wallet account

---

## 15. Security and Trust Requirements

### Non-custody

Steakout must never receive or control user private keys. Staking operations are requested through Nimiq Pay and approved natively.

### Transaction safety

Before requesting a transaction, show:

- Action type
- Amount in NIM
- Amount in Luna only as secondary technical detail
- Validator name and address
- Resulting position transition
- Whether the operation has a waiting period

On the server, match confirmed transactions against the user's authenticated address and the intended action.

### Authentication

- Use Nimiq signed-message challenge authentication.
- Bind the verified public key to the derived Nimiq address.
- Use short-lived sessions.
- Rate-limit challenges and verification attempts.
- Never treat a wallet address supplied only by the client as authenticated identity.

### Privacy

Disclose:

- Wallet address is sent to the Steakout server to retrieve position and activity data.
- Public chain activity may be associated with the user's Steakout session.
- Product analytics should be aggregate and minimal.
- No unnecessary name, email, or location collection is required for v1.

### Defamation and financial-risk controls

- Avoid claims of fraud, theft, or intent.
- Avoid guaranteed yield or guaranteed payout language.
- Show raw observations and methodology.
- Give validators a factual contact channel for correcting registry declarations, not observed history.
- Keep an audit trail of calculation-version changes.
- Include a visible limitations page.

---

## 16. Marketing and Distribution Plan

### Core campaign message

> **The official validator score tells you who produces blocks. Steakout shows you what stakers can observe after they delegate.**

### Audience hooks

| Audience | Message | Channel |
|---|---|---|
| NIM holders | Put idle NIM to work without leaving Nimiq Pay | Nimiq community, X, short demo |
| Existing stakers | See your position and payout evidence in one place | Validator communities, Telegram, Discord |
| Validators | Share an independently observed payout profile | Direct outreach, X, validator sites |
| Nimiq builders | Native staking writes are now usable in Mini Apps | Builder community, GitHub, technical post |
| Council/judges | A real protocol feature improves the Pay ecosystem | Submission story and live demo |

### Viral assets

- Public validator profiles
- Shareable observation snapshot URLs
- Validator comparison cards
- `Last observed payout` cards
- Network decentralization view
- 60-second wallet-to-stake video

### Validator outreach script

> We are building Steakout, a Nimiq Pay Mini App that lets users stake NIM and inspect public validator payout observations. We are not asking validators to approve or edit observations. We would like to include your public registry data and send you a preview profile so you can check that the declared policy is represented accurately.

### Community cadence

- Week 0: technical direction and testnet findings
- Week 1: first native staking transaction
- Week 2: first payout observation report
- Week 3: public beta and tester request
- Week 4: launch metrics, demo, and submission

Track:

- Distinct connected wallet addresses
- Staking intents
- Successful staking transactions
- Validator profile views
- Repeat sessions
- Public profile shares
- Indexer history depth

Do not count raw pageviews as unique wallet usage.

---

## 17. Scoring Strategy

The official score is 105 points across five categories. The target is not to claim a perfect score; it is to ensure that no category is neglected.

### Design and UX - 25 points

Target evidence:

- Professional, calm visual system
- Clear distinction between official scores and observed data
- Simple one-screen next action
- Native mobile layouts
- First stake flow under 60 seconds after connection
- Excellent loading and failure states

### Functionality - 25 points

Target evidence:

- Real native staking writes, not mock transactions
- Chain-confirmed transaction states
- Position reads from RPC/API
- Functional validator directory
- Working payout observation records
- Graceful RPC/indexer degradation
- Complete enough lifecycle to feel like a product, not a demo

### Usefulness and originality - 25 points

Target evidence:

- Solves the documented gap in Nimiq staking visibility
- Makes staking possible inside Nimiq Pay
- Uses native staking methods as the core feature
- Adds a new staker-side accountability perspective
- Has repeat monitoring value
- Provides public evidence rather than another opaque yield number

### Marketing and distribution - 25 points

Target evidence:

- Validator outreach and profile sharing
- Real wallet interactions during the scoring period
- Weekly public build updates
- Clear demo video
- Community participation and feedback response
- A submission story with concrete usage numbers

### Bonus - 5 points

Steakout supports NIM directly and incentivizes staking NIM through the native protocol. The app should not add a token, use USDT as the primary flow, or hide NIM behind an abstract points system.

### What could lower the score

- Broken staking methods
- Fake or simulated validator data
- A misleading payout score
- No mobile polish
- No usable account state
- A dashboard that only repeats the official validator API
- Poor failure handling
- No community distribution effort
- A custodial or unclear funds flow

---

## 18. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nimiq Pay staking methods are unavailable or broken | Fatal | Test on real device in Week 0; activate read-only fallback early |
| Provider transaction return type is unclear | High | Test actual return and confirm through RPC before UI assumptions |
| No staker read method in provider | High | Build server-side RPC read layer and cache normalized state |
| Public RPC rate limits | High | Backoff, bounded polling, cache, second source, self-hosting plan |
| Historical payout data is too shallow | High | Start indexer before Week 1 and show history depth honestly |
| Restake payout intent is difficult to infer | High | Use position growth only; scope direct payout monitoring first |
| Outflows include non-reward transfers | High | Do not calculate effective fee in v1 |
| Registry payout schedules are inconsistent free text | Medium | Normalize common formats; show raw declaration and insufficient data |
| Unlisted validators are omitted | Medium | Query all-observable validator data and label registry coverage |
| User expects guaranteed yield | Medium | Use illustrative estimates and prominent risk/limitation copy |
| Validator disputes observation | Medium | Show raw source transactions, calculation version, and neutral language |
| Low initial wallet adoption | High | Validator profile sharing, community calls, direct tester outreach |
| Native staking is added to Nimiq Pay | Medium | Position Steakout around accountability and monitoring, not only staking entry |
| Product becomes too broad | High | Cut effective fee, alerts, restake parity, and social features before core flow |

---

## 19. Kill Criteria and Decision Gates

### Kill or pivot in Week 0 if

- Native staking writes cannot be triggered in the shipped Nimiq Pay environment.
- Transactions cannot be confirmed reliably from the available RPC path.
- The minimum stake or protocol state cannot be explained safely.
- The app would need to custody user funds.
- Payout history cannot be collected at a useful cadence.

### Reduce scope if

- Direct payout classification works but restake position reads do not.
- Only a small number of validators have normalizable schedules.
- RPC throughput supports listed validators but not all observable validators.
- Mobile wallet handoff takes longer than the core staking flow.

### Do not launch a metric if

- Its definition cannot fit in one sentence.
- Its source transaction or account state cannot be linked.
- It requires guessing transfer intent.
- It presents insufficient data as a negative score.
- A validator could reasonably be labeled dishonest based on a false positive.

---

## 20. Launch Definition

Steakout is ready to submit when all of the following are true:

1. A new user can open the app in Nimiq Pay and connect a wallet.
2. The user can select a validator and request a real native staking transaction.
3. The app confirms the transaction from chain data.
4. The user's position is displayed with a timestamp.
5. At least one validator profile has real, evidence-backed payout observations.
6. The UI clearly distinguishes declarations, observations, and insufficient data.
7. The app works on a phone without assistance.
8. A public validator profile can be shared without wallet connection.
9. The repository is MIT-licensed and free of secrets.
10. A stranger can understand the value from a 60-second demo.

---

## 21. References

### Competition

- [Competition scoring](https://miniappscompetition.com/scoring)
- [Competition rules](https://miniappscompetition.com/rules)
- [Cycle 1 submissions](https://miniappscompetition.com/submissions/cycle1)
- [Competition examples](https://miniappscompetition.com/examples)

### Nimiq Mini Apps

- [Mini Apps overview](https://nimiq.dev/mini-apps)
- [Mini App API reference](https://nimiq.dev/mini-apps/api-reference)
- [Nimiq provider API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider)
- [Device identifier](https://nimiq.dev/mini-apps/features/device-identifier)

### Nimiq staking and protocol

- [Nimiq staking](https://www.nimiq.com/staking/)
- [Validator Trust Score](https://nimiq.dev/nodes/validators/validator-trustscore)
- [Stakers](https://nimiq.dev/protocol/validators/stakers)
- [Rewards](https://nimiq.dev/protocol/economics/rewards)
- [Staking FAQ](https://nimiq.dev/nodes/validators/staking-faq)
- [Accounts](https://nimiq.dev/protocol/accounts)
- [Transactions](https://nimiq.dev/protocol/transactions)
- [Nimiq validators API repository](https://github.com/nimiq/validators-api)
- [Nimiq explorer list](https://raw.githubusercontent.com/nimiq/awesome/main/src/data/dist/nimiq-explorers.json)

### VeriLock reuse reference

> **Editor's note (repo copy):** the original relative link `../verilock/` referred to the VeriLock checkout next to the spec's original location. On this machine the VeriLock repository lives at `/Users/sharms/_github_repos/verilock`. See [ARCHITECTURE.md §6](ARCHITECTURE.md) for the full porting map.

- VeriLock repository (see note above)
- `client/src/nimiq.ts`
- `client/src/journey/useJourneyWallet.ts`
- `server/src/nimiq-rpc.ts`
- `server/src/hub-signature.ts`
- `server/src/auth-wallet.ts`

---

## 22. Immediate Next Actions

1. Test native staking writes in Nimiq Pay on testnet.
2. Resolve the minimum-stake and transaction-return-value questions.
3. Start the reward-address indexer before building the polished UI.
4. Ask Nimiq whether native staking is planned for Nimiq Pay during Cycle II.
5. Create the Steakout repository and port only the wallet/RPC/auth modules needed.
6. Publish the first public build note before August 10.
