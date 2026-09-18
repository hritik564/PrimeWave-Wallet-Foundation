# PrimeWave Wallet Architecture

## Product purpose

PrimeWave Wallet will be a mobile-first, strictly non-custodial, multi-chain
EVM wallet for the PrimeWave ecosystem. PrimeWave Chain is the future primary
network, with support planned for additional EVM-compatible networks.

## High-level architecture

The mobile application is designed to remain independently useful from any
future PrimeWave backend. The current codebase is frontend-only and keeps
future domain modules separated from the UI.

```text
Expo Router app
  ├─ screens and reusable components
  ├─ centralized PrimeWave design tokens
  ├─ client configuration
   └─ domain cores
        ├─ local wallet core
        │    └─ secure vault
       ├─ security
       ├─ blockchain
       ├─ networks
       ├─ tokens
       ├─ transactions
       ├─ portfolio
       ├─ swap
       └─ dapp
```

## Mobile application layers

- **App and navigation:** Expo Router route composition.
- **Presentation:** screens and reusable components that consume centralized
  theme tokens.
- **Configuration:** environment and network metadata with reviewed,
  unconfigured production placeholders.
- **Domain core:** the Phase 1B-1 local wallet core plus typed interfaces for
  security, blockchain, network, token, transaction, portfolio, swap, and DApp
  behavior.
- **Services:** reserved for client-side adapters; the wallet core requires no
  backend or RPC service.

## Local wallet core

Phase 1B-1 extends the Phase 1A `LocalWalletEngine` behind the `WalletEngine`
boundary in `src/core/wallet/contracts.ts`. It generates a 12-word BIP-39
recovery phrase from 128 bits of Expo platform entropy, derives standard EVM
accounts at `m/44'/60'/0'/0/<index>`, and exposes only wallet metadata and
public account data.

The cryptographic layer is intentionally separated from UI-facing models:

```text
WalletEngine
  ├─ LocalWalletEngine
   │    ├─ Expo Crypto entropy source
   │    ├─ @scure/bip39 mnemonic operations
   │    ├─ viem's @scure/bip32 HD account derivation
   │    ├─ viem EVM account and address operations
   │    └─ SecureVault
   │         └─ expo-secure-store
  └─ public Wallet / WalletAccount models
```

Mnemonic, seed, HD root, and derived private-key material remain inside the
wallet-core module and its in-memory engine state. The public models contain
only wallet identifiers, timestamps, account indexes, addresses, and paths.

Phase 1A supports multiple accounts from one HD wallet. Account indexes are
derived along the final path component and do not create separate network or
seed systems.

### Wallet core and secure storage

Phase 1B-1 connects the wallet core to a versioned `SecureVault`. The vault
stores the minimum recovery material and public restoration metadata through
`expo-secure-store`, which uses iOS Keychain and Android Keystore-backed
storage. It never uses AsyncStorage, localStorage, plain files, SQLite,
Redux/Zustand persistence, or cloud backup for secrets.

The vault payload is versioned and validated before restoration. The
`LocalWalletEngine.discard()` method clears in-memory references on a
best-effort basis. JavaScript garbage collection is not a guaranteed secure
memory wipe.

## Trust boundaries

The UI will communicate with `WalletEngine`, which coordinates the local
cryptographic implementation and vault lifecycle. Private keys, recovery
phrases, secure storage, and signing libraries remain behind that boundary.
Phase 1B-1 returns only public metadata; it does not expose a recovery phrase
or private key to UI components.

```text
UI
  ↓ safe WalletEngine methods
WalletEngine
  ↓ internal opaque vault handle
SecureVault
  ↓ protected key-value operation
Platform secure storage
```

## Future blockchain engine

The blockchain engine will use the generic `EvmNetwork` abstraction rather than
hard-coding one chain. RPC, explorer, chain ID, and currency values are
environment-specific and must be supplied through reviewed configuration.

## Future backend

No authentication, database, indexer, price aggregation, notifications, or
custody services are created in Phase 0A. Any future backend must preserve the
mobile app's independent operation and the non-custodial security boundary.

## Security boundary

Signing material stays on the user's device. The backend must never receive
seed phrases, mnemonics, private keys, raw signing keys, passwords, PINs,
biometric secrets, decrypted vaults, or encryption keys. Transaction signing
also requires an explicit user confirmation after a human-readable preview.
See `SECURITY_ARCHITECTURE.md`.

## Network abstraction

Phase 2 begins with a metadata-only `EvmNetwork` definition and
`NetworkRegistry` in `src/core/networks`. Each definition has a stable ID,
display name, chain ID, native currency, ordered public RPC endpoint metadata,
block explorer metadata, environment, enabled state, and primary-network
designation.

The default registry includes PrimeWave Chain, Ethereum, BNB Smart Chain,
Polygon, Arbitrum, Base, and Optimism. PrimeWave Chain is the single intended
primary network, but its launch chain ID, RPC endpoints, explorer URLs, and
native currency symbol remain explicit placeholders until supplied and
reviewed. No API keys, credentials, or private configuration belong in network
definitions.

The registry validates IDs, chain IDs, URL safety, native currency metadata,
duplicate IDs and chain IDs, primary-network rules, and environment
combinations. Active-network selection is explicit by stable network ID and
does not accept automatic switching requests from DApps or other untrusted
callers. The ordered endpoint list is a future seam for health checks and
failover; this increment performs no RPC calls.

The WAVEX Home and Assets surfaces consume the same registry instance. The
network selector displays the registry's complete public list, including
disabled and intentionally unconfigured entries, but only calls
`selectActiveNetwork` for a requested activation. A placeholder or disabled
entry remains visible as a controlled state and cannot become the active
blockchain context.

