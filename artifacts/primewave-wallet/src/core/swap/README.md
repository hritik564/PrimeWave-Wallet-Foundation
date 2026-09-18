# Swap core

Phase 6.1 and 6.2 are implemented in the isolated `src/core/swaps` module. It
contains provider-neutral swap request and quote models, same-chain
validation, untrusted provider response validation, sanitized errors, an
in-memory quote lifecycle service, and the current 0x Swap API v2 quote
provider behind `SwapQuoteProvider`.

This legacy singular directory remains only as a compatibility pointer. The
0x provider only retrieves and normalizes quotes; no swap UI, approvals,
Permit2, signing, broadcasting, execution, WaveX swap fee, backend execution,
cross-chain support, or persistent swap state is implemented here.