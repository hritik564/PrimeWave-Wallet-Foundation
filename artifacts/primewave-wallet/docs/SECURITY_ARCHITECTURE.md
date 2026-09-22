# PrimeWave Wallet Security Architecture

## SECURITY — DO NOT BREAK

PrimeWave Wallet is strictly non-custodial. The user controls their wallet
keys, and PrimeWave infrastructure must never have access to private keys or
recovery phrases.

Future developers and agents must never:

1. Send private keys to servers.
2. Send seed phrases or mnemonics to servers.
3. Store secrets in databases, cloud storage, analytics, or crash reports.
4. Log secrets or include them in error messages.
5. Expose private keys to UI components.
6. Place secrets in persistent UI state, URLs, or query parameters.
7. Implement custom cryptography, mnemonic generation, or elliptic-curve code.
8. Silently sign transactions.
9. Automatically approve transactions.
10. Add analytics around secret material.

This is a permanent architectural invariant, not a temporary implementation
choice.

## Phase 7.1 DApp boundary

The DApp core is a public-input boundary, not a wallet-secret boundary.
`src/core/dapp` models contain DApp metadata, public wallet/account context,
network context, permissions, request payloads, and lifecycle state only.
Private keys, recovery phrases, PINs, secure-vault values, and signing handles
are not valid DApp model fields.

DApp metadata is untrusted. URL schemes, credentials, lengths, malformed
values, request payloads, account scope, network scope, and lifecycle states
are validated before entering the in-memory models. Metadata never creates a
trusted-DApp classification.

Sessions are bounded and in-memory only. They are isolated by account and
network, and revoked or expired sessions cannot satisfy permissions.
Connection/account/network access is separate from message-signing and
transaction-signing authorization. No capability is automatically granted.

Transaction requests express public intent only. The DApp boundary cannot call
the local wallet engine, access secure storage, obtain a raw signer, invoke
`eth_sendRawTransaction`, or change the active network. Future execution must
remain:

```text
DApp request → validation → WaveX review → existing construction
  → explicit authorization → existing local signing
  → existing broadcast/confirmation
```

Typed-data payloads are retained as exact provider-supplied input for
cryptographic binding. The signing review may parse a bounded representation
for display, but the original JSON is passed unchanged to the local signing
boundary. The transport interface is provider-neutral and provider-specific
calls remain isolated under `src/core/dapp/providers/walletconnect`.

## Phase 7.2 WalletConnect transport boundary

The real WalletConnect/Reown adapter is isolated under
`src/core/dapp/providers/walletconnect/`. It receives public metadata,
registered network definitions, and an explicit public authorization decision
only. Wallet secrets, SecureStore values, raw signers, signing capabilities,
and wallet engine handles never cross into the provider layer.

The adapter uses in-memory WalletConnect storage and the existing bounded
in-memory DApp session repository. Proposal metadata is validated as untrusted
input; proposal observation never implies approval. The adapter approves only
explicitly authorized public account/network namespaces and rejects all
signing or transaction requests with sanitized provider errors. Session
updates that change the authorized account or primary network are revoked
instead of silently rebinding the session. It normalizes only the supported
message-signing methods and responds through the SDK only after the UI
explicitly approves or rejects the request.

## Phase 7.3 approval UI boundary

The connection screen is an explicit user-consent boundary, not a trust
indicator. It presents DApp name, URL/origin, icon-or-fallback, public account,
validated networks, and requested capabilities. It labels metadata as
unverified and states that connection exposes only the approved public address;
it does not expose private keys or grant signing authority.

The screen never auto-approves, never approves in the background, and guards
duplicate/concurrent actions with explicit pending states. It captures the
account and active-network context when a proposal arrives, then revalidates
expiry, identity, account, active network, requested chains, capabilities, and
current network configuration before approval. Stale, expired, changed, or
failed proposals cannot create a session.

The preview build has no fake DApp connection path. Real proposals require the
native WalletConnect transport and a configured public project ID. Physical
native-device pairing and deep-link behavior remain unverified until a
standalone native test build is available.

## Phase 7.4 message-signing boundary

Only already-connected sessions may create a signing request. The provider
request is checked against the live session topic, approved account, approved
chain, registered network, request expiry, method, and exact two-parameter
shape before it reaches the UI. The supported methods are:

- `personal_sign`
- `eth_signTypedData`
- `eth_signTypedData_v4`

Transaction methods, raw transaction methods, signing methods outside this
list, network-switch methods, and automatic network changes remain unsupported.

`personal_sign` accepts either provider ordering for address/message,
preserves the original message bytes, and uses a bounded sanitized display
only for review. Typed data must be valid JSON with a domain, type
declarations, primary type, message, and safe optional chain/verifying-contract
values. The raw JSON is retained for signing; display fields are bounded and
may be marked as normalized.

The UI is the only approval boundary. A Sign action captures request ID,
account, network, and payload digest, then invokes the existing authentication
flow. The local wallet engine receives a one-shot opaque message-signing
capability and never exposes a private key, mnemonic, raw signer, SecureStore
value, or vault handle. The capability is consumed exactly once and rejects
replay or context mismatch. The provider receives only the resulting signature
or an explicit rejection/error.

## 1. Security principles

- **Non-custodial architecture:** signing authority remains on the user's
  device.
- **Local key ownership:** private signing material is device-local and
  encapsulated behind security and wallet-engine interfaces.
- **Least privilege:** each layer receives only the capability it needs.
- **Defense in depth:** secure storage, authentication, confirmation, privacy
  controls, safe logging, and sanitized errors work as separate controls.
- **Fail closed:** missing authentication, malformed state, uncertain
  transaction data, and unavailable security capabilities must not silently
  proceed.
- **Secure defaults:** sensitive operations require explicit opt-in and
  explicit user confirmation.
- **No secret transmission:** secrets never cross a device-to-server boundary.
- **No secret logging:** secrets never appear in logs, telemetry, analytics,
  URLs, query parameters, or crash reports.

## 2. Secret classification

### Critical secrets

- Seed phrases and mnemonics
- Private keys and derived private signing keys
- Wallet encryption keys
- Wallet authentication secrets
- Wallet passwords and PINs
- Biometric credentials
- Decrypted wallet vaults
- Raw cryptographic secrets

Critical secrets must remain local to the user's device and must not be sent to
an API, stored in PostgreSQL or cloud storage, written to logs, included in
errors, or passed through analytics and telemetry.

### Sensitive data

- Wallet addresses
- Transaction history
- Connected DApps
- Portfolio information
- User-selected accounts and wallet state

Sensitive data may require privacy controls and careful minimization. Its
classification does not make it equivalent to a private key or recovery
phrase.

### Public data

- Token metadata
- Blockchain data
- Network configuration
- Public transaction hashes

Public blockchain data is not equivalent to private wallet secrets. Public
does not mean that all collection, retention, or analytics use is appropriate;
data minimization still applies.

## 3. Trust boundary

```text
USER DEVICE
  │
  │ private wallet secrets remain here
  ▼
LOCAL WALLET ENGINE
  ├─ key derivation
  ├─ transaction construction
  ├─ transaction signing
  └─ secure vault
  │
  ▼
BLOCKCHAIN RPC
  │
  ▼
BLOCKCHAIN NETWORK

PRIMEWAVE BACKEND
  ├─ token metadata
  ├─ market data
  ├─ transaction indexing
  ├─ notifications
  ├─ optional user profile
  └─ analytics

  NEVER receives:
  ├─ private keys
  ├─ seed phrases
  └─ signing secrets
```

The UI communicates with a future `WalletEngine`. It does not directly access
private keys, mnemonic phrases, cryptographic libraries, secure storage, or
signing libraries:

```text
UI
  ↓
WalletEngine
  ↓
Security layer
  ↓
Reviewed cryptographic implementation
```

The backend may provide public or user-approved non-secret data services, but
it must never be responsible for signing user transactions.

## 4. Data-flow boundaries

### Must remain local

- Seed phrases, mnemonics, private keys, signing keys
- Encryption keys, passwords, PINs, biometric credentials
- Decrypted wallet vaults
- Raw cryptographic material
- Temporary signing capabilities

### May leave the device when required and minimized

- Public addresses
- Public transaction hashes
- Public token and chain metadata
- A transaction payload only after the user has explicitly reviewed it, when
  required for RPC construction or broadcasting
- Optional profile and analytics data that contains no secret material

### Prohibited destinations for critical secrets

Critical secrets must never be sent to APIs, PostgreSQL, cloud storage,
analytics, crash-reporting systems, logs, error messages, URLs, query
parameters, or telemetry.

## 5. Attack surface, mitigations, and limitations

