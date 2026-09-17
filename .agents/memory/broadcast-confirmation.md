---
name: Broadcast and confirmation boundary
description: Phase 2.7 execution rules for already-signed EVM transaction broadcasting and receipt observation.
---

Phase 2.7 is a transport and observation layer only: it consumes `SignedTransaction`, validates the original network and chain context, sends exact raw bytes through the existing RPC provider, and never signs or accesses wallet secrets.

**Why:** A timeout after an RPC send attempt is ambiguous, and changing the signed transaction or endpoint can create unsafe hidden retries.

**How to apply:** Keep broadcast idempotency in memory by signed hash, return unknown for ambiguous send/receipt outcomes, bind confirmation to the original provider/network, and keep history, replacement, fee bumping, and UI out of this phase.