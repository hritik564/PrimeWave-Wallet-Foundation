---
name: Crypto dependency maturity
description: Registry and dependency-selection constraints learned while adding the PrimeWave local wallet core.
---

The workspace enforces a one-day minimum npm release age. For security-sensitive
wallet dependencies, choose an older mature release rather than bypassing that
guard. Keep the direct runtime set small: Expo platform entropy, BIP-39
utilities, and the maintained EVM account API are sufficient when the EVM
library already provides standard HD derivation.

**Why:** Newest package releases can be rejected by the workspace registry, and
adding both a direct HD package and an EVM library can create duplicate crypto
primitive versions.

**How to apply:** Check the workspace release-age policy before installing.
Prefer the EVM library's standard mnemonic account API when it already wraps
the reviewed BIP-32/BIP-44 implementation; use Node's built-in test runner
with the existing TypeScript loader if a test framework cannot be installed.