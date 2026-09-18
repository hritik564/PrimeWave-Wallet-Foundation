---
name: Swap execution boundary
description: Durable rules for connecting approved swap reviews to local execution without weakening allowance, signing, or broadcast boundaries.
---

Approved swap execution must revalidate the immutable review binding immediately
before each signing action. A token sell with missing allowance data is
unavailable and must block; it must never be treated as sufficient by default.
Insufficient allowance uses only the reviewed provider spender and exact
positive required amount for a bounded ERC-20 approval. Approval and swap
transactions require separate explicit user authorization and confirmation.

**Why:** Token spending permission and the swap itself have different security
consequences, and the provider response is untrusted external input.

**How to apply:** Keep construction, authentication/signing, broadcasting, and
confirmation delegated to the existing transaction boundaries. Never add a
silent approval, unlimited allowance, replacement provider calldata, automatic
swap continuation, or automatic rebroadcast.