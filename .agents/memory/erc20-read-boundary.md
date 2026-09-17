---
name: ERC-20 read boundary
description: Durable scope and safety decisions for the generic Phase 3.2 token engine.
---

ERC-20 support is intentionally limited to known contract-address identities,
contract-code validation, metadata reads, and exact `balanceOf` reads. Token
names and symbols are untrusted display metadata and never verification or
identity claims. Transfers, approvals, allowances, permits, discovery,
external lists, and portfolio services remain separate capabilities.

**Why:** The wallet is non-custodial and must not turn an arbitrary contract
read into a state-changing token workflow or imply that an unverified token is
safe.

**How to apply:** Reuse the existing network-bound account-state and RPC
services. Keep `eth_call` calldata limited to `name`, `symbol`, `decimals`, and
`balanceOf`; preserve explicit metadata failure states and the bounded decimal
policy rather than inventing defaults.