| Attack surface | Planned mitigation | Limitation |
| --- | --- | --- |
| Malicious applications | Platform-secure storage, least privilege, screen privacy | A compromised device can bypass application controls |
| Compromised RPC providers | Validate network configuration, display transaction context, fail closed on uncertainty | The wallet cannot make an untrusted RPC honest |
| Malicious DApps | Explicit connection permissions and human-readable transaction review | Contract intent may remain difficult to interpret |
| Phishing and social engineering | Clear recovery warnings, domain/session context, explicit confirmation | Users can still be persuaded to disclose secrets |
| Malicious or fake tokens | Token verification and contract-address clarity | Verification cannot prove economic safety |
| Clipboard exposure | Explicit warning, minimal exposure, clearing where supported | Mobile platforms do not offer identical clipboard controls |
| Screenshots and screen recording | Platform-specific privacy controls where supported, masking in background | Screenshot prevention is not universal |
| Device compromise | Secure storage and device authentication | Rooted or jailbroken devices weaken platform guarantees |
| Rooted Android or jailbroken iOS | Detect and communicate elevated risk where appropriate | Detection is imperfect and cannot restore trust |
| Debugging and logs | Centralized sanitized logger and release-build controls | Runtime behavior can vary across development tools |
| Dependency vulnerabilities | Dependency review, lockfile discipline, security scanning | Third-party risk cannot be eliminated completely |
| Supply-chain attacks | Minimize dependencies and use reviewed production libraries | A compromised upstream package remains a risk |
| Fake token contracts | Verified-token metadata and clear contract addresses | Users may still choose unverified contracts |
| Transaction manipulation | Preview, explicit confirmation, authentication, and local signing | Users must still review the information presented |

PrimeWave Wallet must not claim that it can completely prevent these threats.

## 6. Security interfaces

Phase 0B defined the contracts. Phase 1B-1 implements the `SecureVault`
boundary with a reviewed Expo platform adapter. Authentication, secret-manager,
and signing implementations remain deferred to their separately approved
phases.

- `SecureVault` — save, retrieve, delete, and check for encrypted wallet state.
- `WalletAuthenticator` — PIN and biometric authentication boundaries,
  availability, locking, and unlocking.
- `SecretManager` — protected secret material lifecycle and best-effort
  clearing.
- `KeyManager` — account derivation and encapsulated signing capability.
- `WalletEngine` — the only future boundary the UI should use for wallet
  operations.

The contracts intentionally do not expose `getPrivateKey`,
`exportPrivateKeyToFrontend`, `sendPrivateKey`, or equivalent APIs.

## 7. Transaction signing contract

The future flow is:

```text
TransactionBuilder
  ↓
TransactionPreview
  ↓
UserConfirmation
  ↓
Authentication
  ↓
LocalSigner
  ↓
SignedTransaction
  ↓
BlockchainBroadcaster
```

No transaction may be signed without explicit user confirmation. Before
signing, the user must eventually see:

- Asset
- Amount
- Destination
- Network
- Network fee
- Total amount
- Transaction type

Smart-contract interactions should provide as much human-readable information
as safely possible. The user must have explicit **Approve** and **Reject**
choices. Automatic, silent, and background signing are prohibited.

## 8. Screen privacy

Future sensitive screens include recovery phrase, private-key export,
transaction confirmation, and wallet security settings.

The `ScreenPrivacyController` prepares for:

- Background-app masking
- Sensitive-content masking
- Screenshot protection where technically supported
- Platform-specific behavior on iOS and Android
- Clearing sensitive content when a screen loses focus

Platform capabilities differ. The implementation must document what each
platform actually supports instead of promising universal screenshot
prevention.

## 9. Clipboard security

The future clipboard policy requires:

- An explicit warning before copying sensitive information
- Minimal clipboard exposure
- Clearing sensitive clipboard contents when technically possible
- Never automatically copying recovery phrases
- Never logging clipboard contents
- Never reading clipboard contents unnecessarily

Seed phrase and private-key functionality are not implemented in Phase 0B.

## 10. Logging security

All future application logging must go through `SecureLogger`, which supports
debug, info, warning, and error levels.

The current abstraction redacts sensitive context keys, sensitive message
content, and non-primitive context values before writing to the console.
Future production logging must also exclude secrets from analytics, telemetry,
crash reporting, URLs, and query parameters.

Complete transaction payloads should not be logged when they could contain
sensitive user information.

## 11. Phase 2.5 unsigned transaction boundary

Phase 2.5 constructs unsigned transactions only. Signing and broadcasting are
intentionally deferred.

The construction engine accepts:

- Public sender and recipient addresses
- Public wallet-account metadata for sender ownership validation
- Native value and opaque hexadecimal calldata
- Optional public nonce and gas-limit quantities
- The selected configured network ID

It may perform only public read operations required for construction:

- `eth_chainId`
- `eth_getTransactionCount`
- `eth_estimateGas`
- `eth_gasPrice`
- `eth_maxPriorityFeePerGas`
- `eth_getBlockByNumber`

It does not import SecureStore, SecureVault, mnemonic storage, private-key
storage, biometric authentication, PIN storage, or signing capability
implementations. It does not unlock the wallet, create signatures, call
`eth_sendRawTransaction`, persist transaction state, or expose a method for
signing or broadcasting.

The sender must match a known public local wallet account. The constructor
does not derive, substitute, unlock, or retrieve a private key. Generic
contract calldata remains opaque; the preview adds only a caution that contract
interactions may have arbitrary effects. It does not call a contract safe,
trusted, harmless, or approved.

Network identity and chain ID are captured from the active registry/provider
context. The engine checks for network changes after nonce, gas, and fee reads
and fails closed with a sanitized network-change error. A canonical
representation converts bigint quantities to decimal strings only for
deterministic tests/debugging; the in-memory transaction model retains bigint
quantities.

No secrets or full RPC payloads are included in construction logs or errors.

## 12. Phase 2.6 local signing boundary

Phase 2.6 performs local transaction signing only. Broadcasting is intentionally
deferred to Phase 2.7.

The signing engine consumes the validated Phase 2.5 unsigned transaction and a
transaction-specific authorization. The authorization includes and verifies:

- account ID
- normalized sender address
- network ID
- chain ID
- transaction type
- nonce
- gas limit
- value
- recipient
- calldata
- Legacy or EIP-1559 fee model
- fee fields
- canonical unsigned transaction digest
- explicit approval and authorization timestamp/context

The engine independently checks the selected configured network and chain
before authentication, before key access, and after signing. A network change
fails closed with a normalized signing error. The engine never switches
networks or retries against a different chain.

Authentication uses the existing `WalletAuthenticator` contract and requires
the wallet to report an authenticated/unlocked state. No second PIN,
authentication system, or long-lived signing session is created. Cancelled or
unavailable authentication stops signing and returns a normalized error.

After successful authentication, the engine issues a one-time opaque signing
capability bound to the account ID and transaction digest. The
`LocalWalletEngine` consumes that capability, derives the requested HD account
from the in-memory wallet secret, and signs with the existing `viem`
dependency. It supports standard Legacy and EIP-1559 transactions with the
validated chain ID. It does not modify nonce, gas, value, recipient, calldata,
or fee parameters.

The public result contains only the signed raw transaction, its locally
computed hash, and public network/account metadata. It does not contain a
private key, mnemonic, seed, decrypted vault contents, authentication
credentials, or vault handles. The signer does not call the backend, RPC,
analytics, cloud signing services, or `eth_sendRawTransaction`.

Temporary derived-account references are released in a `finally` block and no
signing key is stored in React state, global state, caches, AsyncStorage,
localStorage, URLs, logs, errors, analytics, or transaction previews.
JavaScript/TypeScript garbage collection cannot guarantee cryptographic
zeroization; this is documented as a limitation, and native cryptographic
isolation remains future hardening.

Concurrent signing attempts for the same account are rejected rather than
queued. Signing is only exposed through an explicit call; startup, refresh,
background work, notifications, DApp discovery, and automatic retry do not
trigger it.

## 13. Phase 2.7 broadcast and confirmation boundary

Phase 2.7 consumes only the public `SignedTransaction` result from Phase 2.6.
The broadcaster has no dependency on `LocalWalletEngine`, `SecureVault`,
signing capabilities, authentication state, mnemonic storage, or private-key
access. It cannot sign or construct an unsigned transaction.

Before sending, the engine validates:

- 0x-prefixed raw signed bytes with complete byte pairs
- local transaction hash consistency
- parseable Legacy or EIP-1559 serialized transaction
- signed chain ID
- enabled, configured network identity
- currently active network identity
- remote RPC chain ID

