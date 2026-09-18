# Activity / transaction history architecture

Phase 5.1 provides a UI-independent public transaction activity model,
repository, lifecycle service, and read model. Phase 5.2 adds the
presentation-only Activity destination and asset-first feed. The feed does not
build a complete transaction detail page, backend indexing, external indexers,
notifications, analytics, or cloud persistence.

Records are scoped by `accountId`, `networkId`, and exact `chainId`. A local
record uses a generated `localTransactionId` before a blockchain hash exists.
Once a hash is available, the same record associates it with the scoped
network/hash identity. Blockchain-discovered records may omit the local ID
but must have a scoped hash.

The lifecycle preserves `draft`, `signed`, `broadcasting`, `broadcasted`,
`confirming`, `confirmed`, `reverted`, `failed`, and `unknown` as distinct
states. `ActivityService` consumes the existing signing, broadcast, and
confirmation results; it does not broadcast, poll receipts, access secrets,
or create a second transaction engine. Unknown outcomes remain unknown until
an explicit future reconciliation updates the record.

`InMemoryActivityRepository` is the approved Phase 5.1 persistence decision.
It keeps public financial metadata in the current session only. It does not
use AsyncStorage, localStorage, SecureStore, a database, a backend, or an
analytics service.

Reads are bounded to a maximum of 100 records and use deterministic
newest-first ordering. Records with known block context sort ahead of
hash-known pending records, which sort ahead of local-only records. Block
numbers are the primary order when present; observation times are secondary.
No blockchain timestamp is invented.

All quantities remain `bigint` or exact strings. The read model contains
public metadata only: no mnemonic, private key, PIN, biometric credential,
SecureStore value, or signing capability is accepted by this module.

## Phase 5.1A asset-first presentation amendment

`ActivityReadModelService` now attaches an `ActivityPresentationModel` to each
public activity item. The existing activity record and repository remain
authoritative; presentation data is derived for the future Activity UI and
does not create a second transaction model.

The presentation model includes:

- `primaryAsset` and optional `secondaryAsset`, with network-scoped identity,
  symbol/name metadata, exact decimals, existing `AssetIcon` fallback data,
  metadata status, and independent verification status.
- Network name, exact chain ID, deterministic badge identity, fallback
  initials, and configured/available state from the existing `NetworkRegistry`.
  No external logos or network APIs are used.
- Explicit `sent`, `received`, `swapped`, `approved`,
  `contract_interaction`, and `unknown` actions.
- Counterparty type, full address, deterministic shortened address, and
  direction label. No address is treated as trusted or verified implicitly.
- Exact primary and optional secondary amounts with raw bigint, decimals,
  formatter output, explicit sign, and symbol.
- Optional fiat display data. It is `null` unless a later approved data layer
  explicitly supplies it; this phase does not add pricing or hardcoded values.
- Timestamp value and source. Block timestamps are marked blockchain-derived;
  otherwise the observation timestamp is used. No blockchain timestamp is
  invented.
- Explorer availability and a transaction URL derived only from valid,
  configured network explorer metadata.

Future trusted event interpreters may provide an explicit action and a second
asset/amount through the presentation resolver. The model preserves explicit
input/output semantics but does not detect swaps, infer swaps from logs,
execute swaps, or implement approvals.

The existing `AssetIcon`/`TokenLogo` architecture is reused. Icon availability
does not imply token verification. ERC-20 identity remains
`networkId + contractAddress`, while native identity remains network-scoped;
same-symbol assets on different networks are never merged.

Phase 5.1A remains UI-independent and does not implement Activity UI,
transaction detail UI, backend history, external indexing, notifications,
analytics, price APIs, signing, authentication, SecureStore access,
broadcasting, replacement, speed-up, or cancellation.

## Phase 5.2 Activity destination

`WalletActivityScreen` consumes only `ActivityReadModelService` items and their
`ActivityPresentationModel` data. It never calls RPC, reads receipts,
reconstructs a transaction, calculates a blockchain amount, or creates another
repository. Results remain bounded to the read-model limit and are rendered in
React Native list primitives.

Rows are asset-first: the primary asset icon is the visual anchor, the
deterministic network badge overlaps its lower-right corner, the action and
counterparty sit in the center, and exact signed amounts are right-aligned.
Fiat is rendered only when the presentation model provides it. Missing icons
use the existing deterministic fallback; icon availability remains independent
of verification.

The Activity type and network controls are display filters. Selecting a network
does not call `NetworkRegistry.selectActiveNetwork()` and cannot change the
wallet's active network. All-networks reads query each enabled, configured
network with the same account scope; network and chain identity remain bound
at the service boundary.

Statuses remain distinct, including pending, confirmed, reverted, failed, and
unknown. Unknown is not presented as failed, and a sent label is not treated as
confirmation. Dates use the presentation timestamp and source, with newest
activity grouped first. A row opens the read-only Transaction Details surface
with its safe activity identity and public context; the detail screen resolves
the authoritative item again through the read model.

The UI supports empty, filtered-empty, unavailable, loading, refresh, and
refresh-error states. It does not add fake transactions, fiat prices, inferred
swaps, direct receipt polling, background polling, analytics, backend history,
notifications, or transaction mutation.

## Phase 5.3 Transaction Details and reconciliation

`TransactionDetailScreen` receives only an activity identity and its public
account/network/chain scope. It resolves the current item again through
`ActivityReadModelService`; it does not trust a navigation snapshot and it
does not duplicate activity models. The screen consumes the existing
`ActivityPresentationModel` for action, asset, counterparty, network, exact
amount, timestamp, and explorer presentation.

The detail view is read-only. It distinguishes draft, locally signed,
broadcasting, broadcasted, confirming, confirmed, reverted, failed, and
unknown states. Signed does not mean broadcasted, broadcasted does not mean
confirmed, and unknown does not mean failed. Exact bigint quantities remain
separate from native network fees; only authoritative gas, nonce, receipt,
block, and timestamp fields are shown.

For a known hash, a user-triggered refresh calls the existing public
transaction lookup and, only when the lookup reports mined, the existing
bounded confirmation engine. A receipt updates a local activity record to
confirmed or reverted. Pending, not-found, and inconclusive results do not
trigger a rebroadcast or signing operation. External blockchain-read records
are presented neutrally and can be reconciled without a local transaction ID.
The active network is never changed; mismatched or unconfigured network
contexts fail closed.

Explorer links are displayed only when the presentation model exposes a valid
configured URL. Copy actions write public addresses or hashes through the
existing clipboard boundary and never read or persist clipboard contents.

Phase 5.3 does not implement swap detection or execution, approval execution,
backend history, external indexing, price APIs, notifications, replacement,
speed-up, cancellation, or fee bumping.