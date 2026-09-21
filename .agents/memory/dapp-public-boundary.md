---
name: DApp public boundary
description: Durable security constraints for future DApp/Web3 work.
---

The DApp layer accepts only untrusted public metadata, account/network context,
permissions, request intent, and lifecycle state. It must not acquire wallet
secrets, raw signing handles, secure-storage access, or direct broadcast access.

**Why:** Provider input and DApp identity are not proof of trust, and connecting
an account must never silently authorize message signing or transaction signing.

**How to apply:** Keep session access explicitly account/network scoped, validate
at both model and repository/service boundaries, preserve typed-data payloads
exactly, and hand any future transaction request into the existing review,
construction, authorization, signing, and confirmation pipeline.