The public account panel is limited to account label/index, public address,
unlocked status, and lock. Copying is an explicit one-way write to the
platform clipboard; the UI never reads clipboard contents and never exposes
mnemonics, private keys, PINs, secure-vault data, or signing capabilities.

On a successful configured-network selection, the shared portfolio
read-model query changes with the account/network identity. Home and Assets
therefore reload from the same source of truth, while the loading boundary
prevents a prior network's balances from being presented as the new network's
data.

## RPC provider engine

Phase 2.2 adds the typed provider engine in `src/core/blockchain/rpc`. It is
constructed from the explicitly selected active registry network, chooses the
lowest numeric priority among enabled endpoints, and refuses unconfigured
networks such as the PrimeWave Chain placeholder. It does not silently switch
networks or fail over to another endpoint after a request failure.

The provider sends JSON-RPC 2.0 requests through an injectable transport, with
typed support for the foundation EVM method set. Every request has a bounded
timeout, generated request ID, response ID check, result/error exclusivity
check, and method-specific result validation. Initialization verifies
`eth_chainId` against the registry before ordinary requests are allowed.

Transport failures, timeouts, HTTP failures, malformed responses, invalid
responses, JSON-RPC errors, unsupported methods, endpoint failures, and chain
ID mismatches normalize to safe `RpcProviderError` codes. Logs contain only
network ID, chain ID, endpoint ID, method, and error category. The RPC layer
has no dependency on wallet keys, recovery phrases, PINs, biometric secrets,
secure-vault state, or signing material.

## Account and chain state

Phase 2.3 adds the read-only `EvmAccountStateService` in
`src/core/blockchain/account-state`. The service accepts the existing
`NetworkRegistry` and an initialized `EvmRpcProvider`, validates and
checksums public EVM addresses, and retrieves only public chain state.

Native balances, nonces, block numbers, timestamps, and chain IDs remain
lossless `bigint` values internally. A decimal string formatter is used for
display values without floating-point conversion. Contract-code inspection is
represented as either code-present or no-code observation; no-code does not
claim address ownership.

Snapshots capture the network ID, verified chain ID, address, native balance,
nonce, code observation, latest block context, and retrieval timestamp. Snapshot
reads use one captured block number for account queries where practical and
reject results if the registry's active network changes during the operation.
Snapshots are not persisted or cached, and the service has no dependency on
wallet secrets, SecureStore, authentication, or UI components.

## Unsigned transaction construction

Phase 2.5 adds the UI-independent construction engine in
`src/core/transactions/construction`. It receives a `TransactionIntent`, a
configured active-network context, and public wallet-account metadata only.
It never receives or imports private keys, recovery phrases, vault handles,
PINs, biometric secrets, signing capabilities, or SecureStore.

The construction lifecycle is:

```text
TransactionIntent
  ↓
Validation and normalization
  ↓
Known local public-account validation
  ↓
Network and RPC chain validation
  ↓
Nonce retrieval or explicit nonce
  ↓
Gas estimation or explicit gas limit
  ↓
Legacy/EIP-1559 fee selection
  ↓
UnsignedTransaction
  ↓
TransactionPreview
```

Native transfers require a recipient and use empty calldata. Generic contract
calls accept opaque hexadecimal calldata without ABI decoding or safety claims.
Contract-creation transactions are not introduced in this phase.

The engine uses the existing `EvmAccountStateService` for nonce reads, the
existing `EvmRpcProvider` for public reads, and the existing `GasFeeEngine` for
gas estimation and fee data. It does not duplicate RPC or fee logic. Explicit
gas limits and nonces are validated and used exactly as supplied; omitted
values are read or estimated without local counters, persistence, padding, or
automatic multipliers.

Every construction is bound to the active configured network. The engine
captures network identity, verifies the RPC chain ID through the reused
services, checks the active network after asynchronous operations, and rejects
`NETWORK_CHANGED` rather than rebuilding against a new network. The
transaction chain ID comes only from the validated registry context.

The returned transaction is unsigned and deterministic. Addresses and calldata
are normalized, fee models are explicit, quantities remain `bigint`, and the
canonical test/debug representation uses decimal strings for quantities. The
preview exposes native value, maximum estimated network fee, maximum total
native amount, fee fields, nonce, gas limit, warnings, and the unsigned
envelope. It is read-only.

**Phase 2.5 constructs unsigned transactions only. Signing and broadcasting
are intentionally deferred.**

## Local transaction signing

Phase 2.6 adds `src/core/transactions/signing` as a local-only controlled
transaction layer. It accepts only the validated unsigned transaction model
from Phase 2.5 and a transaction-specific authorization. The authorization
binds the account, sender, network, chain, transaction type, nonce, gas,
value, recipient, calldata, fee model, fee fields, and the canonical
transaction digest.

The signing lifecycle is:

```text
UnsignedTransaction
  ↓
Transaction-specific explicit authorization
  ↓
Existing WalletAuthenticator unlocked-state check
  ↓
One-time opaque signing capability
  ↓
LocalWalletEngine HD-account derivation
  ↓
viem Legacy/EIP-1559 signing
  ↓
Local signed raw transaction + local hash
  ↓
Temporary signing references released
  ↓
STOP
```

The signing engine verifies the active network and chain before signing and
again after the local operation. It rejects stale network context rather than
switching or retrying. It tracks in-flight account IDs and rejects concurrent
signing attempts for the same account.

The existing `viem` dependency is reused for standard EVM transaction
serialization and signing. No cryptographic primitives, RLP, or secp256k1
implementation is added. The mnemonic and derived account remain inside the
local wallet/security boundary; public signing results contain no secret
material. No RPC, backend, analytics, or broadcast call is made.