All network and chain identities must match. The engine never switches the
active network. It transmits the exact `rawTransaction` string received from
Phase 2.6 through the existing `EvmRpcProvider` and does not reserialize,
modify, rebuild, or re-sign it.

`eth_sendRawTransaction` is called only from an explicit `broadcast()` call
after validation succeeds. Construction, signing, confirmation initialization,
startup, network selection, refresh, and app lifecycle events do not call it.

The signed transaction hash is the in-memory operation identity. Concurrent
calls reuse the existing operation, and completed or ambiguous operations are
not automatically submitted again. The engine does not create persistent
queues, transaction history, or backend records.

An RPC timeout or network transport failure after the send attempt is
ambiguous: the result is returned as `unknown` with the signed transaction
hash, and no automatic rebroadcast occurs. A provider rejection, malformed
response, hash mismatch, chain mismatch, or network change becomes a
normalized error. Raw RPC messages, payloads, stacks, and response data are
not exposed.

Confirmation uses the original provider/network context captured for the
signed transaction rather than the current UI-selected network. It polls only
when explicitly invoked, with bounded configurable interval and timeout. A
null receipt remains pending during the polling window and becomes `unknown`
after the bound. A valid receipt with status `0x1` is `confirmed`; status
`0x0` is `reverted`. Receipt quantities use `bigint`.

The public execution models contain only transaction hash, network and chain
identity, public sender/type metadata, lifecycle state, and safe receipt
fields. They contain no private key, mnemonic, seed, vault contents, signing
capability, PIN, biometric secret, or authentication credential.

## 14. Phase 3.1–3.4 asset, token-read, discovery, and portfolio boundary

Phase 3.1 adds a read-only asset layer. It defines architectural asset types
for native assets, fungible tokens, and NFTs. Phase 3.2 adds generic,
read-only ERC-20 identity, metadata, and balance reads. NFTs and
state-changing token operations remain outside this boundary. The native asset
identity is network-scoped:

```text
assetType = native
networkId = <network registry ID>
assetId = native
```

Symbols, names, and decimals are display/metadata fields, never primary keys.
`AssetRegistry` derives native metadata from the existing network registry and
rejects unknown, disabled, and unconfigured networks as usable assets.
PrimeWave Chain remains a placeholder until official configuration is supplied;
no chain ID, RPC endpoint, symbol, or decimals are invented by this phase.

`NativeAssetBalanceService` accepts only an explicit network ID, account ID,
and public address. It delegates to explicitly network-bound
`EvmAccountStateService` instances and uses the existing RPC provider and
`eth_getBalance` path. It does not access vaults, secrets, PINs, biometrics,
authentication, signing, transaction construction, broadcasting, backend
services, analytics, or persistence.

Every balance model carries asset identity, network/chain context, account ID,
public address, raw bigint balance, exact display amount, and retrieval time.
Balances on the same address across different networks remain separate. The
engine never merges them into a portfolio total and never silently changes
the selected network.

Amount formatting and parsing use exact decimal string operations. Floating
point, `Number(balance)`, exponent notation, malformed decimals, negative
amounts, excessive decimal places, and unsafe numeric conversion are
rejected.

The Phase 3.2 token identity is:

```text
assetType = fungible_token
networkId = <network registry ID>
contractAddress = <checksum-normalized EVM address>
```

Token names and symbols are untrusted display metadata, not identity or
verification claims. The read engine validates configured network state and
contract code before metadata reads, and returns a normalized not-a-contract
error for EOAs. It uses only the existing provider's `eth_chainId`,
`eth_getCode`, and `eth_call` methods. Contract calldata is generated from a
small viem ABI containing only `name`, `symbol`, `decimals`, and
`balanceOf(address)`. No transfer, approval, allowance, `transferFrom`,
permit, signing, or broadcast method is available through this boundary.

Metadata is operation-scoped, not persisted or refreshed in the background.
Untrusted strings have bounded lengths and control-character validation.
Metadata results explicitly report complete, partial, unavailable, or invalid
states. Decimals are contract-returned metadata and must be within the
established 0–36 policy; invalid or missing values are never defaulted to 18.
Token balances remain exact `bigint` values and include the account,
network/chain, and contract identity. Network changes and chain mismatches
fail closed.

### Phase 3.3 discovery controls

`TokenDiscoveryService` is a read-only candidate engine. User-added and
discovered candidates are validated through the same network, contract-code,
address, and bounded metadata controls as Phase 3.2. A candidate's provenance,
visibility, discovery state, metadata status, verification status, and account
observation are separate data. A user-added or discovered token is never
treated as verified or trusted merely because it was requested or observed.

Event discovery requires an explicit account and explicit finite block range.
The service uses only the standard ERC-20 `Transfer` event topic, narrows each
query to the account's indexed `from` or `to` topic, caps raw results and
metadata lookups, deduplicates observations, rejects malformed/unrelated logs,
and validates the remote chain before and during the operation. It never scans
from genesis to latest, performs an unlimited scan, follows arbitrary event
signatures, or runs in the background.

The public preference seam stores only token identity, visibility, provenance,
and safe metadata observations. The shipped in-memory adapter is session-only.
SecureStore remains reserved for wallet secrets and is not used for token
metadata. No private key, mnemonic, seed, PIN, vault handle, signing
capability, transaction payload, backend record, external token list, price,
risk score, or verification-provider response enters a discovery candidate.

Token balances remain exact `bigint` values and include the account,
network/chain, and contract identity. No token list, verification provider,
portfolio valuation/fiat service, indexer, backend, or secret-bearing
component is used.

### Phase 3.4 portfolio controls

`PortfolioAggregationService` is a read-only composition layer. It receives
an explicit public account and explicit configured network IDs, then reuses
the existing network-bound native and ERC-20 read services. It does not
switch networks, silently enumerate networks, fail over outside the existing
provider rules, access wallet authentication or vault state, or create a
second discovery engine.

Portfolio asset identity is authoritative asset identity, never a symbol,
name, decimals, logo, or display label. Account and network context remains
attached to every portfolio and asset result. Native assets, registry tokens,
user-added tokens, and discovered tokens are combined only when their
authoritative identity matches; different accounts or networks cannot merge.

Raw blockchain quantities remain exact `bigint` values. Portfolio states keep
metadata availability, balance availability, hidden/visible presentation,
discovery state, provenance, verification, and logo state separate. Hidden
does not mean deleted, zero balance does not mean hidden, and unverified does
not mean removed. Portfolio summaries contain no financial valuation, pricing,
fiat conversion, performance, market-cap, or risk information.

The `AssetIcon`/`TokenLogo` abstraction is metadata only. Its source,
reference, status, provenance, dimensions, and deterministic fallback are
independent from token verification. No external logo URL is fetched, no
token-list SDK is added, and no logo is treated as a safety or legitimacy
claim. Native icons are based only on reviewed network native-currency
metadata; placeholder networks remain unavailable.

Portfolio blockchain access is limited to the existing read-only
`eth_chainId`, `eth_getBalance`, `eth_getCode`, and `eth_call` methods.
`eth_getLogs` remains confined to the bounded Phase 3.3 discovery service.
There is no portfolio persistence of live balances, no SecureStore use for
public portfolio data, no backend dependency, no background refresh, and no
signing, authorization, transaction construction, or broadcasting path.

**Phase 3.4 stops at safe account/network-scoped asset aggregation and logo
architecture. Transfers, approvals, allowances, permits, swaps, NFTs,
portfolio valuation, price feeds, history, DApps, WalletConnect, signing,
broadcasting, background execution, backend indexing, external lists,
verification providers, and risk systems remain deferred.**

### Phase 3.5 portfolio read model

`PortfolioReadModelService` is an application-level transformation over
`PortfolioAggregationService`. It handles public account and asset data only.
It has no access to SecureStore, SecureVault, Keychain/Keystore,
WalletAuthenticator, `LocalWalletEngine` secrets, mnemonics, private keys,
signing, transaction authorization, broadcasting, or native authentication.

The service is read-only and in-memory. It does not use AsyncStorage,
`localStorage`, filesystem persistence, a database, backend services, price
feeds, fiat conversion, analytics, token-list providers, or logo providers.
It does not perform blockchain reads independently; all public balance data
comes from the existing aggregation service.

The read model keeps asset identity, visibility, verification, provenance,
metadata completeness, balance state, availability state, and icon fallback
state separate. It never infers verification from names, symbols, decimals,
balances, discovery, provenance, or logo presence. PrimeWave placeholder
configuration remains unavailable and no production network values are
invented.

### Phase 4.1 WaveX Home UI

The authenticated Home UI consumes only public wallet/account metadata and the
existing `PortfolioReadModelService`:

```text
Wallet unlock
      ↓
WaveX Home
      ↓
PortfolioReadModelService
      ↓
Public asset presentation
```

