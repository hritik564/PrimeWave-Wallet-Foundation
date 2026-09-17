# Development State

## Current phase

**Phase 3.4 — portfolio aggregation and token-logo architecture (completed)**

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
- Added the read-only `EvmAccountStateService` behind the blockchain boundary.
- Added public-address validation and checksum normalization without wallet
  secret access.
- Added lossless native balance, nonce, chain ID, block number, and timestamp
  handling using `bigint`, plus safe decimal display formatting.
- Added contract-code observation, latest-block parsing, and coherent
  non-persistent account snapshots.
- Added active-network consistency checks that reject stale results after a
  network change during an in-flight read.
- Added offline account-state tests for invalid addresses, zero and very large
  balances, nonces, code classification, snapshots, stale results, provider
  errors, concurrency, and no persistent state.
- Added the Phase 2.4 read-only gas and fee engine with lossless gas estimates,
  Legacy/EIP-1559 fee data, fee quotes, safe errors, and native-unit display
  formatting.
- Added the Phase 2.5 unsigned transaction construction engine for native
  transfers and generic contract calls.
- Added public-account ownership validation so construction cannot substitute an
  unknown sender account.
- Added exact bigint validation for value, nonce, gas limit, and fees, with no
  floating-point conversion, padding, or local nonce state.
- Added nonce retrieval through the existing account-state service and gas/fee
  reuse through the existing Phase 2.4 engine.
- Added deterministic unsigned transaction representations and read-only
  transaction previews with contract-interaction warnings.
- Added network, chain-ID, RPC-error, concurrency, no-persistence, and
  no-broadcast construction tests.
- Added transaction-bound Phase 2.6 authorization with canonical unsigned
  transaction digests.
- Added existing-authenticator gating and one-time opaque signing capabilities.
- Added local Legacy and EIP-1559 signing through the existing `viem`
  dependency without adding a cryptographic library.
- Added local signed-transaction hashes and sender-recovery test vectors.
- Added account, network, chain, fee, calldata, nonce, gas, value, and
  transaction-type tampering rejection.
- Added cancellation, authentication, vault/key-access, concurrency,
  network-race, no-RPC, no-backend, no-persistence, and no-broadcast signing
  tests.
- Added the Phase 2.7 UI-independent broadcast and confirmation engine.
- Reused the existing typed `EvmRpcProvider` for raw transaction broadcast,
  receipt polling, and read-only transaction lookup.
- Added exact raw signed-transaction validation and local hash consistency
  checks before `eth_sendRawTransaction`.
- Added active-network, configured-network, remote-chain, and signed-chain
  protection without automatic network switching.
- Added in-memory hash-based duplicate protection for concurrent, completed,
  and ambiguous broadcast operations.
- Added bounded explicit receipt polling with confirmed, reverted, and unknown
  states using bigint receipt quantities.
- Added timeout ambiguity handling with no automatic rebroadcast or endpoint
  failover.
- Added structural tests proving the broadcaster has no signing, vault, or
  private-key access.
- Added the network-scoped asset abstraction with architectural native,
  fungible-token, and NFT type labels.
- Added `AssetRegistry` deriving native assets from the existing network
  registry without hardcoded global symbols.
- Added exact bigint amount formatting and strict decimal parsing utilities.
- Added the read-only `NativeAssetBalanceService` using existing
  `EvmAccountStateService` instances and RPC balance infrastructure.
- Added explicit multi-account and multi-network balance identity handling.
- Added placeholder, disabled, unsupported, chain-mismatch, network-change,
  RPC-failure, and no-service error normalization.
- Added tests proving no token contract calls, signing, broadcasting, backend
  calls, persistence, or secret material.
- Added a generic, UI-independent ERC-20 read engine under the existing asset
  boundary without token lists, discovery, or external verification.
- Added network-scoped token identities using checksum-normalized contract
  addresses; symbols and names are never identity keys.
- Added contract-code validation through `eth_getCode`, rejecting EOAs before
  metadata or balance reads.
- Added viem ABI encoding/decoding for only `name`, `symbol`, `decimals`, and
  `balanceOf`; no token state-changing methods are present in the ABI.
- Added bounded, untrusted metadata handling with explicit complete, partial,
  unavailable, and invalid states and the established 0–36 decimal policy.
- Added exact bigint ERC-20 balances and token-decimal display formatting with
  explicit account, network, chain, and contract identity.
- Added network-change and chain-mismatch protection by reusing the existing
  account-state and RPC/provider boundaries.
- Added offline fake-RPC coverage for multiple accounts/networks, malformed
  metadata, reverted reads, EOAs, exact balances, safe errors, and forbidden
  methods.
- Added the Phase 3.3 UI-independent token discovery and user-added candidate
  engine above the existing ERC-20 read service.
- Preserved the canonical `assetType + networkId + checksum contract address`
  identity and merged repeated discovery/user-added observations without
  duplicate token identities.
- Added separate provenance, discovery state, visibility, metadata snapshot,
  verification, and account-scoped observation models. User-added and
  discovered candidates remain unknown/unverified by default.
- Added bounded incoming/outgoing ERC-20 Transfer-event discovery with explicit
  block ranges, narrow account topics, result limits, metadata limits,
  malformed-log rejection, deduplication, and remote chain revalidation.
- Extended the typed RPC provider with validated read-only `eth_getLogs`.
- Added an injected public `TokenPreferenceRepository` seam and a session-only
  in-memory implementation. Token preferences never use SecureStore and never
  contain wallet secrets.
- Added 12 offline discovery tests for user-added validation, provenance
  merging, network/account scope, visibility/removal, bounded logs, malformed
  data, limits, safe errors, persistence safety, concurrency, and forbidden
  methods.
- Added the UI-independent `src/core/portfolio` aggregation domain.
- Added explicit `Portfolio`, account, network, asset, balance, status, source,
  visibility, and summary models without duplicating asset identity rules.
- Added account- and network-scoped aggregation for native and ERC-20 assets,
  with explicit network requests, configured-network validation, exact bigint
  balances, metadata reuse, live balance states, and non-financial summaries.
- Added identity-based deduplication preserving registry, user-added, and
  discovered provenance and visibility.
- Added deterministic `AssetIcon`/`TokenLogo` models and fallback identifiers
  without fetching remote logos or implying verification.
- Added portfolio-specific safe errors, result bounds, remote-chain checks,
  stale network rejection, no-persistence behavior, and read-only RPC audits.
- Added 12 offline portfolio tests covering aggregation, isolation,
  deduplication, provenance, visibility, zero balances, metadata gaps, icons,
  fallbacks, chain/network races, limits, safe errors, and forbidden methods.

## Pending work

- Production PrimeWave Chain launch configuration must be supplied and reviewed
  before the primary network can be activated.
- Recovery UX and authentication UI require separate scope and security review.
- External token lists, verification providers, NFTs, portfolio valuation, fiat
  pricing, transaction history, transfers, approvals, permits, swaps, DApps,
  backend asset APIs, notifications, and full wallet UI remain outside this
  controlled increment.
- Balance preflight validation is intentionally not implemented because it is
  optional and must not be mistaken for a guarantee before signing/broadcast.
- Physical-device verification of local signing and native biometric behavior
  has not begun.

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

## Phase boundary

Phase 3.4 is complete. Stop here. Later phases may separately define external
verification, token state-changing operations, NFTs, portfolio valuation, fiat
pricing, transaction history, UI activity, swaps, DApps, WalletConnect,
notifications, backend indexing, replacement, speed-up, cancellation,
automatic fee bumping, full wallet UI, and other ecosystem capabilities.