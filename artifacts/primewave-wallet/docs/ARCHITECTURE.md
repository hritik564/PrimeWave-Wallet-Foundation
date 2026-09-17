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
  └─ future domain cores
       ├─ wallet
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
- **Domain core:** typed interfaces for future wallet, security, blockchain,
  network, token, transaction, portfolio, swap, and DApp behavior.
- **Services:** reserved for client-side adapters; no backend is required in
  Phase 0A.

## Future wallet core

The wallet core will own wallet lifecycle concepts without exposing secrets to
UI components or remote services. Phase 0B formalizes the `WalletEngine`
boundary in `src/core/wallet/contracts.ts`; key generation, import, vault
handling, and signing are deliberately deferred.

## Trust boundaries

The UI will communicate with `WalletEngine`, which coordinates the security
layer and later cryptographic implementation. Private keys, recovery phrases,
secure storage, and signing libraries remain behind that boundary. Public
metadata and user-approved transaction data may use future backend or RPC
services, but secret material may not leave the device.

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

1. **Phase 0A — foundation:** project structure, design system, typed network
   abstraction, security documentation, and honest placeholder screen.
2. **Phase 1 — local wallet lifecycle:** device-local wallet creation/import
   and secure storage after security review.
3. **Phase 2 — network and asset read models:** configured networks, balances,
   native assets, ERC-20 tokens, and verified-token boundaries.
4. **Phase 3 — transactions and signing:** local signing, user confirmation,
   and broadcast flows.
5. **Phase 4 — ecosystem capabilities:** discovery, swaps, DApp connectivity,
   and PrimeWave integrations.