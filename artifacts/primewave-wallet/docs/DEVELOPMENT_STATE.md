# Development State

## Current phase

**Phase 5.3 — WAVEX Transaction Details and reconciliation (completed)**

The native wallet/security path remains the production-controlled path. A
separate development-only Replit web preview test mode is also available for
UI testing; it is not a real wallet and does not alter the native boundary.

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
- Added Phase 3.5 `PortfolioReadModelService` and stable
  `PortfolioReadModel`/`PortfolioAssetViewModel` types above aggregation.
- Added explicit balance, availability, metadata, verification, visibility,
  provenance, icon, warning, and read-state presentation boundaries.
- Added deterministic visible/available/positive/native/identity ordering and
  account/network context validation without duplicate blockchain reads.
- Added six focused Phase 3.5 read-model tests for transformation, exact
  bigint preservation, visibility, verification, metadata, availability,
  ordering, isolation, normalized errors, and aggregation delegation.
- Added isolated `src/core/development/preview-test-mode.ts` for Replit web
  preview UI testing.
- Added simulated onboarding, six-digit test PIN, lock, unlock, reset, and
  refresh-persistent state using only a fixed public development identity and
  non-secret test-state data.
- Kept Preview Test Mode separate from `LocalWalletEngine`, SecureVault,
  SecureStore, native authentication, biometric APIs, RPC, signing,
  broadcasting, and backend services.
- Added preview security tests for development-only availability, invalid PINs,
  lock/unlock/reset idempotency, refresh persistence, and absence of mnemonic,
  private-key, recovery-phrase, and raw PIN data.
- Added the Phase 4.1 WaveX Home shell with responsive mobile-first layout,
  public account/network presentation, preview-only development banner,
  explicit portfolio loading/empty/available/unavailable/error states, and
  user-triggered refresh.
- Integrated Home with `PortfolioReadModelService` and the existing app runtime
  boundary without adding UI-side RPC, balance, price, persistence, or
  transaction logic.
- Added Home, Assets, Swap, Activity, and Settings navigation destinations.
  Home and Assets are implemented; the remaining destinations and
  Send/Receive/Scan are controlled placeholders.
- Added application-contract tests for navigation, safe public address display,
  portfolio/asset states, metadata fallbacks, and sanitized errors.
- Added the Phase 4.2 Assets screen using the same `PortfolioReadModelService`
  result as Home.
- Added deterministic local search by asset name, symbol, contract address,
  and asset ID, with All, Visible, and Hidden visibility filters.
- Added polished asset loading, empty, unavailable, error, metadata,
  verification, availability, balance, icon fallback, and controlled-detail
  presentation states.
- Added Home → Assets “View all” navigation and retained the shared account
  and network query context.
- Applied the attached WAVEX visual reference direction through the existing
  dark/cyan/violet theme without copying example balances, names, addresses,
  or transaction behavior.
- Added focused filter/search contract coverage and retained the full offline
  suite and Preview Test Mode security coverage.
- Added a public account panel with account label/index, shortened and full
  public address, explicit copy confirmation, unlocked status, and lock action.
- Added the registry-backed network selector using the actual registered network
  list, with configured, unconfigured, disabled, and selected states.
- Kept active-network selection behind `NetworkRegistry.selectActiveNetwork`;
  unconfigured and disabled networks show controlled messages and never become
  active for blockchain operations.
- Wired network changes through the shared portfolio read-model boundary so Home
  and Assets reload under the new account/network context and do not retain
  stale results as the new context loads.
- Kept Preview Test Mode public identity, lock, and refresh behavior isolated
  from SecureStore, native wallet security, biometrics, signing, broadcasting,
  backend services, and persistence.
- Added the receive-only screen using the authoritative public account address
  and selected registry network context.
- Added deterministic public-address QR generation with a clean QR surface,
  explicit quiet zone, contrast, and accessible textual address alternative.
- Added public-address copy and platform share actions with sanitized,
  controlled success, cancellation, and unavailable states.
- Added the selected-network safety warning and honest configured,
  unconfigured, and disabled network presentation on Receive.
- Added focused Receive tests for QR payload determinism, QR configuration,
  network state, and public-only share content.
- Added the Send screen with selected-network context, native/ERC-20 asset
  selection, exact available balances, recipient paste, local EVM
  normalization, exact decimal amount validation, deterministic MAX behavior,
  and controlled review placeholder state.
- Added Home → Send and Assets → Send handoffs, preserving network-scoped
  selected asset identity and clearing ambiguous recipient/amount drafts when
  the network changes.
- Added public-only draft preparation containing account, sender, network,
  asset, recipient, amount, and optional token contract data only.
- Added focused Send tests for initial state, native/token selection,
  network isolation, recipient states, paste boundary, exact amounts, MAX,
  validation gating, public-only drafts, and deferred scanning.
- Added the transaction review screen consuming only the Phase 4.5 public
  draft.
- Connected review preparation to the existing Phase 2.5 construction engine
  and Phase 2.4 gas/fee boundary without duplicating transaction logic.
