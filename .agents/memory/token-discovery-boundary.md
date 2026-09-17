---
name: Token discovery boundary
description: Durable safety rules for PrimeWave Wallet token discovery and user-added public preferences.
---

Token discovery must remain a bounded read-only observation layer above the
ERC-20 service. Its only functional provenance values are explicit user intent
and bounded chain observation; neither implies legitimacy, trust, or
verification. Identity remains network plus checksum-normalized contract
address, while account scope belongs to observations.

**Why:** Token metadata and Transfer logs are attacker-controlled public input,
and broad scans or provenance-based trust decisions would turn discovery into
an unsafe indexer or verification system.

**How to apply:** Require finite explicit block ranges, narrow account filters,
result and metadata limits, code validation, safe metadata states, chain
revalidation, and malformed-log rejection. Keep visibility and public metadata
behind a repository interface that cannot access SecureStore or wallet secrets.