---
name: Browser fetch binding
description: Browser transport callbacks must preserve the global fetch receiver when passed into an RPC transport.
---

When a browser RPC transport stores `globalThis.fetch` and later invokes it as a detached callback, Chromium can reject it with `TypeError: Illegal invocation` even though direct browser fetches to the same endpoint succeed.

**Why:** `Window.fetch` requires its original global receiver in this runtime, so a detached reference is not equivalent to calling `globalThis.fetch`.

**How to apply:** Bind the fetch implementation to `globalThis` at transport construction time. Keep endpoint selection, request parameters, and error normalization unchanged.