Home has no access to SecureStore, SecureVault, Keychain/Keystore,
`WalletAuthenticator`, mnemonics, seeds, private keys, PINs, signing
capabilities, transaction authorization secrets, transaction construction, or
broadcasting. It cannot determine token trust and does not infer verification
from logos, names, symbols, discovery, or balances.

### Phase 4.2 WaveX Assets UI

The Assets screen receives only the public account/network context and the
existing `PortfolioReadModelService` result. Home and Assets share the same
read-model source; Assets does not make direct RPC calls or duplicate asset
aggregation.

Search and All/Visible/Hidden filters are local in-memory presentation
operations over `PortfolioAssetViewModel`. Visibility remains independent from
availability, balance, metadata completeness, and verification. A logo,
symbol, name, discovery observation, or balance never becomes verification
evidence.

Assets has no access to SecureStore, SecureVault, Keychain/Keystore,
`WalletAuthenticator`, mnemonics, seeds, private keys, PINs, signing
capabilities, transaction authorization secrets, transaction construction, or
broadcasting. Asset rows are display/navigation only and lead only to a
read-only transaction detail flow.

The Receive UI consumes only the public account address and selected network
metadata. Its QR payload is public-address-only, its clipboard operation writes
only that address, and its share operation contains only the address and
selected network name. The UI never reads, logs, or persists clipboard
contents. Receive has no transaction-signing authority and does not call
transaction construction, signing, broadcasting, camera, or recipient-parsing
services.

Receive, Scan, network selection, and the non-Home destinations remain
controlled where their behavior is not implemented; Receive is the exception
for the read-only address/QR/copy/share flow defined in Phase 4.4. Refresh is
an explicit read-model request only; Home does not persist public balances,
create a second cache, poll in the background, or retry RPC calls
automatically. Unavailable and error states remain visibly distinct from zero
balances, and raw provider details are sanitized before display.

### Phase 4.5 WaveX Send UI boundary

The Send screen is a public-data preparation surface only. It may consume the
selected network, public wallet account metadata, and the existing
`PortfolioReadModel`/`PortfolioAssetViewModel` result. It must not import or
access SecureStore, SecureVault, secret/key managers, mnemonic data, private
keys, wallet-authentication unlock APIs, signing capabilities, transaction
construction, gas estimation, nonce retrieval, broadcasting, or backend
services.

The screen validates EVM recipient syntax locally through the existing
normalization utility and uses exact bigint parsing for asset amounts. A valid
address is not represented as safe, trusted, verified, an EOA, or a contract.
The selected asset must remain bound to the active network through
`AssetIdentity`; a network change clears the recipient, amount, and review
draft rather than carrying ambiguous form state across networks.

Review creates only a public draft with account ID, sender public address,
network ID, selected asset identity, recipient, amount, and an optional token
contract address. No transaction is constructed, no gas or nonce is read, no
signature is produced, and no broadcast or blockchain mutation occurs.
Native MAX represents the current balance only and does not subtract an
uncomputed gas cost. Clipboard paste uses the existing boundary without
clipboard history, persistence, logging, or transmission. Scan remains
deferred and does not request camera permissions.

### Phase 4.6 transaction review boundary

The transaction review screen is a safety checkpoint between public send
preparation and the later secure signing phase. It may consume the Phase 4.5
public send draft, public account and network metadata, selected-network
portfolio balances, read-only Phase 2.4 gas and fee data, and a Phase 2.5
unsigned transaction preview.

Before construction, the review requires the draft network to remain
registered, enabled, configured, and active. The construction engine must
confirm the remote chain ID. Asset identity remains
`assetType + networkId + assetId`, with the ERC-20 contract address treated as
authoritative. Token names, symbols, decimals, provenance, and verification
status remain independent read-model data and never become trust claims.

The review performs exact bigint balance checks. Native transfers must fit
within the maximum native total reported by the construction preview. ERC-20
transfers must fit within the token balance and must also leave enough native
balance for the reported network fee. Fee model, fee currency, gas limit,
estimated fee, and maximum total are shown without floating-point conversion,
hidden padding, fee markup, or automatic fee changes.

The Confirm Transaction action revalidates the public draft and reconstructs
the read-only preview. It rejects stale account, sender, recipient, amount,
asset, network, chain, fee-model, or canonical unsigned-transaction context.
It returns a public `confirmed-for-signing` state only. It does not access
SecureStore, SecureVault, mnemonic material, private keys, PINs, biometric
credentials, signing capabilities, or authentication APIs. It never calls
`eth_sendRawTransaction`, the signing service, or the broadcast service.
Phase 4.7 is responsible for the explicit secure signing authorization
handoff.

### Phase 4.7 secure authorization and signing boundary

The Phase 4.7 execution path starts only after the user explicitly confirms
the Phase 4.6 review. The UI then requests authentication through the existing
wallet access facade: configured biometrics where available, with the existing
PIN path as fallback. No second PIN system, authentication record, or signing
session is created.

After authentication succeeds, the public review context is checked again and
the unsigned transaction is reconstructed for comparison. A changed account,
sender, active network, chain, recipient, amount, asset, nonce, gas limit, fee
field, fee model, or canonical unsigned transaction identity stops the flow
and requires a fresh review. The existing Phase 2.6
`createTransactionSigningAuthorization` and `TransactionSigningEngine` then
perform the transaction-bound authorization and local signing.

The one-time signing capability remains opaque, account-bound, and digest-bound.
`LocalWalletEngine` is the only key-access implementation. Mnemonics, private
keys, derived signing accounts, PINs, biometric responses, and vault handles
never enter React state, navigation parameters, logs, analytics, API
requests, or persistent application storage outside the approved vault.

The public result is limited to signed raw bytes, a local transaction hash, and
public network/account metadata. The UI presents `Transaction Signed` and
`Ready to Broadcast`; it never presents `Sent`, `Broadcasted`, or
`Confirmed on-chain`. Phase 4.7 does not import or invoke
`TransactionBroadcastEngine`, `broadcast()`, `sendRawTransaction()`, or
`eth_sendRawTransaction`.

Preview Test Mode remains fail-closed for authentication and signing. It may
show a clearly labeled inability to sign, but it never creates a fake hash or
claims simulated signing is a real blockchain transaction. Native biometric
behavior requires an iOS or Android development build and is not claimed to be
validated by Expo Web Preview.

Preview Test Mode continues to use only its fixed public development context.
The Send flow does not weaken its isolation from native secure storage,
biometrics, the local wallet secret APIs, signing, broadcasting, and backend
services.

### Phase 4.8 broadcast and confirmation boundary

Phase 4.8 exposes the existing Phase 2.7 broadcast engine only after an
explicit user press on `Broadcast Transaction`. The UI passes the exact
`SignedTransaction` produced by Phase 4.7 to `TransactionBroadcastEngine`; it
does not call RPC directly, duplicate `eth_sendRawTransaction`, reserialize
raw bytes, re-sign, alter transaction fields, or add a retry loop.

Before submission, the UI checks that the active configured network and chain
still match the signed transaction and that the signed sender and transaction
type still match the reviewed unsigned context. Network or account changes
stop the operation before the broadcast engine is called. The engine remains
responsible for raw-byte validation, hash consistency, provider chain checks,
idempotency, concurrency, RPC normalization, and ambiguous send outcomes.

The user sees separate `Broadcasting`, `Broadcasted`, `Confirming`,
`Confirmed`, `Reverted`, `Failed`, and `Unknown` states. Receipt monitoring
uses the existing bounded Phase 2.7 confirmation mechanism. A timeout or
uncertain send is never presented as a definitive failure and never triggers
automatic rebroadcast. Explicit reconciliation uses the existing
transaction-lookup method.

Transaction hashes remain public and may use the existing public clipboard
boundary. Explorer links are generated only from validated configured-network
transaction templates; placeholder or malformed explorer metadata produces no
link. No private key, mnemonic, signing capability, authentication material,
or secret vault content enters broadcast or confirmation state.

The browser Preview Test Mode remains unable to sign, broadcast, or monitor
transactions and does not create fake transaction hashes.

### Phase 5.1 activity and transaction history boundary

Phase 5.1 adds `src/core/activity` as a public, UI-independent activity
boundary. It accepts account metadata, network and chain context, public
transaction fields, existing broadcast results, and existing confirmation
results. It never accepts or accesses mnemonics, private keys, SecureStore
values, PINs, biometric credentials, signing capabilities, or wallet engines.

Every activity record is scoped by account ID, network ID, and exact chain ID.
Repository reads enforce that scope instead of relying on a future Activity
screen to filter records. Local transaction IDs and blockchain hashes remain
distinct identities; a hash-known record is never treated as confirmed merely
because it was signed or broadcast.

