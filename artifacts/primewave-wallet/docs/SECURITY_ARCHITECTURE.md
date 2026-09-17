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