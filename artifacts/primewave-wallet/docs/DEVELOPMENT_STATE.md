# Development State

## Current phase

**Phase 2.2 — EVM RPC provider engine (completed)**

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
- Added strongly typed EVM network definitions for PrimeWave Chain, Ethereum,
  BNB Smart Chain, Polygon, Arbitrum, Base, Optimism, and future custom networks.
- Added ordered RPC endpoint metadata and block explorer metadata without
  credentials or live connectivity.
- Added deterministic registry validation for IDs, chain IDs, URLs, currency
  metadata, duplicate networks, primary-network rules, and environments.
- Added explicit active-network selection by stable ID; no automatic switching
  or DApp-controlled selection is implemented.
- Added focused offline registry tests for integrity, lookup, duplicate
  rejection, placeholder rules, environment separation, and invalid metadata.
- Added a typed JSON-RPC 2.0 provider engine behind the blockchain boundary.
- Added fake-transport tests for request creation, response validation, request
  IDs, JSON-RPC errors, malformed responses, timeouts, HTTP/network failures,
  endpoint selection, disabled endpoints, and chain-ID verification.
- Added safe RPC error normalization and sanitized diagnostic logging without
  exposing full URLs, credentials, or wallet-secret material.

## Pending work

- Production PrimeWave Chain launch configuration must be supplied and reviewed
  before the primary network can be activated.
- Recovery UX and authentication require separate scope and security review.
- Aggressive endpoint failover, network health checks, asset read models,
  balances, tokens, and live application read flows remain outside this
  controlled increment.

## Important architectural decisions

- The mobile app remains independently capable of existing without a PrimeWave
  backend.
- Production network values are not invented in this phase.
- Wallet secrets must remain device-local and must never be sent to backend
  infrastructure.
- PrimeWave uses the standard Ethereum coin type and does not use a
  PrimeWave-specific seed or derivation path.

## Known limitations

- No automatic network switching, aggressive RPC failover, health-check
  scheduler, indexer, price service, database, notification service, or DApp
  connection.
- The PrimeWave Chain entry has null chain and endpoint values by design.
- Built-in public RPC metadata is not a live connectivity guarantee and does
  not contain credentials.
- JavaScript garbage collection is not a guaranteed memory wipe for temporary
  secrets.
- SecureStore availability is false on web, so web wallet creation/restoration
  fails closed rather than using browser storage.
- There has been no full external security audit.

## Next recommended phase

**Phase 2.3 — network and asset read models**, covering endpoint health checks,
explicit failover policy, and public native-asset/balance reads. Do not begin
it automatically.