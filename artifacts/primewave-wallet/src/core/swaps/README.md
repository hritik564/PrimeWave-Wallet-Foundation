# Swap core

## Phase 6.2 boundary

The swap core contains the provider-neutral request, quote, route, fee,
allowance, provider-issue, price-impact, transaction-request, and lifecycle
models from Phase 6.1. Phase 6.2 adds the current 0x Swap API v2
AllowanceHolder quote provider under `providers/zeroex`.

0x remains behind `SwapQuoteProvider`. The provider uses
`https://api.0x.org/swap/allowance-holder/quote`, sends `0x-version: v2`, and
reads `ZEROEX_API_KEY` from environment configuration. Its HTTP client is
injectable for offline tests. The API key is configuration, not a wallet
secret: it must never enter SecureStore, wallet-secret storage, quote models,
logs, errors, UI state, or analytics.

The supported-network capability mapping currently covers Ethereum (1), BNB
Smart Chain (56), Polygon (137), Arbitrum One (42161), Base (8453), and
Optimism (10). PrimeWave is intentionally unsupported until its real chain
configuration and 0x support are reviewed. Requests are same-chain only.
Native WaveX assets are represented with the documented 0x native-token
sentinel only inside the provider boundary; WaveX identity remains network
plus asset type plus asset ID.

0x output is untrusted and is normalized through `SwapQuoteService` before it
is exposed as a `SwapQuote`. Exact decimal-string values remain `bigint`;
provider errors, liquidity, route, fee, price-impact, allowance, and issue
metadata are handled explicitly. Missing values remain unavailable rather
than becoming fabricated zeroes.

The normalized transaction request is quote data only. It does not go directly
to signing or broadcasting, and existing WaveX transaction construction
remains authoritative for any future execution. Phase 6.2 does not execute
approvals, Permit2, EIP-712 signing, swaps, signing, broadcasting, or
backend execution. It adds no WaveX swap fee, Activity record, swap UI, or
cross-chain support.