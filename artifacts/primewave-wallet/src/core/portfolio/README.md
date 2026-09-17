# Portfolio core

The portfolio core is intentionally UI-independent:

```text
Blockchain / Asset Services
        ↓
PortfolioAggregationService
        ↓
PortfolioReadModelService
        ↓
Future Wallet UI
```

`PortfolioAggregationService` performs the existing bounded, account- and
network-scoped public reads. `PortfolioReadModelService` transforms one
account/network result into a stable `PortfolioReadModel` without adding
blockchain calls, persistence, pricing, fiat valuation, or secret access.

The read model preserves authoritative asset identity, exact `bigint` raw
balances, formatted balances, visibility, verification, metadata,
provenance, and icon fallback information. Ordering is deterministic:
visible, available, positive, native, then identity-key order. Hidden,
unverified, unavailable, zero-balance, and metadata-incomplete states are
independent.