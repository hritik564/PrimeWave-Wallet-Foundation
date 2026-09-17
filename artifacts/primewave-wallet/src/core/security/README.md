# Security core

Phase 1B-2 adds the local authentication and wallet-access lifecycle on top of
the Phase 1B-1 secure-vault boundary. UI code talks to `WalletAccessManager`;
it does not call SecureStore or receive the decrypted vault as a public state
object.

- `contracts.ts` — opaque vault, authentication, secret, and signing boundaries
- `logging.ts` — centralized redacting logger
- `errors.ts` — sanitized error boundary
- `privacy.ts` — sensitive-screen privacy contract
- `clipboard.ts` — sensitive clipboard policy and contract
- `authentication.ts` — versioned PIN verifier, biometric adapter, lock state,
  backoff, and auto-lock policy
- `wallet-access.ts` — onboarding, import, unlock, lock, and authenticated
  recovery access facade
- `platform-privacy.ts` — best-effort Expo screen-capture protection
- `tests/` — offline authentication and security tests

## PIN protection

The wallet PIN policy is exactly six decimal digits. The PIN is never persisted
or logged. A random 128-bit salt and RFC 7914 `scrypt` produce a 256-bit
verifier using `N=16384`, `r=8`, and `p=1`. The verifier record is versioned
and held only in platform-secure storage. Failed attempts use an in-record
exponential retry delay capped at 10 seconds; this is not a permanent lockout,
so a valid PIN remains recoverable.

Future verifier changes must introduce a new record version and an explicit
migration path. JavaScript buffer clearing is best-effort and is not a
guarantee of memory wiping.

## Platform limits

- iOS uses Keychain-backed SecureStore and the operating system Face ID/Touch
  ID prompt. Android uses Keystore-backed SecureStore and the supported Android
  biometric prompt. The app never receives biometric data.
- Background masking and screen-capture prevention are best-effort platform
  APIs. The React Native privacy overlay is used immediately, but app-switcher
  rendering and screenshot behavior can vary by OS version and device policy.
- Web explicitly fails closed: it does not use browser storage or browser
  biometrics for wallet secrets.
- This code has not undergone an independent security audit. No bank-grade,
  unhackable, or guaranteed-protection claim is made.

See `docs/SECURITY_ARCHITECTURE.md` for the permanent trust boundary.