JavaScript/TypeScript garbage collection does not provide guaranteed
cryptographic zeroization. Phase 2.6 releases temporary derived-account
references and avoids caches, persistence, logs, and public secret-returning
APIs. Stronger native cryptographic isolation remains a future hardening item.

**Phase 2.6 performs local transaction signing only. Broadcasting is
intentionally deferred to Phase 2.7.**

## Transaction broadcasting and confirmation

Phase 2.7 adds `src/core/transactions/broadcast` as a UI-independent execution
layer. It accepts only the public `SignedTransaction` model produced by
Phase 2.6. It cannot access the wallet engine, secure vault, signing
capability, authentication state, mnemonic, or private key.

The execution lifecycle is:

```text
SignedTransaction
  ↓
Validate raw bytes, local hash, signed chain ID, and network metadata
  ↓
Verify selected configured network and remote RPC chain ID
  ↓
eth_sendRawTransaction with exact raw bytes
  ↓
BroadcastResult
  ├─ broadcasted
  └─ unknown on an ambiguous send timeout/transport failure
       ↓
Explicit bounded confirmation polling
  ↓
ConfirmationResult
  ├─ confirmed
  ├─ reverted
  └─ unknown
```

The broadcaster reuses `EvmRpcProvider` for sending, receipt polling, and
read-only transaction lookup. It performs no transaction construction,
reserialization, signing, backend communication, analytics, endpoint
failover, automatic retry, replacement, speed-up, cancellation, or fee
bumping.

The signed transaction hash is the in-memory idempotency key. Concurrent
broadcast calls reuse the same operation, and completed or ambiguous results
are not automatically submitted again. An RPC timeout after the send attempt
is represented as `unknown`, because the endpoint may have accepted the
transaction even if the response was lost.

Receipt polling is explicitly invoked and bounded by configurable interval and
timeout values. Null receipts remain pending until the bound is reached.
Receipt status `0x1` becomes `confirmed`; status `0x0` becomes `reverted`.
Receipt quantities are parsed as `bigint`. Confirmation and lookup use the
original provider/network context even if the user changes the active network.

**Phase 2.7 broadcasts already-signed transactions and observes blockchain
confirmation. It does not construct or sign transactions.**

## Asset abstraction, native balance, and ERC-20 read engine

Phases 3.1 and 3.2 provide `src/core/assets` as a UI-independent,
network-scoped asset layer. It establishes architectural asset types for
`native`, `fungible_token`, and `nft`; native EVM assets and a generic,
read-only ERC-20 engine are functional. NFTs and token state-changing
operations remain outside this boundary.

Native identity is never based on a symbol or name. Its stable identity is:

```text
assetType = native
networkId = <network registry ID>
assetId = native
```

`AssetRegistry` derives native metadata from the existing `NetworkRegistry`.
Configured networks resolve to deterministic native assets; unknown, disabled,
and placeholder networks remain unavailable. PrimeWave Chain remains
unconfigured and no native metadata is invented for it.

`NativeAssetBalanceService` requires an explicit network ID, account ID, and
public address. It delegates to explicitly network-bound
`EvmAccountStateService` instances, which reuse the existing RPC provider and
native balance implementation. It does not switch networks, merge balances,
cache observations, poll in the background, or create portfolio totals.

Native amounts remain exact `bigint` values. `formatAssetAmount` and
`parseAssetAmount` use decimal string arithmetic only: no floating point,
exponent notation, unsafe numeric conversion, or implicit 18-decimal
assumption. The returned balance contains network/chain context, account
identity, checksum-normalized address, raw amount, exact display string, and
retrieval timestamp.

### ERC-20 token read engine

The Phase 3.2 token identity is deliberately contract-based and network-scoped:

```text
assetType = fungible_token
networkId = <network registry ID>
contractAddress = <checksum-normalized EVM address>
```

`symbol`, `name`, and other metadata are never identity keys. The token registry
normalizes addresses, keeps equal contract addresses on different networks
distinct, and rejects duplicate registered identities. Arbitrary contract
metadata is not treated as verified; the default verification state is
`unknown`.

`ERC20TokenService` accepts explicitly network-bound account-state and RPC
services. It first verifies the configured network and contract code through
the existing `EvmAccountStateService`. No-code observations are normalized to
`TOKEN_NOT_A_CONTRACT`. The only contract calls encoded by the service are:
`name()`, `symbol()`, `decimals()`, and `balanceOf(address)`, using the
existing `viem` ABI primitives and `EvmRpcProvider`.

Metadata reads are operation-scoped and concurrent, with no persistent cache or
background refresh. Returned metadata distinguishes `complete`, `partial`,
`unavailable`, and `invalid` states. Names and symbols are untrusted strings
with bounded lengths and control-character rejection; legacy `bytes32` text is
decoded when valid. Decimals remain explicit metadata and must be an integer
from 0 through 36. Missing or invalid decimals are never replaced by 18.

Token balances remain raw `bigint` values and use the shared exact decimal
formatter with the token's validated decimals. Each balance includes account
ID, checksum-normalized public address, network ID, chain ID, token contract,
metadata status, and retrieval context. The service never merges accounts or
networks, persists observations, signs, broadcasts, or accesses wallet secrets.
Network changes and remote chain mismatches fail closed.

**Phase 3.2 implements generic read-only ERC-20 identity, metadata, and balance
retrieval only. Transfers, approvals, allowances, `transferFrom`, permits,
discovery, verification providers, NFTs, portfolio/fiat data, history, DApps,
and backend APIs are intentionally deferred from that engine.**

### Phase 3.3 token discovery and user-added candidates

Phase 3.3 adds `TokenDiscoveryService` above the Phase 3.2 token read engine.
It reuses the existing `EvmRpcProvider`, `EvmAccountStateService`,
`AssetRegistry`, `TokenRegistry`, and viem ABI/log utilities. It does not add a
UI, backend indexer, external token list, verification provider, or trust/risk
system.

