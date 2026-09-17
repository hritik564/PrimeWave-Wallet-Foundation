# Security core

Phase 0B defines device-local security contracts without implementing
cryptography, secure storage, biometric secrets, PINs, vaults, or signing.

- `contracts.ts` — opaque vault, authentication, secret, and signing boundaries
- `logging.ts` — centralized redacting logger
- `errors.ts` — sanitized error boundary
- `privacy.ts` — sensitive-screen privacy contract
- `clipboard.ts` — sensitive clipboard policy and contract
- `tests/` — implementation-gated security test plan

See `docs/SECURITY_ARCHITECTURE.md` for the permanent trust boundary.