The lifecycle service consumes the existing broadcast and confirmation engines
without duplicating them. It preserves ambiguous submission and confirmation
outcomes as `unknown`, never rebroadcasts, and prepares records for explicit
future reconciliation. Provenance distinguishes local wallet creation,
broadcast, confirmation, public blockchain reads, and a future external
indexer without claiming unsupported history.

The Phase 5.1 repository is in-memory/session-only. No AsyncStorage,
localStorage, SecureStore, database, backend, analytics, or cloud persistence
is introduced. The read model is bounded, deterministic, public-only, and
preserves bigint quantities. Preview Test Mode does not create fake production
activity or fake transaction hashes.

### Phase 5.1A presentation-model security boundary

Phase 5.1A derives an asset-first `ActivityPresentationModel` from the existing
public activity records. It does not add a second authoritative transaction
store. The presentation model contains only public fields: scoped identity,
asset metadata, icon fallback metadata, network badge metadata, action,
counterparty address, exact amount presentation, optional fiat display,
timestamp source, provenance, status, and explorer availability.

Asset identity remains network-bound. ERC-20 identity is the network plus
contract address, and native identity is the authoritative native asset for
the selected network. Same-symbol assets are never merged. Icon availability
and verification status are independent; an icon or fallback never implies
trust, safety, or verification.

Network badges use the existing `NetworkRegistry` and deterministic fallback
metadata. Explorer URLs are exposed only for enabled, configured networks
whose chain ID matches the record and whose validated transaction template
produces a valid URL. No external logo, explorer, price, or indexer request is
introduced.

Actions are conservative. Existing transfers map to sent/received, contract
interactions map to `contract_interaction`, and unsupported activity remains
unknown. Swap and approval values are only representable when supplied by a
future explicit trusted interpretation; they are not inferred from logs or
multiple transfers. Fiat remains null without an approved exact data source.

The presentation resolver accepts public records and returns public metadata
only. It has no access to SecureStore, mnemonics, private keys, PINs,
biometrics, signing capabilities, transaction submission, backend history,
analytics, or notification services.

### Phase 5.2 Activity UI boundary

The Activity screen remains a read-only presentation layer. It consumes the
bounded `ActivityReadModelService` and the existing presentation model; it does
not call RPC, query receipts, calculate blockchain quantities, submit
transactions, import signing code, access SecureStore, or make backend or
analytics requests. The UI does not create fake activity, fake fiat values, or
inferred swap classifications.

Activity network filtering is intentionally separate from wallet network
selection. The filter only changes which already-scoped read-model queries are
displayed and never invokes active-network selection. Each query preserves the
current account ID and exact network/chain scope, so switching the display
filter cannot leak another account's records.

The asset icon and network badge are display metadata, not trust signals.
Verification remains independent from icon availability. Full addresses are
retained for accessibility while shortened addresses are used visually. Row
navigation passes only a public activity identity and public context to the
read-only detail screen; no private key, mnemonic, PIN, authentication secret,
or signing capability can be passed through this flow.

Pending, confirmed, reverted, failed, and unknown statuses remain separate.
Unknown is never relabeled as failed, and Sent is not a confirmation claim.
Fiat is omitted when absent, explorer actions are not invented, and valid
explorer availability is only surfaced from configured presentation metadata.
Phase 5.2 did not implement reconciliation; the Phase 5.3 boundary below adds
only the bounded read-only detail flow. Swap detection or execution, price
APIs, external indexing, backend history, notifications, replacement,
speed-up, cancellation, DApps, and WalletConnect remain excluded.

### Phase 5.3 Transaction Details security boundary

Transaction Details is a read-only presentation and reconciliation boundary.
Activity row navigation passes only a public activity identity and
account/network/chain scope. The detail screen re-reads the scoped item
through `ActivityReadModelService`; it does not trust a stale navigation
snapshot and it does not accept or access private keys, mnemonics, PINs,
biometric credentials, SecureStore values, or signing capabilities.

The screen does not import signing flows or call broadcast mutation methods.
Its only network operation is the user-triggered, bounded use of the existing
public transaction lookup and confirmation methods for a known transaction
hash. It never calls `eth_sendRawTransaction`, signs, rebroadcasts, changes
transaction data, replaces a transaction, speeds it up, cancels it, or bumps
fees. There is no background polling loop or automatic retry.

Reconciliation preserves account, network, and exact chain scope. The existing
provider and broadcast engine may refuse reconciliation when the activity
network is not the active configured network; the detail flow does not switch
the active network to make the request work. A pending, not-found, or
inconclusive response does not become a fabricated confirmation. Unknown
remains distinct from failed.

Amounts, fees, gas, nonce, block data, and timestamps are rendered only from
authoritative activity or receipt fields. Bigint quantities are not converted
through floating-point arithmetic. Explorer URLs are surfaced only from
validated configured metadata. Copy actions can write public addresses and
hashes through the existing clipboard boundary but never read or persist
clipboard contents.

External blockchain-read records are displayed with neutral origin wording.
No backend history, external indexer, price API, notification, analytics,
swap, approval execution, DApp, WalletConnect, replacement, speed-up,
cancellation, or fee-bumping boundary was added in Phase 5.3.

### Phase 6.1–6.2 Swap Quote security boundary

Phase 6.1 introduces provider-neutral quote architecture under
`src/core/swaps`; Phase 6.2 adds the current 0x Swap API v2 provider behind
that same boundary. A swap provider receives a public
`SwapQuoteRequest` and is never trusted with wallet secrets or signing
authority. The request contains only account ID, sender public address,
network/chain context, network-scoped asset identities, exact bigint sell
amount, and integer slippage basis points.

Provider responses are untrusted input. `SwapQuoteService` validates provider
identity, network, exact chain, account, asset identities, exact amounts,
slippage, quote timestamps, expiration, route continuity, price-impact state,
fee structures, addresses, calldata, transaction value, and optional gas
limits. Malformed, mismatched, expired, negative, or impossible values are
rejected with sanitized swap-specific errors. No malformed provider field is
silently repaired.

Provider transaction calldata is untrusted input and must be validated before
it can enter the transaction signing flow. Existing transaction construction
remains authoritative for any future execution. A quote is not an approved
transaction, a signed transaction, a broadcast, a confirmation, or a
completed swap.

The 0x provider uses only the documented v2 AllowanceHolder quote endpoint.
Its API key is runtime configuration from `ZEROEX_API_KEY`; it is not a wallet
secret and must not enter SecureStore, mnemonic/key handling, quote models,
analytics, logs, error text, screenshots, or UI state. The provider has a
centralized capability mapping for Ethereum, BNB Smart Chain, Polygon,
Arbitrum One, Base, and Optimism. PrimeWave and any unconfigured or disabled
network are rejected before an external request. Ethereum Sepolia is
intentionally excluded from that map; selecting Sepolia for native wallet
validation must never result in a 0x request or a mainnet quote being reused.

The network registry contains Ethereum Sepolia as a testnet with chain ID
`11155111`, ETH, and Sepolia Etherscan metadata. Its RPC endpoint is supplied
through the `SEPOLIA_RPC_URL` environment secret rather than checked-in
configuration. Missing or invalid RPC configuration leaves Sepolia disabled
and unavailable for activation. The selector keeps this testnet explicit and
does not change the primary network or automatically switch networks.

0x response objects are untrusted. The mapper validates chain context, token
identity, exact decimal-string quantities, taker/from, recipient/to, calldata,
value, gas, fees, route continuity, liquidity, expiration, and reported
issues through the existing WaveX validation boundary. The 0x native-token
sentinel is translated only at the provider edge and never replaces the
network-scoped WaveX native asset identity. Unknown price impact, route,
liquidity, and fee values stay unavailable; no fake zero is created.

The swap module has no SecureStore, mnemonic, seed, private key, PIN,
biometric, authentication, signing, broadcasting, wallet persistence,
backend execution, or provider SDK dependency. Allowance requirements and
Permit2-related concerns are metadata only; this phase does not approve,
execute Permit2, sign EIP-712 data, sign swaps, or broadcast transactions.
It does not execute swaps, mutate balances, create Activity records, add
WaveX fees, refresh quotes automatically, or background-poll. Cross-chain
swaps are rejected.

The quote lifecycle is limited to idle, requesting, quoted, expired, and
failed. Expected and minimum received amounts remain separate, exact bigint
monetary values are never converted through floating point, and network,
protocol, and provider fees remain separate. Unknown price impact is
represented as unavailable rather than fabricated as zero.

### Phase 6.4–6.5 Swap Review and Secure Local Execution security boundary

