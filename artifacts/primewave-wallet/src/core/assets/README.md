# Asset core

Phases 3.1–3.3 implement the network-scoped asset abstraction, native EVM
balance engine, generic read-only ERC-20 token engine, and the UI-independent
token candidate/discovery engine. NFTs and state-changing token operations
remain deferred.

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

## ERC-20 token discovery and user-added candidates

`TokenDiscoveryService` builds on `ERC20TokenService`, `TokenRegistry`,
`EvmAccountStateService`, and the existing RPC provider. It does not create a
second token identity system. The identity remains:

```text
assetType + networkId + checksum-normalized contractAddress
```

Candidates keep provenance (`user_added` or `discovered`), discovery state,
visibility, verification status, metadata observations, and account-scoped
discovery observations as separate fields. User intent and chain discovery do
not imply legitimacy or verification; arbitrary candidates remain
`verificationStatus = unknown`.

User-added tokens validate the selected network, checksum the address, require
contract code, and reuse the Phase 3.2 bounded metadata reads. Known candidates
use the same validation path. Repeated observations merge into one canonical
identity, while the same contract address on different networks remains
distinct.

Transfer-event discovery is strictly bounded. It requires explicit `fromBlock`
and `toBlock` values, a maximum block range, maximum log/result count, and a
maximum metadata lookup count. It issues two narrow `eth_getLogs` reads for the
standard ERC-20 `Transfer(address,address,uint256)` topic (outgoing and
incoming account filters), deduplicates logs, rejects malformed/unrelated
records, validates contract code and metadata, and fails closed on network or
chain changes. There is no genesis-to-latest, full-chain, unlimited, or
background scan.

`TokenPreferenceRepository` stores only public identity, visibility, provenance,
and metadata observations. The default `InMemoryTokenPreferenceRepository` is
session-only and intentionally cannot access SecureStore or wallet secrets.
External token lists, verification providers, pricing, risk systems, indexers,
backend APIs, transfers, approvals, permits, NFTs, portfolio/fiat data,
history, DApps, signing, and broadcasting remain outside this boundary.