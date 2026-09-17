# Security core

Phase 1B-1 implements the secure-vault boundary through the wallet core's
internal `SecureWalletVault` and Expo SecureStore adapter. The public security
contracts remain opaque: UI code does not receive decrypted vault contents,
mnemonics, private keys, or encryption material.

- `contracts.ts` — opaque vault, authentication, secret, and signing boundaries
- `logging.ts` — centralized redacting logger
- `errors.ts` — sanitized error boundary
- `privacy.ts` — sensitive-screen privacy contract
- `clipboard.ts` — sensitive clipboard policy and contract
- `tests/` — implementation-gated security test plan

Authentication UX, PINs, biometrics, wallet locking, and signing remain
deferred to Phase 1B-2 and later phases.

See `docs/SECURITY_ARCHITECTURE.md` for the permanent trust boundary.