The canonical token identity remains `assetType + networkId +
checksum-normalized contractAddress`. A candidate's provenance, discovery
state, visibility, metadata validity, verification state, and trust meaning
are separate. Functional provenance is `user_added` or `discovered`; registry
and external-source values remain reserved. Repeated user-added and discovered
observations merge into one registry identity. Account scope belongs to
discovery observations, not to the token identity, so one contract may be
observed for several accounts while remaining one network-bound token.

User-added and known-candidate discovery first validate network context,
contract code, address normalization, and Phase 3.2 metadata. The bounded event
path requires explicit block bounds and account identity, then performs only
incoming/outgoing `Transfer(address,address,uint256)` log queries. It limits
block span, raw results, unique contracts, and metadata reads; malformed or
unrelated logs are ignored, and network/chain changes fail closed.

`TokenPreferenceRepository` is a deliberately small public-data seam.
`InMemoryTokenPreferenceRepository` is the default session-only adapter.
Persisted records contain no wallet secrets and are never written through
SecureStore. A future public-preference adapter must preserve that boundary.

### Phase 3.4 portfolio aggregation and asset icon architecture

Phase 3.4 adds the UI-independent `PortfolioAggregationService` under
`src/core/portfolio`. It composes the existing `AssetRegistry`,
`NativeAssetBalanceService`, `ERC20TokenService`, `TokenRegistry`, discovery
candidates, and explicitly network-bound account-state/provider pairs. It does
not add a second metadata or discovery engine.

Portfolio queries require an explicit public account and an explicit finite
list of configured network IDs. Each returned portfolio asset retains its
authoritative identity:

```text
native:         assetType + networkId + native assetId
fungible token: assetType + networkId + checksum contract address
```

Deduplication uses that identity only. Symbols, names, decimals, logos, and
display labels are never identity keys. Same-address assets on different
networks and the same network asset viewed by different accounts remain
separate. Native, registry, user-added, and discovered provenance is preserved
independently from visibility, discovery state, verification, metadata
availability, and live balance state.

The portfolio model keeps exact raw `bigint` balances, decimals, formatted
amounts, account/network context, availability state, and non-financial
summary counts. Zero-balance and hidden assets remain representable. Portfolio
aggregation does not calculate prices, fiat values, profit/loss, performance,
risk, or financial recommendations.

Phase 3.4 also adds the UI-independent `AssetIcon`/`TokenLogo` abstraction.
Logo source and provenance are explicit future-facing fields
(`curated_registry`, `trusted_external_source`, `user_provided`, or `none`),
but no external logo provider, token list, URL fetch, or remote-content trust
is implemented. Assets without logos expose bounded initials and a
deterministic identity-derived fallback. Logo availability never changes
verification or trust. Native icon fallbacks use the configured network native
currency metadata and do not invent placeholder PrimeWave branding.

Portfolio reads are explicit and bounded. They reuse only the existing
read-only RPC methods `eth_chainId`, `eth_getBalance`, `eth_getCode`, and
`eth_call`; they do not use `eth_getLogs` to create a second discovery path.
Network and chain changes fail closed. No portfolio balance persistence,
SecureStore access, wallet-secret access, signing, broadcasting, backend
indexing, background polling, or automatic network switching is introduced.

### Phase 3.5 portfolio read model and asset presentation layer

Phase 3.5 adds `PortfolioReadModelService` under `src/core/portfolio`. It
consumes one explicit account and one explicit network through the existing
`PortfolioAggregationService`:

```text
Blockchain / Asset Services
        ↓
PortfolioAggregationService
        ↓
PortfolioReadModelService
        ↓
Future Wallet UI
```

The service returns a stable `PortfolioReadModel` with account/network
context, generation time, deterministic asset ordering, visible and total
counts, warnings, and an explicit read state. Each
`PortfolioAssetViewModel` preserves authoritative identity, token contract
address, exact `bigint` balance, deterministic formatted balance, visibility,
verification, metadata, provenance, and the existing icon/fallback model.

Read-model ordering is deterministic: visible assets first, then available
assets, then positive balances, then native assets, followed by identity-key
ordering for ties. Hidden, unverified, unavailable, zero-balance, and
metadata-incomplete states remain independent. The read model does not add
portfolio UI, prices, fiat values, trust scoring, persistence, or another
blockchain read engine.

### Development-only Replit web preview test mode

The Replit web preview has a separate `src/core/development` preview test mode.
It is available only when both `__DEV__` and a browser document are present.
This mode exists for UI and navigation testing when native SecureStore is not
available; it is not a web wallet and is not a replacement for native security
testing.

Preview Test Mode does not instantiate or call `LocalWalletEngine`,
`SecureVault`, `AuthenticationManager`, SecureStore, biometric APIs, RPC
providers, transaction construction, signing, or broadcasting. It uses one
fixed public development address for display and a development-only six-digit
PIN fingerprint for lock/unlock UI state. It never creates or persists a
mnemonic, seed, private key, recovery phrase, real PIN verifier, or signing
capability.

The isolated preview repository may use a namespaced browser-local state key
containing only the preview phase and non-secret test PIN fingerprint. Invalid,
missing, blocked, or cleared preview state returns to onboarding, and reset is
idempotent. Native builds do not use this repository. Production builds cannot
activate Preview Test Mode because the `__DEV__` boundary is required.

### Phase 4.1 WaveX Home shell and navigation

Phase 4.1 adds the first authenticated WaveX wallet interface in
`src/components/WalletHomeShell.tsx`:

```text
Wallet unlock
      ↓
Authenticated public wallet state
      ↓
WaveX Home shell
      ↓
PortfolioReadModelService
      ↓
Asset presentation
```