Phase 6.4 adds `src/core/swaps/review` as a separate provider-neutral layer
above the normalized quote. `SwapReviewService` never consumes raw 0x data and
never imports wallet access, SecureStore, authentication, signing, approval,
Permit2, or broadcast services. Its inputs are public account metadata, the
selected configured network, the existing public `PortfolioReadModel`, the
selected public asset view models, and a normalized `SwapQuote`.

Before creating a review, the service revalidates quote lifecycle and
expiration; account ID, sender address, active network, and chain ID; exact
network-scoped sell/buy asset identities; exact sell amount and slippage;
provider transaction sender, target, value, and bounded hexadecimal calldata;
portfolio account/network/chain scope and freshness; sell balance, including
sell amount plus authoritative native fee for native sells and native fee
retention for token sells; fee asset identity; and blocking provider issues.

Unavailable or stale public balances and required fee data are explicit
blocking states. The service does not silently refresh, rebuild, switch
networks, deduct gas from the entered sell amount, or fabricate missing
values. Allowance requirements are displayed as untrusted metadata and never
become authorization to execute an approval or increase allowance.

Every review is an immutable public snapshot. Its canonical keccak digest
binds account, sender, network, chain, quote/provider identity, both assets,
amounts, slippage, provider transaction fields, route and price impact, fee
context, allowance metadata, and provider issues. `approveReview` performs a
fresh validation and refuses a changed digest, expired quote, changed
transaction context, stale balance, unavailable fee, insufficient balance, or
blocking provider issue. A successful result is only
`approved-for-signing` public context. It contains no signed bytes,
authorization capability, private key, mnemonic, PIN, authentication result,
or secret.

The UI presents this result as **Approved for Signing** and stops. It does not
authenticate, access wallet secrets, call `eth_sendRawTransaction`, create
Activity records, execute token approvals, sign EIP-712 data, sign the swap,
or broadcast. Preview Test Mode uses the same fail-closed public boundary and
cannot create fake successful approvals.

Phase 6.5 adds a second, still UI-independent boundary at
`src/core/swaps/execution`. It consumes only the approved immutable review and
fresh public revalidation input; raw 0x responses and UI fields are not
executable inputs. Immediately before each signing action it checks the
review digest, account, sender, selected network, chain, assets, exact sell
amount, slippage, provider and quote identity/lifecycle/expiry, fee context,
allowance state, and every provider transaction-critical field. Any mismatch
stops the flow and requires a fresh quote and review.

For native sells, no approval is possible. For ERC-20 sells, allowance states
are explicit: sufficient, insufficient, or unavailable. Unavailable allowance
blocks execution. Insufficient allowance creates a separate approval review
only when the normalized review contains a valid provider-supplied spender and
positive required amount bound to the reviewed token and network. The
transaction is standard bounded `approve(spender, requiredAmount)` calldata;
unlimited `MaxUint256` approval, arbitrary UI spenders, token-derived
spenders, safety multipliers, and silent approvals are prohibited.

Approval and swap transactions are independently constructed through the
existing Phase 2.5 engine, independently authorized through the existing
WalletAccessManager and Phase 2.6 local signer, and independently submitted
through the existing Phase 2.7 broadcaster. The swap transaction preserves
the exact normalized provider `to`, `value`, and calldata bytes. No second
signing or broadcast implementation exists. The UI requires explicit
confirmation before approval signing, explicit confirmation before swap
signing, and explicit continuation after approval confirmation.

Approval confirmation must be confirmed before the swap step is available.
Reverted, failed, timeout, and unknown approval states stop the swap. A
broadcast timeout or ambiguous response is `unknown`, never assumed failed and
never automatically rebroadcast. Signing and broadcasting receive no 0x API
key. Phase 6.5 writes no Activity records; it exposes only structured public
results for the separately scoped Phase 6.6 consumer. Preview Test Mode fails
closed before construction and cannot authenticate, sign, broadcast, or
fabricate results.

### Development-only Replit web preview mode

The Replit web preview cannot use native SecureStore, so it fails closed for
the real wallet. To support UI testing without weakening that boundary,
`src/core/development/preview-test-mode.ts` provides a separate simulated
state machine selected only by `__DEV__` plus a browser document.

This mode is not a wallet. It does not import or call the real wallet engine,
SecureVault, SecureStore adapter, authentication manager, biometric provider,
RPC provider, transaction constructor, signer, broadcaster, or backend. It
uses only a fixed public development address and a non-secret fingerprint of
the developer's six-digit test PIN. No mnemonic, seed, private key, recovery
phrase, production PIN verifier, authentication record, or signing capability
is created or persisted.

The preview state is isolated under a development-only browser-local key and
contains only its phase and test PIN fingerprint. It supports onboarding,
PIN setup, lock, unlock, reset, and refresh persistence for UI testing.
Clearing or missing state returns to onboarding, and reset is idempotent.
Native iOS and Android flows remain unchanged and continue to require
platform-secure storage and real device authentication. Preview Test Mode is
not accessible in production builds.

## 15. Error handling

Errors shown to users must not expose private keys, recovery phrases,
cryptographic material, authentication secrets, or secure-storage contents.
Internal errors must be sanitized before logging or passing to error
reporting. The current error boundary uses sanitized error details and does not
display raw stack traces to the user.

Secret material must never be included in application error objects created by
future security implementations.

## 16. Memory handling

Cryptographic secrets should have the shortest practical lifetime in memory.
Future implementations should minimize copies, clear sensitive buffers where
the chosen platform and library allow it, avoid global state, avoid Redux,
Zustand, or persistent UI state for secrets, avoid React state for raw
cryptographic material, and never put secrets in URL parameters.

JavaScript garbage collection does not guarantee secure memory wiping. PrimeWave
Wallet must document this limitation honestly and use platform-native
mechanisms where appropriate.

## 17. Backup and recovery

The recovery phrase is the user's ultimate recovery mechanism. PrimeWave must
not provide server-side recovery for a non-custodial wallet.

The future flow is:

```text
Create wallet
  ↓
Display recovery phrase securely
  ↓
User backs it up offline
  ↓
User verifies backup
  ↓
Encrypted local wallet vault created
```

If the user loses the recovery phrase and access to the wallet, PrimeWave
cannot recover the wallet for them. This limitation must be communicated
clearly before wallet creation is implemented.

## 18. Multiple accounts

The future vault must support multiple EVM accounts without exposing private
keys to UI components:

```text
Vault
  ├─ Account 1
  ├─ Account 2
  ├─ Account 3
  └─ Account N
```

Account addresses may be presented to the UI as sensitive public data.
Derivation and signing material remains encapsulated inside the wallet and
security layers.

## 19. Security testing structure

Phase 0B adds a reviewable test-case plan under
`src/core/security/tests/SECURITY_TEST_CASES.md`. These are not fake passing
tests. A real test runner and concrete implementations must be added before
the corresponding contract tests are marked complete.

## 20. Phase 1A cryptographic implementation

Phase 1A uses the following exact dependencies:

| Package | Version | Purpose and standards |
| --- | --- | --- |
| `expo-crypto` | `~57.0.3` | Platform-provided cryptographically secure random bytes for 128-bit BIP-39 entropy on Expo native and web targets. |
| `@scure/bip39` | `1.6.0` | Audited/minimal BIP-39 English wordlist, entropy-to-mnemonic conversion, and mnemonic checksum validation. |
| `viem` | `2.56.0` | Maintained EVM account layer. `mnemonicToAccount` performs standard BIP-39 seed plus BIP-32/BIP-44-compatible derivation, and `getAddress`/`isAddress` provide EVM address and checksum handling. |

`viem` already depends on the same `@scure/bip32` and `@scure/bip39`
implementations needed for its mnemonic account API, so a separate direct
wallet framework or duplicate direct HD-wallet package is not installed.
`tsx` `4.23.13` is a development-only TypeScript loader for Node's built-in
offline test runner and is not part of the wallet runtime.

These packages were selected because they are maintained, focused on standard
cryptographic primitives/account operations, and do not require RPC,
blockchain, backend, or cloud services for local derivation. The mobile package
was checked with Expo web bundling and TypeScript. The workspace retains its
one-day minimum package release age guard; `viem` `2.56.0` was selected instead
of the newest release because newer releases were outside that guard.

The standard path is:

```text
m/44'/60'/0'/0/<accountIndex>
```

PrimeWave does not have a separate seed or derivation path. The same EVM
account can later be used on any supported EVM network.

## 21. Phase 1B-1 vault and secret handling

Wallet creation obtains 16 bytes from `expo-crypto`, converts that entropy to a
12-word BIP-39 phrase, and immediately clears the temporary entropy buffer on a
best-effort basis. The mnemonic is retained in the engine's in-memory secret
state for derivation and is persisted only through the platform-secure vault.

