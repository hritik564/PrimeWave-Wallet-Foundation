---
name: Secure wallet vault
description: Durable platform-storage decision for PrimeWave Wallet local vault persistence
---

PrimeWave Wallet uses Expo SecureStore `57.0.4` as the Phase 1B-1 protected
storage boundary. The native adapter uses iOS Keychain and Android
Keystore-backed storage with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS. The
browser path must fail closed rather than using localStorage or another
browser persistence fallback.

**Why:** Phase 1B-1 requires device-local protection without introducing custom
encryption, and PIN/biometric access prompts are explicitly deferred to
Phase 1B-2.

**How to apply:** Keep vault values versioned and validated, keep the public
API opaque and secret-free, and do not enable `requireAuthentication` until
the separately scoped authentication lifecycle is implemented.