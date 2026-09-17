# Asset core

Phase 3.1 implements the asset abstraction and native EVM asset engine only.
ERC-20/token functionality is intentionally deferred.

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
account-state services to the balance service. The same address on different
networks produces separate balance identities. No balance cache, continuous
polling, portfolio aggregation, fiat pricing, or background refresh exists in
this phase.

Future fungible-token and NFT types exist only as architectural type labels;
they do not resolve or perform operations in Phase 3.1.