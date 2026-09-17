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

## Design system

PrimeWave Wallet uses a centralized dark foundation with blue, cyan, and violet
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
   16. **Future ecosystem capabilities:** external token verification,
       state-changing token operations, NFTs, portfolio, swaps, DApp
      connectivity, and PrimeWave integrations remain deferred.