The Home shell displays the public account label, shortened address, selected
network metadata, explicit portfolio state, exact read-model balances, icon
fallbacks, and asset availability/verification states. It does not implement
RPC calls, token discovery, pricing, fiat conversion, transaction construction,
signing, broadcasting, network switching, persistence, or backend services.

Home has explicit loading, empty, available, unavailable, and sanitized error
states. Refresh is user initiated and calls the existing read-model service;
there is no background polling or UI-side balance cache. The current primary
PrimeWave network remains visibly unconfigured because its registry entry is
still a placeholder.

The bottom navigation establishes Home, Assets, Swap, Activity, and Settings
destinations. Home, Assets, and Receive are implemented; the remaining
destinations and Send/Scan controls show controlled placeholder states and do
not perform wallet operations.

### Phase 4.2 WaveX Assets screen

Phase 4.2 extends the same shell with a real Assets destination:

```text
WaveX Home
      ↓
Assets
      ↓
PortfolioReadModelService
      ↓
PortfolioAssetViewModel
```

Home and Assets share the same in-memory read-model result, account query, and
network context. Assets performs only deterministic local filtering by public
name, symbol, contract address, or asset ID, with independent All, Visible, and
Hidden visibility filters. It does not create a second asset engine or make
network requests for search.

The Assets screen preserves balance, availability, metadata, verification, and
visibility as separate presentation concepts. Asset rows use the existing icon
and fallback model and expose a controlled “Asset details coming soon” entry
point. No prices, fiat values, external token lists, logo providers, or
transaction functionality were added.

### Phase 4.4 WaveX Receive and QR

Phase 4.4 adds the receive-only public address flow:

```text
WaveX Home
      ↓
Receive
      ↓
Public account + selected EvmNetwork
      ↓
Address / QR / Copy / Share
```

Receive reads the same public wallet account and selected network context as
Home and Assets. The QR payload is exactly the trimmed public EVM address and
uses a clean, high-contrast QR presentation with a reserved quiet zone. The
screen displays the full selectable address, shortened address, account index,
network status, and a concise warning that senders must use the selected
network. An unconfigured network remains visibly unconfigured; it does not
cause balances or blockchain activity to be invented.

Copy uses the existing public-address clipboard boundary. Share uses only the
public address plus the selected network name; Web Preview uses the Web Share
API when available and otherwise reports a controlled unavailable state. Receive
has no transaction-signing authority and does not implement QR scanning,
camera permissions, transfers, or recipient parsing.

### Phase 4.5 WaveX Send UI and public draft preparation

Phase 4.5 adds a send-only preparation flow using the same selected-network
portfolio read model:

```text
WaveX Home / Assets
      ↓
Send
      ↓
Selected network + native/ERC-20 portfolio asset
      ↓
Local recipient and exact amount validation
      ↓
Public transaction draft / controlled review placeholder
```

`WalletSendScreen.logic.ts` is a pure public-data boundary. It uses the
existing EVM address normalization and exact bigint asset amount utilities.
Asset identity remains network-scoped, and the screen rejects cross-network
assets, unavailable balances, malformed amounts, excessive precision, zero
amounts, and amounts above the represented available balance. Native MAX
copies the current exact balance and explicitly does not claim to be the
maximum spendable amount after gas.

The review placeholder can contain only the account ID, sender public address,
network ID, selected asset identity, normalized recipient, amount, and token
contract address when applicable. Phase 4.5 does not construct transactions,
estimate gas, retrieve nonces, sign, broadcast, mutate blockchain state, call
backend services, or access wallet secrets. Recipient validation is local
syntax/checksum normalization only; it does not verify safety, ownership,
contract type, or trust. Clipboard paste stays behind the existing clipboard
boundary and is not persisted, logged, or transmitted. QR scanning remains a
controlled Coming Soon action with no camera permission or dependency.

### Phase 4.6 WaveX transaction review and pre-send safety checkpoint

Phase 4.6 consumes the public draft from Phase 4.5 and performs the first
review-only handoff into the existing Phase 2.4 and Phase 2.5 boundaries:

```text
PublicSendDraft
      ↓
Network / chain / asset / balance validation
      ↓
Phase 2.5 TransactionConstructionEngine
      ↓
Unsigned TransactionPreview + exact fee data
      ↓
Explicit public confirmation result
      ↓
STOP before authentication, signing, or broadcast
```

`TransactionReviewScreen.logic.ts` creates only the intent required for the
existing construction engine. Native transfers use the exact parsed native
amount; ERC-20 transfers use a network-bound contract address, zero native
value, and an encoded `transfer` call. The construction engine remains
authoritative for nonce, gas limit, fee model, chain ID, and canonical unsigned
transaction identity. No transaction-construction logic is duplicated in the
screen.

The review validates that the network is still registered, enabled, configured,
active, and chain-consistent; that the asset identity remains network-scoped;
that token and native balances cover the requested operation; and that a
native fee remains denominated in the network's native currency. Legacy fee
fallbacks, unverified tokens, and syntactically valid but independently
unverified recipients remain explicit warnings.

Confirmation rechecks the public context and reconstructs read-only review
data to detect changed fee models or unsigned transaction identity. A changed
recipient, amount, asset, account, network, chain, fee model, or canonical
unsigned transaction invalidates the review. Confirmation returns only a
public `confirmed-for-signing` result and never unlocks, authenticates, signs,
broadcasts, or mutates blockchain state. Phase 4.7 owns the later secure
authorization and signing handoff.

### Phase 4.7 WaveX secure authorization and local signing

Phase 4.7 connects the public review checkpoint to the existing local
authentication and Phase 2.6 signing boundaries:

