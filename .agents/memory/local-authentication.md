---
name: Local authentication policy
description: Durable PrimeWave Wallet decisions for local PIN, biometric fallback, retry behavior, and auto-lock.
---

PrimeWave Wallet authentication is device-local and must remain behind the
wallet-access facade. Use a versioned RFC 7914 scrypt verifier for the
six-digit PIN, platform biometrics only as an operating-system prompt, and
never persist or log raw PINs or biometric data.

**Why:** The wallet is non-custodial, web must fail closed, and the user must
retain recovery access without a permanent retry lockout.

**How to apply:** Preserve the current verifier version/parameters unless a
future migration explicitly adds a new version; keep PIN fallback available,
use bounded exponential retry delay, default to immediate background locking,
and treat JavaScript memory clearing as best-effort only.