---
name: Home balance honesty
description: Rules for presenting portfolio balance states when the read model lacks fiat valuation data.
---

The authenticated Home balance focal point must distinguish loading, unavailable, partial, available-zero, and available-positive states. The current portfolio read model provides native/token balances but no fiat aggregate, so positive balances should show that fiat value is unavailable and direct the user to native asset rows rather than inventing a currency amount. A visible asset with a non-available read state must never collapse into an available zero balance.

**Why:** Synthesizing a fiat total or treating an unreadable asset as zero would make the wallet display a false financial state.

**How to apply:** Keep this rule in presentation logic and tests whenever Home balance UI or portfolio read-model fields change.