The public `Wallet`, `WalletAccount`, and `WalletEngine` API exposes no
mnemonic, seed, private key, raw secret buffer, signing capability, or secret
export method. The internal derivation operation creates an EVM account only
long enough to copy its public address and returns safe metadata.

The implementation does not log, transmit, or place secrets in errors, URLs,
query parameters, AsyncStorage, localStorage, Redux, Zustand, or backend
requests. The only persistence path is `expo-secure-store` `57.0.4`, which
stores the protected vault through iOS Keychain and Android Keystore-backed
storage. Logs contain only safe operation metadata such as account index and
derivation path. `LocalWalletEngine.discard()` removes in-memory secret
references, but JavaScript garbage collection is not a guaranteed
cryptographic wipe.

### Platform secure-storage behavior

- **iOS:** SecureStore uses Keychain. The vault uses
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so it is accessible only while the device
  is unlocked and is not migrated to another device through backup restore.
- **Android:** SecureStore uses encrypted shared preferences backed by Android
  Keystore. The iOS accessibility option is ignored on Android.
- **Web:** SecureStore reports unavailable. The wallet fails closed and does not
  fall back to browser storage.
- **Authentication:** `requireAuthentication` is intentionally not enabled in
  Phase 1B-1. PIN, biometric prompts, enrollment changes, lock screens, and
  unlock flows belong to Phase 1B-2.

### Versioned vault format

The current vault version is `1`. The protected value has this shape:

```json
{
  "vaultVersion": 1,
  "wallet": {
    "walletId": "opaque wallet identifier",
    "createdAt": "creation timestamp",
    "accountIndexes": [0, 1]
  },
  "secret": {
    "mnemonic": "protected by the platform secure-storage boundary"
  }
}
```

The JSON is not treated as an application-level encryption primitive. The
entire value is handed to SecureStore, which provides the native protected
storage boundary. The parser rejects malformed data, invalid BIP-39 phrases,
duplicate or unsafe account indexes, and unsupported versions with sanitized
errors. Future migrations must be explicit and versioned; unknown versions are
never guessed or silently downgraded.

The engine creates a new opaque vault handle for saves and consumes it inside
the security boundary. Retrieval returns an opaque handle rather than raw
secret material through the public engine model. No public API provides
`getMnemonic`, `getPrivateKey`, `exportPrivateKey`, or equivalent access.

## 22. Phase 1B-1 verification and limitations

Offline tests cover:

- Known BIP-39 mnemonic validation and rejection.
- Known EVM addresses for account indexes 0, 1, and 2.
- Repeated deterministic derivation.
- Invalid account indexes.
- Valid, invalid-checksum, and malformed EVM addresses.
- Absence of mnemonic/private-key fields from public metadata.
- Wallet creation, account-index persistence, and restoration in a fresh
  engine instance.
- Missing vault handling, malformed JSON, invalid secret material, unsupported
  versions, unavailable storage, and deletion.

Phase 1B-1 is not a full security audit and does not implement authentication,
PINs, biometrics, locking, recovery UI, transaction signing, RPC,
broadcasting, cloud backup, or backend recovery. JavaScript memory clearing is
best-effort and platform storage behavior must still be tested on real iOS and
Android devices.

## 23. Dependency and backend rules

No custom cryptography, encryption, mnemonic generation, or elliptic-curve
logic is allowed. Dependency changes require the same review for maintenance,
platform compatibility, transitive duplication, unexpected network behavior,
and unnecessary permissions.

No backend endpoints are created for mnemonic, seed, privateKey, signingKey,
walletPassword, walletPin, or encryptionKey fields. The current backend
remains unchanged.

## Phase 7.5 transaction security boundary

`eth_sendTransaction` is normalized at the WalletConnect/Reown adapter edge.
The DApp supplies public intent only; it never supplies a raw signed
transaction, private key, signer, PIN, mnemonic, SecureStore value, or
broadcast handle. Provider request IDs are single-use in the transport
instance, and a pending duplicate is rejected.

The exact `from` address must match the approved session account and current
wallet account. The chain must be approved by the session and be registered,
enabled, configured, and non-placeholder. Network switching is not performed.
`to`, value, calldata, nonce, gas, and fee fields are validated without
repair. Legacy and EIP-1559 fee models cannot be mixed.

Review binding includes the request and session IDs, DApp identity, account,
sender, network, recipient, value, calldata, nonce, gas limit, fee model and
values, transaction type, and canonical unsigned transaction. Rebuilding a
different transaction, changing the balance, or changing the wallet context
invalidates the flow. Authentication and the existing one-shot signing
capability remain mandatory.

The existing broadcast engine receives the exact signed bytes. Its
deduplication and unknown-result behavior remain authoritative; no automatic
rebroadcast occurs. Activity begins only after an actual broadcast result and
confirmation updates the resulting lifecycle record. Preview mode cannot
fabricate a DApp request, signature, hash, broadcast, or Activity record.

## Phase 7.6 session and request hardening

Connected DApp sessions are managed through the provider adapter, not by
directly mutating provider SDK state from the UI. The Active DApps screen
displays public metadata, approved account/network scope, expiry, and
capabilities, but metadata is explicitly unverified. Session listing is
account-scoped and never exposes provider sessions for another wallet account.

The request lifecycle is bounded and fail-closed. A request can move through
review, authentication, signing, and broadcasting only through explicit
transitions; terminal requests cannot be replayed. Duplicate request IDs,
duplicate responses, invalid response payloads, stale account/network context,
provider expiry, session deletion, user disconnect, revocation, and transport
shutdown are handled as distinct controlled outcomes.

Disconnect and revocation invalidate all associated pending requests before
future signing or transaction responses can be delivered. Account or network
changes mark open requests stale rather than rebinding them. The adapter and
provider-neutral DApp core still receive no PIN, SecureStore value, mnemonic,
private key, raw signer, signing handle, or direct broadcast access.

## Phase 8.1 backend foundation and security boundary

The backend is an information and support service only. It is not a wallet,
custody service, recovery service, signer, broadcaster, or transaction
execution service. The mobile wallet must remain functional without the
backend wherever its existing local boundaries permit.

The only enabled API capabilities are versioned infrastructure endpoints:

- `GET /api/v1/healthz`
- `GET /api/v1/readyz`
- `GET /api/v1/version`

The existing `/api/healthz` path remains only for the managed workflow startup
probe. There are no wallet-secret, signing, custody, transfer, or transaction
execution endpoints.

### Backend data classification

The backend may later receive minimized public wallet addresses, public account
metadata, public network context, token metadata requests, public indexing
queries, notification preferences, and privacy-safe product telemetry. These
categories remain untrusted and must be validated at the API boundary.

The backend must never accept, persist, log, cache, transmit, index, or recover
seed phrases, mnemonics, private keys, raw signing keys, wallet PINs or PIN
hashes, secure-storage/vault contents, wallet encryption keys, biometric
secrets, signing capabilities, vault handles, or raw recovery material. It has
no DTO, database column, cache field, or event schema for them. Secret-shaped
fields are rejected explicitly before any future persistence boundary.

### Backend trust boundaries

```text
Mobile wallet
  ├─ local creation, recovery, derivation, authentication, and signing
  └─ public/minimized request data only
       ↓
WaveX API
  ├─ request IDs, headers, CORS, size limits, rate limits
  ├─ schema validation and prohibited-secret guard
  ├─ future authentication/session boundary
  ├─ sanitized errors and centralized redacted logging
  └─ future public-data services
       ↓
PostgreSQL/Drizzle foundation
  └─ public metadata and read-only observation tables only
```

Backend authentication, when added later, will identify a user or application.
It does not prove ownership of a blockchain address and never authorizes local
wallet signing. Wallet ownership, public-address ownership, and transaction
signing authorization remain distinct boundaries.

Configuration is environment-only. Database credentials and other server
secrets are not exposed to Expo public configuration or health responses.
CORS production origins must be explicit; wildcard credentialed traffic is not
allowed. Production deployment and later non-metadata Phase 8 services remain
deferred.

## Phase 8.2 public metadata boundary

Phase 8.2 adds only read-only public metadata. The backend does not become a
wallet, signer, custody layer, broadcaster, blockchain indexer, price service,
transaction service, swap service, or DApp execution service.

### Public metadata identity and state

ERC-20 token identity is always:

```text
networkId + lowercase canonical EVM contractAddress
```

The API validates both components and bounds batch reads to 50 addresses.
Database uniqueness is enforced on the same composite identity. Token names,
symbols, decimals, logos, balances, popularity, and activity are not identity.

The token model keeps these independent:

