# Asset core

Phases 3.1 and 3.2 implement the network-scoped asset abstraction, native EVM
balance engine, and generic read-only ERC-20 token engine. NFTs and
state-changing token operations remain deferred.

Assets are network-scoped. The stable native identity is:

```text
assetType = native
networkId = <network registry ID>
assetId = native
```

Native metadata is derived from the existing `NetworkRegistry`; symbols,
names, and decimals are never used as primary identity. Placeholder,
disabled, and unknown networks are not exposed as available native assets.

`NativeAssetBalanceService` accepts an explicit network ID, account ID, and
public address. It delegates native balance retrieval to the existing
`EvmAccountStateService`, which reuses the existing RPC provider and
`eth_getBalance` implementation. The service does not switch networks,
construct transactions, sign, broadcast, authenticate, access secrets,
persist data, or call a backend.

Balance quantities remain `bigint`. `formatAssetAmount` performs exact
decimal formatting without floating-point arithmetic. `parseAssetAmount`
accepts only a strict non-negative decimal grammar, rejects exponent notation,
whitespace, malformed values, and excessive decimal places, and returns an
exact `bigint`. Leading zeros are rejected except for the single zero integer
part.

Multi-network support is achieved by supplying explicitly network-bound
account-state services to the balance service and explicitly network-bound
account-state/provider pairs to the ERC-20 service. The same address or
contract on different networks produces separate identities. No balance cache,
continuous polling, portfolio aggregation, fiat pricing, or background refresh
exists in this phase.

## ERC-20 read engine

`ERC20TokenService` resolves tokens by the network ID and
checksum-normalized contract address. It validates contract code through
`eth_getCode`, then uses only viem-encoded `name`, `symbol`, `decimals`, and
`balanceOf(address)` calls through the existing RPC provider. It never calls
transfers, approvals, allowances, `transferFrom`, permits, signing, or
broadcasting.

Metadata remains untrusted and reports complete, partial, unavailable, or
invalid states. Names and symbols are bounded and control-character checked.
Decimals are explicit contract metadata with the shared 0–36 policy; invalid
or unavailable decimals are never replaced with 18. Balances remain exact
`bigint` values and use the token's decimals for display formatting.

Token discovery, external lists, verification providers, NFTs, portfolio and
fiat pricing, history, DApps, and backend APIs are outside this boundary.