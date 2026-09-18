---
name: Swap quote trust boundary
description: Durable rules for keeping future swap providers separate from wallet authority and execution.
---

Provider quote responses are untrusted until the swap validator confirms exact
public request context, network-scoped assets, amounts, expiration, transaction
fields, and continuous route hops. A validated quote remains separate from
transaction approval, signing, broadcasting, and Activity history.

**Why:** Future swap integrations will supply calldata and financial metadata
from outside the wallet trust boundary; accepting a mismatched or disconnected
route could make review and later signing misleading.

**How to apply:** Keep provider adapters public-only and provider-neutral.
Preserve exact bigint values and explicit unavailable states, and reuse the
existing transaction-construction, signing, and broadcast boundaries rather
than adding execution authority to quote code.

Binding digests must hash only stable public review context; review timestamps,
blocker presentation metadata, and other revalidation-time fields must remain
outside the digest.

**Why:** Approval revalidation happens after review creation, so including a
creation timestamp can reject an otherwise unchanged quote as stale.

**How to apply:** Build the digest from the immutable quote/account/network/
transaction binding context, then attach the digest to the review snapshot.