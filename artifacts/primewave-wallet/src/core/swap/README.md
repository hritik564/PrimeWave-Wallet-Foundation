# Swap core

Phase 6.1 is implemented in the isolated `src/core/swaps` module. It contains
provider-neutral swap request and quote models, same-chain validation,
untrusted provider response validation, sanitized errors, and an in-memory
quote lifecycle service.

This legacy singular directory remains only as a compatibility pointer. No
swap UI, real provider, external quote API, signing, broadcasting, execution,
or persistent swap state is implemented here.