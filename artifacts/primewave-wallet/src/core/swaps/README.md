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

## Phase 6.3 presentation boundary

`WalletSwapScreen` is the presentation layer above `SwapQuoteService`. It
consumes the already-scoped `PortfolioReadModel`, selected `EvmNetwork`, public
wallet account, and an injected quote service. It never calls 0x, fetch, RPC,
SecureStore, signing, approval, or broadcast APIs directly.

The screen performs exact sell-amount/MAX validation, same-network asset
selection, same-asset rejection, bounded 550 ms quote debounce, stale-response
protection, refresh, expiry countdown, explicit unavailable/error states,
slippage controls from 0 to 5000 bps, and neutral unknown/unverified-token
warnings. A quote is only displayed when its normalized context matches the
current account, network, pair, amount, and slippage.

The `Review Swap` control is enabled only for a current, unexpired normalized
quote and hands that quote to the isolated Phase 6.4 review layer. It never
hands a quote directly to signing or execution.

The normalized transaction request is quote data only. It does not go directly
to signing or broadcasting, and existing WaveX transaction construction
remains authoritative for any future execution. Phase 6.2 does not execute
approvals, Permit2, EIP-712 signing, swaps, signing, broadcasting, or
backend execution. It adds no WaveX swap fee, Activity record, or
cross-chain support.

## Phase 6.4 review and approval boundary

`SwapReviewService` consumes only a normalized `SwapQuote`. It revalidates the
quote lifecycle and expiry, exact account/sender/network/chain, network-scoped
assets, exact amounts and slippage, provider transaction target/value/calldata,
freshness of the existing `PortfolioReadModel`, sell balance plus native fee
requirements, and blocking provider issues. Missing or stale public data
blocks approval instead of being refreshed, inferred, or replaced.

Each review stores an immutable public snapshot and a canonical keccak binding
digest over the exact account, sender, network, chain, provider/quote identity,
assets, amounts, slippage, transaction request, fee context, allowance
metadata, and provider issues. `approveReview` revalidates the current input
and returns only `approved-for-signing` public context when the digest still
matches. Allowance requirements remain metadata; this phase never executes an
approval, Permit2, EIP-712 signing, swap signing, `eth_sendRawTransaction`, or
Activity write.

`WalletSwapReviewScreen` presents the public review, fee and route states,
minimum received amount, allowance metadata, contract warning, digest, and
blocking reasons. The UI stops at **Approved for Signing** and does not
authenticate, access SecureStore, access signing services, broadcast, or
silently refresh a quote. Preview Test Mode uses the same public-only boundary
and cannot produce a fake successful approval.

## Phase 6.5 secure local execution boundary

`SwapExecutionService` consumes only an approved immutable review and a fresh
public `SwapReviewInput`. It is not a provider adapter and does not accept raw
0x responses or executable UI fields. Before transaction construction and
again immediately before signing, the flow revalidates account, sender,
network, chain, assets, exact amounts, slippage, provider/quote lifecycle,
expiry, fee context, allowance context, the review digest, and the exact
provider transaction target, value, and calldata.

The allowance decision is explicit:

- native sell: `native-not-required`, no approval transaction;
- ERC-20 with actual allowance at least `requiredAmount`: `sufficient`, no
  approval transaction;
- ERC-20 below `requiredAmount`: `insufficient`, dedicated approval review;
- missing actual allowance: `unavailable`, execution blocked.

For insufficient allowance, only the normalized provider spender is accepted.
It must be a valid address bound to the reviewed token and network. The
approval transaction calls standard ERC-20 `approve(spender, requiredAmount)`
with the exact positive reviewed amount. No unlimited allowance, inferred
spender, arbitrary UI target, multiplier, Permit2, or automatic submission is
supported.

The existing transaction construction engine remains authoritative for both
approval and swap transaction previews. The swap preview must preserve the
reviewed provider `to`, `value`, and exact calldata bytes. The existing
WalletAccessManager/Phase 2.6 signer performs local authentication and signing;
the existing Phase 2.7 broadcast and confirmation engine handles exact signed
bytes, receipt states, and `unknown` ambiguity. Approval confirmation is
separate from swap signing, and the UI requires explicit continuation after a
confirmed approval. There is no automatic retry or rebroadcast.

`WalletSwapExecutionScreen` exposes distinct review, approval required,
approval signing, approval confirmation, swap signing, swap broadcasting,
swap confirmation, completed, failed, and unknown states. Phase 6.5 does not
create Activity records; its public execution results are reserved for Phase
6.6. Preview Test Mode fails closed before construction and never
authenticates, signs, broadcasts, or fabricates a result.