# Transaction core

## Phase 4.5 and Phase 4.6 UI boundaries

Phase 4.5 stops at public recipient/amount validation and a controlled public
draft. The Phase 4.6 Transaction Review screen consumes that draft and is the
first UI surface allowed to request read-only Phase 2.4 fee data and Phase 2.5
unsigned construction. Neither phase accesses wallet secrets.

`src/core/transactions/construction` contains the Phase 2.5 UI-independent
unsigned transaction construction engine. It consumes public wallet-account
metadata, the selected configured network, the existing account-state service,
the existing RPC provider, and the Phase 2.4 gas/fee engine.

The construction lifecycle is:

```text
TransactionIntent
  ↓
Public validation and normalization
  ↓
Known local account validation
  ↓
Network and chain validation
  ↓
Nonce retrieval when omitted
  ↓
Gas estimation when omitted
  ↓
Fee-model selection
  ↓
UnsignedTransaction + TransactionPreview
```

The engine supports native transfers and generic contract calls. It does not
decode ABI data or claim that a contract is safe. All blockchain quantities are
`bigint`, fee selection remains explicitly Legacy or EIP-1559, and canonical
debug/test serialization converts quantities to decimal strings without losing
precision.

## Phase 4.6 transaction review

`src/components/TransactionReviewScreen.logic.ts` adapts the public
`PublicSendDraft` into a native-transfer or ERC-20 contract-call
`TransactionIntent` and delegates construction to the existing
`TransactionConstructionEngine`. It does not duplicate nonce, gas, fee, chain,
or canonical unsigned-transaction logic.

The review boundary requires the selected network to remain active and
configured, validates network-scoped asset identity, checks exact native and
token balances, and displays the returned fee model and native fee currency.
Legacy fallback is labeled explicitly. ERC-20 amounts and native network fees
are displayed as separate currencies.

Before returning a public confirmation result, the screen revalidates the
draft and reconstructs the read-only preview. Changes to the account, sender,
network, chain, recipient, amount, asset, fee model, or unsigned transaction
identity invalidate the review. The result is only
`confirmed-for-signing`; this phase does not authenticate, unlock, sign,
broadcast, call `eth_sendRawTransaction`, or mutate blockchain state. Phase
4.7 owns the secure signing authorization boundary.

Private keys, recovery phrases, vault handles, PINs, biometric secrets,
signing capabilities, and secure-storage implementations are outside this
module. It does not sign, broadcast, persist, replace, speed up, cancel, or
automatically approve transactions.

`contracts.ts` remains the earlier reserved signing-flow contract surface. It
is not used by the Phase 2.5 construction implementation.

## Phase 2.6 local signing

`src/core/transactions/signing` performs local transaction signing only. Its
input must be the validated unsigned transaction produced by Phase 2.5 plus a
transaction-specific authorization. The authorization binds:

- account ID and normalized sender
- network ID and chain ID
- transaction type
- recipient, value, calldata, nonce, and gas limit
- Legacy or EIP-1559 fee model and fee fields
- a deterministic digest of the canonical unsigned transaction
- explicit approval and authorization context

Signing also requires the existing wallet authenticator to report an
authenticated/unlocked state. Authentication is checked before the one-time
opaque signing capability is issued. The UI does not receive a key and does
not call the low-level key operation directly.

The existing `LocalWalletEngine` derives the requested HD account from the
in-memory wallet secret and uses the existing `viem` dependency to produce
standard Legacy or EIP-1559 EVM serialization. The mnemonic and derived
signing account remain inside the local wallet/security boundary. The returned
`SignedTransaction` contains only the signed raw transaction, its locally
computed hash, and public network/account metadata.

The signing engine:

- never calls RPC or backend services
- never calls `eth_sendRawTransaction`
- never persists or logs secret material
- rejects authorization or transaction-field mismatches
- rejects account, network, chain, authentication, and concurrent-signing
  failures
- releases references to the temporary derived signing account after signing

JavaScript garbage collection cannot guarantee cryptographic memory
zeroization. The implementation minimizes the derived-account lifetime and
does not retain it in service state; stronger native cryptographic isolation
remains future hardening.

**Phase 2.6 performs local transaction signing only. Broadcasting is
intentionally deferred to Phase 2.7.**

## Phase 4.7 secure authorization and signing handoff

The Phase 4.7 UI requests explicit authentication after the Phase 4.6
confirmation checkpoint. It uses the existing wallet access facade for PIN or
configured biometric authentication, then rechecks the public review context
and exact unsigned transaction identity before invoking Phase 2.6.