- metadata status
- provenance
- verification status
- discovery status
- visibility
- trust status
- freshness status

Metadata availability, registry provenance, or a logo never implies
verification or trust. Missing metadata is represented as `unavailable`, and
partial metadata remains `partial`; the service does not invent display values.

### Network and logo safety

Network metadata is derived from the existing public registry concepts. The
PrimeWave entry remains a placeholder with null chain and endpoint values.
Metadata responses omit RPC URLs entirely, including server-only Sepolia
configuration. Explorer references are restricted to bounded HTTP(S) values
without credentials, query strings, or fragments.

Logo metadata is a bounded reference plus independent provenance. The server
does not accept a client URL for server-side fetching, does not implement a
remote image proxy, and does not download arbitrary remote images.

### Database and failure boundary

The only Phase 8.2 tables are `public_network_metadata` and
`public_token_metadata`. Their columns contain public metadata only; there are
no secret-bearing columns, account secrets, PINs, vault material, signing
capabilities, or recovery material. Text fields and numeric ranges are bounded
in the schema, and token identity has a composite unique index.

Metadata reads are rate-limited and validated. Database failures do not make
the mobile wallet dependent on the backend: network reads use the safe public
catalog and token reads return explicit `unavailable` records. No unrestricted
pagination, arbitrary SQL, dynamic SQL, or client-controlled remote fetch path
was added.

## Phase 8.3 read-only indexing boundary

Phase 8.3 adds public-chain observation only. The indexer has no signing,
broadcasting, custody, wallet control, DApp signing, approval execution, swap
execution, seed phrase access, private-key access, or transaction mutation
capability.

### RPC boundary

The server-side RPC client has an explicit allowlist containing only the read
methods required by the observer: chain ID, block number, block reads, log
reads, transaction receipt reads, and other bounded read methods reserved for
future observation. It has no `eth_sendRawTransaction` method and is not
exposed as an arbitrary RPC proxy.

RPC endpoints are resolved from server environment configuration. They are
validated for HTTPS outside local development, reject credentials, query
strings, and fragments, and never enter API responses or database rows. Before
any configured network is indexed, the remote chain ID must equal the
configured chain ID. Mismatches fail explicitly.

### Bounded observation and normalization

Manual indexing requires a bounded block range. Provider responses are bounded
by block range, log count, transaction count per block, calldata/data size,
topic count, and persisted error length. There is no unbounded historical scan
and no infinite worker loop.

Blocks, transactions, logs, hashes, addresses, quantities, topics, and
calldata are normalized and validated before persistence. Integer amounts remain
exact; JavaScript floating point and fiat inference are prohibited.

Recognized ERC-20 Transfer logs are normalized as public evidence using the
existing `networkId + canonical contractAddress` identity. Transfer events do
not imply token legitimacy, trust, verification, or metadata availability.

### Reorg and idempotency boundary

Block number, block hash, parent hash, and timestamp are retained. The observer
checks parent continuity within the requested range, against stored parent
evidence, and against the remote previous block. A mismatch records bounded
`reorg_detected` state and leaves the successful cursor unchanged. Deep reorg
reconciliation is explicitly deferred.

Database uniqueness covers network plus block number, network plus transaction
hash, and network plus transaction hash plus log index. Conflict-safe inserts
make retries idempotent; the cursor is advanced only in the same persistence
transaction as the successfully normalized range.

### Public API and mobile boundary

The only public indexer endpoint is sanitized read-only status. It reveals
network identity, configured/disabled state, cursor progress, status, and
bounded error codes/messages. It does not expose provider URLs, credentials,
raw RPC responses, database details, or a start-indexing command.

The mobile wallet does not consume indexed data in Phase 8.3. Activity
synchronization, mobile Activity UI changes, notifications, pricing, analytics,
and future transaction reconciliation remain separate phases.

## Phase 8.4 synchronization and reconciliation boundary

Phase 8.4 consumes only public rows already persisted by the read-only Phase
8.3 indexer. It cannot sign, broadcast, construct, authorize, recover, or
custody a transaction. The backend has no access to SecureStore, wallet
vaults, mnemonic material, private keys, PINs, signing capabilities, or raw
signed transactions.

The synchronization scope is the exact tuple
`networkId + chainId + canonical public account address`. Account and network
filters are applied together; a public address on one network or chain cannot
read another scope. Every requested block range and page is bounded. The
checkpoint operation requires indexed block coverage and never calls RPC.
Existing request-body limits, secret-material rejection, rate limiting, and
sanitized errors remain in the request path.

The backend stores only an account cursor and derived reconciliation metadata.
It does not copy full indexed transactions or token metadata into a second
Activity store. Transaction identity is `networkId + transactionHash`;
ERC-20 Transfer identity adds `logIndex`. Hash equality is the only
authoritative merge evidence. Amount, time, recipient, asset, and counterparty
cannot silently merge records. `conflict`, `unresolved`, and `unknown` are
preserved rather than mapped to `failed`.

The provider-neutral local context contract contains only a public scope, local
Activity ID, optional public transaction hash, and local lifecycle state.
Local intent and authorization remain wallet-owned, while indexed block,
receipt, hash, and timestamp fields remain backend evidence. A future
authenticated deletion flow may remove application-owned cursor and
reconciliation metadata; it must not pretend to delete public blockchain
facts. This phase adds no wallet authentication or public-address ownership
claim and no mobile Activity synchronization UI.

## Phase 8.5 market-data security boundary

Phase 8.5 is a separate public valuation service. It accepts only bounded
asset descriptors and an explicit quote currency. It does not accept wallet
addresses as ownership claims, wallet secrets, provider credentials, raw
signed transactions, RPC methods, arbitrary URLs, or arbitrary SQL.

Market identity remains network-aware:

```text
native: networkId + native
ERC-20: networkId + canonical lowercase contractAddress
```

Provider asset IDs are mapping metadata and cannot replace WaveX identity.
Symbols, names, tickers, prices, logos, and provider IDs cannot establish
token verification, trust, legitimacy, balance, ownership, approval state, or
transaction confirmation.

Provider data is untrusted. The service rejects negative, malformed,
over-precise, `NaN`, and `Infinity` prices, unsupported quote currencies,
malformed asset identities, and impossible timestamps. Exact decimal strings
are preserved without JavaScript floating-point arithmetic. Responses
distinguish `available`, `unavailable`, and `invalid`, and separately
distinguish `fresh`, `stale`, and `unknown`. Unavailable values remain `null`,
never zero.

Provider calls are bounded by asset count and batch size, inherit the existing
rate limiter, and do not retry indefinitely or proxy arbitrary external URLs.
Provider timeouts, rate limits, unavailable configuration, and malformed
responses are normalized into safe response states. Raw provider payloads,
credentials, URLs, and log fields never reach clients, mobile configuration,
database rows, or logs. The current runtime has no approved market provider;
the unconfigured provider returns explicit unavailable data, while the
deterministic mock exists only for tests.

Phase 8.5 adds no persistence, cache, background polling, historical pricing,
portfolio fiat valuation, Activity fiat valuation, signing, broadcasting,
custody, authentication, or mobile market-data integration. Market data never
becomes blockchain truth.

## Phase 8.6 notification security boundary

Notifications are output-only application data. The notification layer cannot
access or transport seed phrases, mnemonics, private keys, PINs or PIN hashes,
SecureStore/vault contents, encryption keys, signing capabilities, raw signed
transactions, authentication credentials, provider keys, or database
credentials. Complete blockchain transaction objects and raw calldata are
also outside notification records.

Registration, preferences, events, and deliveries are scoped to the explicit
`networkId + chainId + accountAddress` tuple. Device identity never implies
wallet ownership, authenticated application identity, or transaction-signing
authorization. All notification API requests retain the existing request ID,
validation, body-limit, rate-limit, secret-material rejection, and sanitized
error pipeline.

Push tokens are sensitive infrastructure identifiers. They are accepted only
for registration, stored only where delivery requires them, never returned by
ordinary GET responses, never logged or included in analytics/payloads/errors,
and never selected by another account scope. Provider errors are normalized to
bounded categories without echoing provider responses or token values.

The event model retains minimum public data and uses deterministic scoped
deduplication. Delivery states distinguish pending, sending, sent, delivered,
failed, disabled, and expired. Transient failures have bounded attempts and
backoff; invalid tokens, disabled registrations, malformed requests, and
missing provider configuration do not retry indefinitely. Unconfigured
providers fail explicitly, while deterministic mock delivery is test-only.

No production push SDK, native notification permission, mobile notification
surface, arbitrary messaging endpoint, worker deployment, analytics, campaign,
price-alert, or speculative security-alert behavior is included in Phase 8.6.