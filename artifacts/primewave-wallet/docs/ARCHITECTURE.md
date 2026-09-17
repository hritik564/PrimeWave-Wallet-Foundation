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
7. **Phase 2.3 — network and asset read models:** health checks, balances,
   native assets, ERC-20 tokens, and verified-token boundaries.
8. **Phase 3 — transactions and signing:** local signing, user confirmation,
   and broadcast flows.
9. **Phase 4 — ecosystem capabilities:** discovery, swaps, DApp connectivity,
   and PrimeWave integrations.