`createTransactionSigningAuthorization` binds the account, sender, network,
chain, recipient, value, calldata, nonce, gas, fee fields, and canonical
unsigned transaction digest. `TransactionSigningEngine` issues the existing
one-time opaque capability and delegates key access only to
`LocalWalletEngine`. The UI never receives keys, mnemonics, vault handles, or
signing capabilities.

After successful signing, the UI exposes only public signed transaction data
and a clear `Ready to Broadcast` deferred state. It does not import or invoke
the broadcast engine, `broadcast()`, `sendRawTransaction()`, or
`eth_sendRawTransaction`. Browser Preview Test Mode remains fail-closed and
does not create fake signatures or hashes.

## Phase 4.8 broadcast and confirmation handoff

The signed transaction screen exposes an explicit final checkpoint before
submission. `Broadcast Transaction` is the only path that calls the existing
Phase 2.7 `TransactionBroadcastEngine`; signing, authentication, app resume,
network refresh, and timeout handling never submit automatically.

Before the call, the UI checks the active configured network, chain, sender,
transaction type, and original review context. The exact raw signed bytes and
authoritative hash are passed to the engine unchanged. The engine owns
validation, `eth_sendRawTransaction`, idempotency, concurrency, RPC error
normalization, bounded receipt polling, and unknown-result semantics.

The UI exposes separate broadcasting, broadcasted, confirming, confirmed,
reverted, failed, and unknown states. Unknown outcomes never trigger an
automatic retry or rebroadcast. Explicit reconciliation calls the engine's
existing transaction lookup method. Hash copying uses the public clipboard
boundary, and explorer actions are created only from valid configured-network
transaction templates.

## Phase 5.1 activity and transaction history architecture

`src/core/activity` provides the foundational public activity model without
building the Activity UI. The model distinguishes local transaction identity
from blockchain hash identity and scopes every record to account ID, network
ID, and exact chain ID. External blockchain observations may omit the local
ID but must carry a scoped hash.

The lifecycle model preserves draft, signed, broadcasting, broadcasted,
confirming, confirmed, reverted, failed, and unknown. `ActivityService`
consumes the existing signed, broadcast, and confirmation results; it never
creates a second broadcaster, receipt poller, signer, or reconciliation loop.
Unknown outcomes remain unknown until a future explicit reconciliation updates
the record.

`InMemoryActivityRepository` is the Phase 5.1 persistence decision. It is
bounded, session-only, and enforces account/network/chain isolation. It does
not use AsyncStorage, localStorage, SecureStore, a database, backend
persistence, analytics, or external indexers. `ActivityReadModelService`
provides deterministic bounded presentation data with provenance and explorer
availability while preserving exact bigint quantities.

Phase 5.1 does not implement Activity UI, transaction detail UI, external
indexing, backend history, notifications, Swap, DApps, WalletConnect,
replacement, speed-up, cancellation, or fee bumping.

## Phase 2.7 broadcast and confirmation

`src/core/transactions/broadcast` accepts only the public `SignedTransaction`
result from Phase 2.6. It has no access to wallet engines, vaults, signing
capabilities, PINs, biometric state, mnemonics, or private keys.

The execution lifecycle is:

```text
SignedTransaction
  ↓
Validate raw bytes, local hash, network, and chain
  ↓
Verify configured active network and remote RPC chain
  ↓
eth_sendRawTransaction with exact raw bytes
  ↓
BroadcastResult: broadcasted or unknown
  ↓
Explicit bounded receipt polling
  ↓
ConfirmationResult: confirmed, reverted, or unknown
```

The broadcaster reuses the existing `EvmRpcProvider`. It does not create
another HTTP client, modify or reserialize the signed transaction, retry
automatically, switch networks, or implement replacement, speed-up,
cancellation, fee bumping, or persistent transaction history.

Broadcast identity is the signed transaction hash. In-memory idempotency
reuses an in-flight or completed operation for the same hash, including an
ambiguous timeout result. A timeout or transport failure after the send
attempt returns `unknown` and never triggers an automatic second submission.

Receipt polling has bounded, configurable interval and timeout values. A null
receipt remains pending during polling and becomes `unknown` only when the
polling bound is reached. A receipt with status `0x1` is `confirmed`; status
`0x0` is `reverted`. Receipt quantities remain `bigint`.

Confirmation and read-only transaction lookup remain tied to the provider and
network captured for the signed transaction. A change to the user’s active
network does not redirect confirmation to another chain.

**Phase 2.7 broadcasts already-signed transactions and observes blockchain
confirmation. It does not construct or sign transactions.**