```text
Reviewed transaction
      ↓
Explicit public confirmation
      ↓
PIN or configured biometric authentication
      ↓
Transaction-bound signing authorization
      ↓
Existing TransactionSigningEngine
      ↓
SignedTransaction
      ↓
STOP before broadcast
```

The UI requests explicit PIN or biometric authentication after the review is
confirmed. A successful authentication is followed by a fresh public review
context check and comparison of the unsigned transaction's canonical identity
and fee model. The existing `createTransactionSigningAuthorization` function
then binds the exact unsigned transaction to the account and confirmation
request. `TransactionSigningEngine` remains responsible for the one-time
opaque capability, local HD-account derivation, signature validation, and
sanitized errors.

The signed UI state displays only public transaction information, including the
local transaction hash and a clear `Ready to Broadcast` deferred state. It
never calls the broadcast engine or `eth_sendRawTransaction`. Browser Preview
Test Mode does not create fake signatures or hashes and remains explicitly
unable to authenticate or sign.

### Phase 4.8 WaveX broadcast and confirmation lifecycle

Phase 4.8 connects the public `SignedTransaction` to the existing Phase 2.7
`TransactionBroadcastEngine` through an app dependency. The signed raw bytes
are passed unchanged; the UI never constructs JSON-RPC requests, reserializes
the transaction, changes fees, or signs again.

Broadcast is available only from an explicit `Broadcast Transaction` action
on the signed screen. Before calling the engine, the UI verifies the active
network, chain, sender, transaction type, and signed transaction context. A
network or account change blocks submission and requires returning to the
transaction flow.

The lifecycle remains honest and distinct:

```text
Ready to Broadcast
      ↓ explicit user action
Broadcasting
      ↓
Broadcasted
      ↓ bounded Phase 2.7 confirmation monitoring
Confirming → Confirmed / Reverted / Unknown
```

Timeouts and uncertain submission outcomes remain `Unknown`; the UI never
automatically retries or rebroadcasts. Explicit reconciliation uses the
existing transaction lookup method. Explorer links are created only from
validated configured-network transaction URL templates. Preview Test Mode
cannot broadcast or monitor transactions.

### Phase 5.1 WaveX activity and transaction history architecture

Phase 5.1 adds a UI-independent public activity architecture under
`src/core/activity`. It defines a session-scoped repository, lifecycle service,
and bounded read model without building the Activity screen, transaction detail
UI, backend indexing, external indexers, notifications, analytics, or cloud
persistence.

Activity records are scoped by `accountId`, `networkId`, and exact `chainId`.
They distinguish a generated local transaction ID from the blockchain
transaction hash. A local record can therefore exist as a draft or signed
transaction before a hash is known. Blockchain-discovered records may omit the
local ID but must have a scoped hash.

The model preserves `draft`, `signed`, `broadcasting`, `broadcasted`,
`confirming`, `confirmed`, `reverted`, `failed`, and `unknown` as separate
states. Provenance identifies local wallet creation, broadcast, confirmation,
public blockchain reads, or a future external indexer. The lifecycle service
consumes existing Phase 2.6/2.7 results and never signs, broadcasts, polls,
or accesses wallet secrets.

Phase 5.1 uses an in-memory/session repository only. It does not add
AsyncStorage, localStorage, SecureStore, a database, backend persistence, or
analytics. Reads are bounded and deterministic: block-known activity first,
hash-known pending activity next, and local-only activity last. Exact amounts,
fees, gas, nonce, and block values remain `bigint` or exact strings.

### Phase 5.1A asset-first activity presentation amendment

The activity read model now attaches a derived `ActivityPresentationModel` to
each item. The activity record and repository remain authoritative. The
presentation model adds UI-ready structure without adding UI components or
duplicating transaction execution data.

Each presentation item exposes a primary asset and optional secondary asset,
network-scoped asset identity, symbol/name/decimals, reused `AssetIcon`
fallback metadata, independent verification status, network badge metadata,
action, counterparty, exact signed amount presentation, optional fiat value,
timestamp source, provenance, lifecycle status, and explorer availability.

Default action mapping is conservative: native and ERC-20 transfers become
`sent` or `received` from the scoped direction; contract interactions become
`contract_interaction`; and unsupported events remain `unknown`. `swapped`
and `approved` are representable only through an explicit future trusted
interpretation. The system never infers a swap from multiple transfers or
arbitrary logs.

The existing `NetworkRegistry`, `AssetIcon`/`TokenLogo` types, and exact asset
formatter are reused. Network badges expose deterministic identity and fallback
metadata rather than downloaded logos. Fiat values are null unless an approved
future resolver supplies an exact display value. Block timestamps are marked
as blockchain-derived; otherwise observation timestamps are preserved honestly.

### Phase 5.2 WAVEX Activity UI

The Activity destination is implemented in `WalletActivityScreen` and is
wired through the existing wallet shell. It receives an
`ActivityReadModelService` from the app composition root and renders only
public `ActivityPresentationModel` data. The screen has no RPC, receipt,
blockchain, signing, SecureStore, backend, or analytics dependency.

The feed is asset-first. `ActivityRow` places the existing asset icon or
deterministic fallback at the left, overlays the presentation model's network
badge metadata, shows action and counterparty context in the center, and
right-aligns exact signed amount strings with optional supplied fiat beneath.
Rows retain lifecycle state, accessible labels, and a safe activity identifier
for the detail screen to resolve again through the authoritative read model.

Activity type options are data-driven: Transactions is the default, while
Swaps, Approvals, and Contract interactions appear only when explicit
presentation records support them. Swap and approval rows are never inferred
from arbitrary transfers. The network control is a display filter, not the
wallet network selector; it queries enabled networks while preserving
account/network/chain isolation and never selects an active network.

