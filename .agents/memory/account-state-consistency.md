---
name: Account state consistency
description: Rules for keeping public account snapshots tied to one selected network and block context.
---

Account-state reads must capture the provider's selected network, verify the
registry remains on that network before and after asynchronous RPC work, and
use the captured latest block number for related account queries when practical.

**Why:** A network selection can change while multiple public reads are
in-flight; returning those results under the newly selected network would
produce a plausible but incorrect wallet snapshot.

**How to apply:** Keep snapshots non-persistent and lossless, reject stale
network results, and do not add a second network registry or silently switch
providers.