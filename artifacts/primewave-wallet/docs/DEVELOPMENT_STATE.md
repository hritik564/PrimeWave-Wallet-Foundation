# Development State

## Current phase

**Phase 1B-1 — secure local wallet vault (completed)**

## Completed work

- Created a lightweight Expo and TypeScript mobile application.
- Added a centralized PrimeWave Wallet theme with dark surfaces, gradients,
  typography, spacing, radii, shadows, and component states.
- Added a single foundation screen with no fake balances, addresses,
  transactions, or blockchain claims.
- Added generic EVM network interfaces and an intentionally unconfigured
  PrimeWave Chain primary-network entry.
- Added the non-custodial security architecture document.
- Added application architecture and development-state documentation.
- Added reserved modules for future wallet, security, blockchain, network,
  token, transaction, portfolio, swap, and DApp work.
- Defined opaque security contracts for vault, authentication, secret, and key
  management boundaries.
- Defined the future `WalletEngine` boundary and explicit transaction signing
  flow.
- Added privacy, clipboard, safe logging, sanitized error, and security test
  plan structures.
- Expanded the security architecture with classifications, trust boundaries,
  attack surfaces, recovery, memory, and multi-account rules.
- Added an in-memory `LocalWalletEngine` for local wallet creation and
  multiple-account derivation.
- Added BIP-39 mnemonic generation from Expo cryptographic entropy and
  mnemonic validation.
- Added standard EVM derivation at `m/44'/60'/0'/0/<index>` through `viem`.
- Added safe public wallet/account models and EVM address validation.
- Added offline Node test coverage with known account 0, 1, and 2 vectors.
- Reviewed the dependency tree and documented the selected library versions.
- Added `expo-secure-store` `57.0.4` with the Expo config plugin.
- Added a version 1 vault format containing protected mnemonic material and
  minimal restoration metadata.
- Added iOS Keychain / Android Keystore-backed persistence with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility.
- Added wallet restoration across fresh engine instances, deletion, missing
  vault, malformed vault, unsupported version, and unavailable-storage handling.
- Added fail-closed web behavior because Expo SecureStore is native-only.
- Added offline persistence tests without exposing secrets through public models.

## Pending work

- Production PrimeWave Chain configuration must be supplied and reviewed.
- Recovery UX and authentication require separate scope and security review.
- The Phase 0B authentication and signing contract test plan remains a plan for
  future implementations.

## Important architectural decisions

- The mobile app remains independently capable of existing without a PrimeWave
  backend.
- Production network values are not invented in this phase.
- Wallet secrets must remain device-local and must never be sent to backend
  infrastructure.
- PrimeWave uses the standard Ethereum coin type and does not use a
  PrimeWave-specific seed or derivation path.

## Known limitations

- No authentication UX, import/recovery UI, PIN, biometrics, wallet locking,
  or signing.
- No blockchain RPC, indexer, price service, database, notification service, or
  DApp connection.
- The PrimeWave Chain entry has null chain and endpoint values by design.
- JavaScript garbage collection is not a guaranteed memory wipe for temporary
  secrets.
- SecureStore availability is false on web, so web wallet creation/restoration
  fails closed rather than using browser storage.
- There has been no full external security audit.

## Next recommended phase

**Phase 1B-2 — authentication lifecycle**, covering authentication UX,
wallet locking, and platform authentication integration. Do not begin it
automatically.