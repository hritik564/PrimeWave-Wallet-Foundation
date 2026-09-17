---
name: Native asset network binding
description: The boundary between explicit multi-network asset reads and the existing active-network account-state service.
---

Native asset balance reads must receive an explicitly network-bound
`EvmAccountStateService` for each queried network. Do not make the asset layer
switch a shared active registry to satisfy a request for another network.

**Why:** The existing account-state service captures its provider/network
context and fails closed if the selected network changes during a read.
Implicit switching would weaken that protection and could associate a balance
with the wrong network.

**How to apply:** Resolve the requested network and native asset first, then
select the matching bound account-state service. Keep same-address balances on
different networks as separate identities. Return an unavailable-service error
instead of falling back to another network or silently changing selection.