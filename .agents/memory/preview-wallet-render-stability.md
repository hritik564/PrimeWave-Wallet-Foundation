---
name: Preview wallet render stability
description: Development Preview wallet identity must remain stable across parent renders so portfolio requests and manual refreshes are not cancelled as stale.
---

The development Preview wallet is public, deterministic, and safe to memoize. Recreating its object during every parent render changes the account object identity, which can recreate Home portfolio callbacks and invalidate in-flight reads even when the address and network have not changed.

**Why:** Portfolio refresh uses request identity and effect cleanup to reject stale results. Unrelated parent renders must not look like an account-context change.

**How to apply:** Keep the Preview wallet object stable for the lifetime of the Preview session. If native wallet state uses the same memoization path, include its explicit access revision so lock/unlock changes still refresh the native wallet.