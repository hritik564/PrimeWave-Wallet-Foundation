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
- **Configuration:** environment and network configuration with unconfigured
  production placeholders.
- **Domain core:** the Phase 1A local wallet core plus typed interfaces for
  security, blockchain, network, token, transaction, portfolio, swap, and DApp
  behavior.
- **Services:** reserved for client-side adapters; the wallet core requires no
  backend or RPC service.

## Local wallet core

Phase 1A implements an in-memory `LocalWalletEngine` behind the
`WalletEngine` boundary in `src/core/wallet/contracts.ts`. It generates a
12-word BIP-39 recovery phrase from 128 bits of Expo platform entropy, derives
standard EVM accounts at `m/44'/60'/0'/0/<index>`, and exposes only wallet
metadata and public account data.

The cryptographic layer is intentionally separated from UI-facing models:

```text
WalletEngine
  ├─ LocalWalletEngine
  │    ├─ Expo Crypto entropy source
   │    ├─ @scure/bip39 mnemonic operations
   │    ├─ viem's @scure/bip32 HD account derivation
  │    └─ viem EVM account and address operations
  └─ public Wallet / WalletAccount models
```

Mnemonic, seed, HD root, and derived private-key material remain inside the
wallet-core module and its in-memory engine state. The public models contain
only wallet identifiers, timestamps, account indexes, addresses, and paths.

Phase 1A supports multiple accounts from one HD wallet. Account indexes are
derived along the final path component and do not create separate network or
seed systems.

### Wallet core and secure storage

Phase 1A deliberately does not connect the wallet core to `SecureVault`,
AsyncStorage, localStorage, a database, cloud backup, or any other persistence
mechanism. `LocalWalletEngine.discard()` clears the in-memory references on a
best-effort basis. JavaScript garbage collection is not a guaranteed secure
memory wipe; platform-secure persistence belongs to a later reviewed phase.

## Trust boundaries

The UI will communicate with `WalletEngine`, which coordinates the local
cryptographic implementation. Private keys, recovery phrases, secure storage,
and signing libraries remain behind that boundary. Phase 1A returns only
public metadata; it does not expose a recovery phrase or private key to UI
components.

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

`EvmNetwork` supports an id, name, chain ID, RPC URL, explorer URL, native
currency, primary-network flag, and environment. PrimeWave Chain is represented
as the future primary network with intentionally unconfigured production
values.

## Design system

PrimeWave Wallet uses a centralized dark foundation with blue, cyan, and violet
brand accents, technical typography, gradient surfaces, restrained glow, shared
spacing, radius, shadow, and component-state tokens. It is inspired by
PrimeWave's technology language without copying another wallet or reproducing a
website layout.

## Development phases

1. **Phase 0A/0B — foundation:** project structure, design system, typed network
   abstraction, security documentation, and security contracts.
2. **Phase 1A — local wallet core:** in-memory BIP-39 generation and
   validation, BIP-32/BIP-44-compatible EVM derivation, address validation,
   multiple-account models, and offline deterministic tests.
3. **Phase 1B — secure lifecycle:** encrypted local storage, recovery UX,
   authentication, and wallet locking after separate approval.
4. **Phase 2 — network and asset read models:** configured networks, balances,
   native assets, ERC-20 tokens, and verified-token boundaries.
5. **Phase 3 — transactions and signing:** local signing, user confirmation,
   and broadcast flows.
6. **Phase 4 — ecosystem capabilities:** discovery, swaps, DApp connectivity,
   and PrimeWave integrations.