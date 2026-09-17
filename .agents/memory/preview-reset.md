---
name: Local preview reset
description: Safety and ordering rules for the development-only wallet reset flow.
---

The development-only preview reset must erase the local wallet vault before
attempting PIN-verifier cleanup, require explicit inline confirmation, and
return to onboarding after the wallet vault is gone.

**Why:** A cleanup failure after the wallet has already been erased should not
leave the preview stranded on a locked screen; the next setup flow can safely
replace any stale verifier.

**How to apply:** Keep reset hidden from production builds, never reveal or
invent a PIN, and preserve the secure-storage fail-closed behavior for the
browser preview.