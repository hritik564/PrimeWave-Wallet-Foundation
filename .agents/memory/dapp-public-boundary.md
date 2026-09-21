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

The connection UI is a separate explicit consent boundary: a proposal remains
pending until the user chooses Connect or Reject, and approval rechecks expiry,
account/address, active network, provider identity, chains, capabilities, and
current network configuration. Preview must never manufacture DApp proposals or
sessions.

**Why:** A real provider proposal can become stale while the app is backgrounded
or while the user changes wallet context; opening a screen must never grant
authority.

**How to apply:** Keep provider SDK calls in the adapter, make the UI consume
validated public DTOs, and let stale/expired context fail closed before session
approval.

Message signing is a separate explicit approval boundary from connection
access. Support only the reviewed message methods, preserve exact provider
bytes/JSON for cryptographic signing, and bind a one-shot opaque capability to
the request, account, network, and payload digest after wallet authentication.

**Why:** A connected DApp must not inherit signing authority, and bounded or
sanitized display data must never silently become the signed payload.

**How to apply:** Keep provider request normalization and response delivery in
the adapter; show bounded review data in the UI; authorize only after an
explicit Sign action; reject replay, stale context, unsupported methods, and
authentication failure.