Items are bounded by the read model, ordered newest-first, and grouped using
the presentation timestamp source. The UI distinguishes loading, unavailable,
error, no activity, no network match, and no filter match states. Refresh
re-reads the existing service and does not start polling or transaction
execution.

Phase 5.2 intentionally stops before reconciliation and the Phase 5.3 detail
implementation. Swap detection or execution, price APIs, external indexing,
backend history, notifications, transaction replacement, speed-up,
cancellation, DApps, and WalletConnect remain outside both phases.

### Phase 5.3 WAVEX Transaction Details and reconciliation

The Activity row now opens `TransactionDetailScreen` with only the public
activity identity and its account/network/chain scope. The screen resolves
the authoritative record again through `ActivityReadModelService`, then
renders the existing `ActivityPresentationModel` plus authoritative record
metadata. Navigation never carries a private key, mnemonic, PIN, biometric
credential, SecureStore value, or signing capability.

The detail experience is blockchain-read-only. It shows explicit summary,
status, sender/counterparty, asset and exact amount, network, fee/gas,
transaction metadata, timestamp provenance, and validated explorer behavior.
Signed, broadcasted, confirming, confirmed, reverted, failed, and unknown
remain distinct; unknown is never relabeled as failed, and a broadcast is not
presented as confirmation. Missing fee, gas, nonce, block, timestamp, token
metadata, or explorer data stays unavailable rather than being fabricated.

Refresh is explicit and bounded. For a known hash it uses the existing
`lookupTransaction()` method and invokes the existing confirmation engine only
when lookup reports a mined transaction. Confirmed or reverted receipts update
the scoped activity lifecycle; pending, not-found, and inconclusive results
remain honest and never trigger automatic rebroadcast, signing, hidden
polling, or transaction mutation. The provider and activity stay bound to the
original network and chain; the detail flow never changes the active wallet
network.

External blockchain-read activity can be shown without a local transaction ID
and uses neutral origin wording. Explorer links come only from validated
configured network metadata. Phase 5.3 does not add swap detection or
execution, approval execution, backend history, external indexing, price APIs,
notifications, replacement, speed-up, cancellation, or fee bumping.

### Phase 6.2–6.4 WAVEX Swap Architecture, Quote Provider, Review, and Presentation

Phase 6.1 and 6.2 add the isolated provider-neutral swap domain under
`src/core/swaps`. It reuses the existing network-scoped `AssetIdentity`,
ERC-20 address normalization, `NetworkRegistry`, and exact bigint conventions.
Swap requests are public-only and contain account ID, sender address, network
ID, exact chain ID, sell/buy assets, exact sell amount, and integer slippage
basis points.

The quote boundary is:

```text
SwapQuoteProvider
      ↓
Untrusted provider response
      ↓
SwapQuoteService request/response validation
      ↓
Validated SwapQuote
      ↓
SwapReviewService
      ↓
Approved for Signing (public context only)
      ↓
Future Phase 6.5 signing handoff
      ↓
Existing Secure Local Signing
      ↓
Existing Broadcast Engine
```

The current real provider is 0x Swap API v2, implemented only behind
`SwapQuoteProvider`. It uses the unified
`https://api.0x.org/swap/allowance-holder/quote` endpoint with the `0x-api-key`
and `0x-version: v2` headers. A small injectable HTTPS client is used instead
of a large SDK. The API key comes from `ZEROEX_API_KEY` environment
configuration and is never placed in SecureStore, wallet models, quote data,
logs, or UI state.

The provider capability mapping currently covers the configured Ethereum
(1), BNB Smart Chain (56), Polygon (137), Arbitrum One (42161), Base (8453),
and Optimism (10) networks. PrimeWave remains unsupported until its real chain
configuration is supplied and 0x support is explicitly reviewed. All quote
requests remain same-chain and enforce 0–5000 bps slippage. WaveX native
assets are converted to the documented 0x native-token sentinel only at this
boundary; the sentinel is never used as a WaveX asset identity.

The quote model keeps expected buy amount separate from minimum buy amount,
represents multi-hop routes, exposes price impact as available or unavailable,
separates network, protocol, provider/0x, and integrator fee fields, and
preserves allowance requirements and provider issues as metadata. Provider
transaction calldata, recipient, value, and optional gas limit are untrusted
and validated before a quote is returned. Missing provider values remain
unavailable; they are not converted to zero or inferred from floating point
numbers.

`SwapQuoteService` owns the in-memory quote lifecycle
(`idle`, `requesting`, `quoted`, `expired`, `failed`). It does not persist
swap state, automatically refresh, background-poll, invent rates or routes, or
create Activity records. A 0x allowance requirement is metadata only: this
phase does not execute approvals, Permit2, EIP-712 signing, swap signing,
broadcasting, or execution. The validated 0x transaction request is a quote
output for a future review/construction flow; it is not passed directly to
signing or broadcasting.

Phase 6.3 adds `WalletSwapScreen` as a UI-only consumer of the shared
portfolio/read-model state and injected `SwapQuoteService`. Asset selectors are
scoped to the selected account/network context. Exact decimal parsing and
balance-based MAX happen in UI logic before quote requests. Network, account,
asset-pair, amount, and slippage changes invalidate the current quote; a
bounded debounce and request version protect the visible state from stale
responses. The screen presents only normalized values actually available from
the quote and keeps missing route, impact, fee, and metadata states explicit.

The screen's `Review Swap` action is gated by a valid unexpired quote and hands
only that normalized quote to `SwapReviewService`. Phase 6.4 revalidates the
exact quote context against the selected public account, configured active
network, selected assets, and fresh existing `PortfolioReadModel`. It checks
provider transaction fields, native fee totals, token balance sufficiency,
allowance metadata, provider issues, and explicit unavailable states.

