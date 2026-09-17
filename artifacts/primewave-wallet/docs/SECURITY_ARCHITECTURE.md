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

Phase 0B defines contracts only. Implementations must use reviewed,
platform-appropriate mechanisms later.

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

## 11. Error handling

Errors shown to users must not expose private keys, recovery phrases,
cryptographic material, authentication secrets, or secure-storage contents.
Internal errors must be sanitized before logging or passing to error
reporting. The current error boundary uses sanitized error details and does not
display raw stack traces to the user.

Secret material must never be included in application error objects created by
future security implementations.

## 12. Memory handling

Cryptographic secrets should have the shortest practical lifetime in memory.
Future implementations should minimize copies, clear sensitive buffers where
the chosen platform and library allow it, avoid global state, avoid Redux,
Zustand, or persistent UI state for secrets, avoid React state for raw
cryptographic material, and never put secrets in URL parameters.

JavaScript garbage collection does not guarantee secure memory wiping. PrimeWave
Wallet must document this limitation honestly and use platform-native
mechanisms where appropriate.

## 13. Backup and recovery

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

## 14. Multiple accounts

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

## 15. Security testing structure

Phase 0B adds a reviewable test-case plan under
`src/core/security/tests/SECURITY_TEST_CASES.md`. These are not fake passing
tests. A real test runner and concrete implementations must be added before
the corresponding contract tests are marked complete.

## 16. Dependency and backend rules

No cryptographic or wallet dependency is installed in Phase 0B. No custom
cryptography, encryption, mnemonic generation, or elliptic-curve logic is
allowed.

No backend endpoints are created for mnemonic, seed, privateKey, signingKey,
walletPassword, walletPin, or encryptionKey fields. The current backend
remains unchanged.