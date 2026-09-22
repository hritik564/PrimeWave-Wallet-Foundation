# Phase 8.5 market and price data infrastructure

This module exposes bounded, provider-neutral public market valuation data. A
price is an external valuation only. It is not token verification, token trust,
token legitimacy, balance, ownership, approval state, or transaction
confirmation.

## Identity

Market asset identity reuses the WaveX network/token identity boundary:

```text
native asset: networkId + native
ERC-20:       networkId + canonical lowercase contractAddress
```

Symbols, names, tickers, and provider-specific asset IDs are never WaveX asset
identity. Provider IDs exist only inside the mapping boundary.

The request descriptor format is:

```text
native:<networkId>
erc20:<networkId>:<contractAddress>
```

The API deduplicates repeated identities while preserving the original
requested count. Same-symbol or same-address assets on different networks
remain separate.

## Price contract

`MarketPriceObservation` contains:

- asset identity
- explicit quote currency
- exact decimal price or `null`
- provider source and provider asset mapping
- provider observation timestamp and server receipt timestamp
- `available`, `unavailable`, or `invalid` availability
- `fresh`, `stale`, or `unknown` freshness
- bounded reason state
- provenance

Prices remain strings. JavaScript floating-point arithmetic is not used.
Malformed decimals, negative values, `NaN`, `Infinity`, excess precision, and
impossible timestamps are rejected. Unavailable values are never converted to
zero.

Freshness is configuration-driven. An absent observation timestamp produces
`unknown`; a timestamp within `MARKET_PRICE_FRESHNESS_MAX_AGE_MS` is `fresh`;
older data is `stale`.

## Provider boundary

`PriceProvider` is the only provider-facing interface. Provider response data is
untrusted and is normalized inside `MarketPriceService`. Provider failures are
converted to bounded WaveX states:

- configuration missing
- timeout
- rate limit
- unavailable
- malformed response

The repository currently has no approved market-data credentials or provider
SDK. Runtime therefore uses the explicit `unconfigured` provider and returns
honest unavailable results. `DeterministicMockPriceProvider` is test-only
infrastructure and does not represent live market data.

Provider asset mappings are network-aware and provider-aware. Unknown assets
remain unavailable; the service never guesses from a symbol or provider ID.
Requests are split into bounded provider batches and inherit the API rate
limiter. There is no background polling, infinite retry, arbitrary URL proxy,
or unbounded in-memory cache.

## API

`GET /api/v1/prices` is read-only. The `/api` compatibility mount is also
available.

Required query fields:

- `assets` — one or more comma-separated or repeated descriptors, bounded by
  `MARKET_PRICE_MAX_ASSETS`
- `quoteCurrency` — three-letter uppercase currency; defaults to `USD`

The current supported quote currency is `USD`. Unsupported currencies are
rejected explicitly so future currencies can be added without changing the
internal model.

The response always exposes availability and freshness. It does not expose
provider credentials, raw provider payloads, provider URLs, or wallet secrets.

## Persistence and integration boundaries

Phase 8.5 does not add price tables or persistence. No historical price feed,
price cache, portfolio fiat valuation, Activity fiat valuation, or mobile price
integration is included. Portfolio balances remain exact blockchain data, and
Activity remains independent of market data.