The review result is an immutable public snapshot with a canonical keccak
binding digest over account/sender/network/chain, provider and quote identity,
assets, exact amounts, slippage, transaction fields, fee context, allowance
metadata, and provider issues. Final approval revalidates the current context
and returns only `approved-for-signing` public transaction context when the
digest matches. Missing or stale balances, unavailable required fees, and
blocking provider issues disable approval; the service never refreshes,
rebuilds, silently switches networks, or fabricates values.

`WalletSwapReviewScreen` presents the exact public review, minimum received
amount, route, price impact, network/protocol/provider fees, allowance
metadata, contract warning, binding digest, and blockers. Phase 6.4 stops at
**Approved for Signing**. It adds no WaveX swap fee, backend execution,
approval execution, Permit2, EIP-712 signing, swap signing, broadcast,
authentication, SecureStore access, Activity record, or cross-chain behavior.

## Design system

WAVEX uses a centralized dark foundation with blue, cyan, and violet
brand accents, technical typography, gradient surfaces, restrained glow, shared
spacing, radius, shadow, and component-state tokens. It is inspired by
PrimeWave's technology language without copying another wallet or reproducing a
website layout.

## Development phases

1. **Phase 0A/0B — foundation:** project structure, design system, security
   documentation, and security contracts.
2. **Phase 1A — local wallet core:** in-memory BIP-39 generation and
   validation, BIP-32/BIP-44-compatible EVM derivation, address validation,
   multiple-account models, and offline deterministic tests.
3. **Phase 1B-1 — secure local vault:** versioned platform-secure persistence,
   restoration, corruption handling, and offline persistence tests.
4. **Phase 1B-2 — authentication lifecycle:** PIN/biometric UX, authentication,
   and wallet locking after separate approval.
5. **Phase 2.1 — EVM network abstraction and registry:** typed network
   definitions, reviewed public metadata, deterministic validation, and
   explicit active-network selection. This controlled increment is complete;
   it performs no RPC calls.
6. **Phase 2.2 — EVM RPC provider engine:** typed JSON-RPC transport, bounded
   requests, deterministic endpoint selection, response validation, safe error
   normalization, and chain-ID verification. This controlled increment is
   complete; it performs no wallet read models.
7. **Phase 2.3 — EVM account and chain state:** read-only public-address
   state, native balances, nonces, contract-code observations, latest block
   state, lossless snapshots, and network-consistency protection. This
   controlled increment is complete; it performs no token or transaction work.
8. **Phase 2.4 — EVM gas and fee engine:** read-only gas estimation, Legacy and
   EIP-1559 fee data, lossless fee quotes, and safe native-unit formatting.
9. **Phase 2.5 — unsigned transaction construction:** validated native
   transfers and generic contract calls, nonce handling, gas/fee composition,
   deterministic unsigned envelopes, previews, and network-race protection.
10. **Phase 2.6 — secure local signing:** transaction-bound authorization,
    existing authentication gating, local Legacy/EIP-1559 signing, local
    transaction hashes, secret-lifetime minimization, and no-broadcast
    enforcement.
11. **Phase 2.7 — broadcast and confirmation:** exact signed-transaction
    broadcasting, chain/network protection, in-memory duplicate prevention,
    bounded receipt polling, revert handling, unknown-result handling, and
    read-only transaction lookup. No automatic retry or transaction mutation.
12. **Phase 4.6 — transaction review and safety checkpoint:** public-draft
    validation, read-only Phase 2.5 construction and Phase 2.4 fee display,
    exact balance preflight, stale-review invalidation, and explicit
    public-only confirmation. No authentication, signing, or broadcasting.
13. **Phase 4.7 — secure authorization and local signing:** explicit PIN or
    biometric authentication, exact transaction-bound Phase 2.6 signing,
    public signed state, and a hard stop before broadcast.
14. **Phase 4.8 — broadcast and confirmation lifecycle:** explicit broadcast
    confirmation, exact-byte Phase 2.7 submission, bounded monitoring,
    reconciliation, explorer links, and honest unknown/reverted states.
15. **Phase 5.1 — activity and transaction history architecture:** scoped
    public activity records, lifecycle integration, provenance, in-memory
    repository, bounded read model, and future reconciliation preparation.
  12. **Phase 3.1 — asset abstraction and native balance engine:** network-scoped
      native asset identities, exact bigint amount utilities, and read-only
      native balance retrieval. Complete.
   13. **Phase 3.2 — generic ERC-20 token read engine:** network-scoped token
      identities, contract-code validation, bounded metadata, exact token
      balances, safe errors, and offline fake-RPC tests. Complete.
   14. **Phase 3.3 — token discovery and user-added candidates:** canonical
       network-plus-contract identities, provenance and visibility separation,
       bounded account-scoped Transfer-log discovery, safe public preference
       repository seam, and offline fake-RPC tests. Complete.
   15. **Phase 3.4 — portfolio aggregation and asset icons:** explicit
       account/network-scoped native and ERC-20 aggregation, identity
       deduplication, provenance/visibility preservation, exact balances,
       deterministic icon fallbacks, safe errors, and offline tests. Complete.
    16. **Phase 3.5 — portfolio read model and asset presentation:** stable
        account/network-scoped presentation models, explicit balance and
        availability states, deterministic ordering, and no-secret/no-
        persistence boundaries. Complete.
     17. **Phase 4.1 — WaveX Home shell and navigation:** authenticated mobile
         Home, public account/network display, PortfolioReadModel integration,
         explicit asset states, refresh, placeholder destinations, and preview
         integration. Complete.
     18. **Future ecosystem capabilities:** external token verification,
         state-changing token operations, NFTs, portfolio valuation, swaps, DApp
       connectivity, and PrimeWave integrations remain deferred.