- Added native/ERC-20 intent preparation, exact fee display, native fee
  currency distinction, balance preflight checks, unverified-token warnings,
  and recipient verification wording.
- Added stale review invalidation for account, recipient, amount, asset,
  network, chain, fee model, and canonical unsigned transaction changes.
- Added explicit public-only `confirmed-for-signing` state. Phase 4.6 never
  authenticates, unlocks, signs, broadcasts, or mutates blockchain state.
- Added focused review tests for public draft validation, construction and
  fee delegation, EIP-1559/Legacy display, fee fallback, balance safety,
  stale state, sanitized errors, and confirmation isolation.
- Connected explicit Phase 4.6 confirmation to the existing wallet access
  authentication boundary with PIN and configured biometric paths.
- Added exact transaction-bound signing authorization using the existing Phase
  2.6 `TransactionSigningEngine` and one-time capability model.
- Added signed-state UI showing the public transaction hash and a disabled
  `Ready to Broadcast` deferred state.
- Added Preview Test Mode fail-closed behavior with no fake signatures or
  transaction hashes.
- Added focused authorization binding coverage and preserved the hard
  no-broadcast boundary.
- Connected the signed transaction screen to the existing Phase 2.7 broadcast
  and confirmation engine.
- Added explicit `Broadcast Transaction` confirmation with exact-byte
  submission, network/account guards, bounded monitoring, and reconciliation.
- Added honest broadcast, confirmation, reverted, failed, and unknown states.
- Added public hash copy and validated configured-network explorer links.
- Added the UI-independent `src/core/activity` model, lifecycle service,
  in-memory repository, and bounded read model.
- Added account/network/chain isolation, local ID versus transaction-hash
  identity, provenance, exact bigint handling, and explicit unknown states.
- Integrated signed, broadcast, and confirmation results into session activity
  records without adding a second broadcast or receipt-polling engine.
- Added focused repository, lifecycle, ordering, read-model, and security
  regression tests.
- Added the UI-independent asset-first `ActivityPresentationModel`.
- Added reused asset icon/fallback metadata, network badge metadata, explicit
  action classification, counterparty presentation, and optional secondary
  asset/amount representation.
- Added exact signed amount presentation, timestamp provenance, optional fiat
  values, and validated explorer availability.
- Added conservative action rules: swaps and approvals are only accepted from
  explicit future trusted interpretations and are never inferred.
- Added the WAVEX Activity destination with bounded read-model loading,
  asset-first rows, deterministic network badge overlays, type/network display
  filters, date grouping, refresh and empty/error states.
- Replaced the activity-row detail placeholder with a read-only WAVEX
  Transaction Details experience backed by the authoritative activity read
  model and presentation model.
- Added honest status, summary, sender/counterparty, exact amount, asset,
  network, fee/gas, nonce, block, timestamp-source, hash/local-ID, and
  validated explorer presentation.
- Added explicit, bounded user-triggered reconciliation through the existing
  transaction lookup and confirmation infrastructure. Confirmed and reverted
  receipts update scoped activity records; unknown, pending, and not-found
  outcomes remain honest.
- Added external blockchain-read support with neutral origin wording and
  account/network/chain isolation. No secrets or mutation APIs enter the
  detail flow.
- Added focused Transaction Details logic tests for navigation scope, status
  semantics, exact quantities, lookup context, reconciliation outcomes,
  external activity, and security-sensitive omissions.

## Pending work

- Production PrimeWave Chain launch configuration must be supplied and reviewed
  before the primary network can be activated.
- Recovery UX and authentication UI require separate scope and security review.
- External token lists, verification providers, NFTs, portfolio valuation, fiat
  pricing, external indexing, backend asset/history APIs, notifications, and
  full wallet UI remain outside this controlled increment.
- Phase 5.3 intentionally does not include swap detection/execution,
  approvals execution, DApps, WalletConnect, transaction replacement,
  speed-up, cancellation, fee bumping, account switching, asset detail,
  QR scanning, or Settings functionality.
- Preview Test Mode is intentionally limited to web UI state testing and is not
  native wallet or security validation.
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
- QR scanning, camera permissions, recipient parsing, and native device share
  validation remain deferred. Web Preview reports when native sharing is
  unavailable rather than claiming it was tested.
- The PrimeWave Chain entry has null chain and endpoint values by design.
- Built-in public RPC metadata is not a live connectivity guarantee and does
  not contain credentials.
- JavaScript garbage collection is not a guaranteed memory wipe for temporary
  secrets.
- SecureStore availability is false on web, so web wallet creation/restoration
  fails closed rather than using browser storage.
- There has been no full external security audit.

## Phase boundary

Phase 5.3 is complete. Stop here. Later phases may separately define external
indexing, backend history, notifications, external verification, token
state-changing operations, NFTs, portfolio valuation, fiat pricing, swaps,
DApps, WalletConnect, replacement, speed-up, cancellation, automatic fee
bumping, and other ecosystem capabilities.