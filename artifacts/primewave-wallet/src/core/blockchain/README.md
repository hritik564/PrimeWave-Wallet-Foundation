# Blockchain core

The network metadata and registry foundation lives in
`src/core/networks`. Phase 2.2 adds the typed JSON-RPC provider engine in
`src/core/blockchain/rpc`, and Phase 2.3 adds the read-only account-state
service in `src/core/blockchain/account-state`.

The provider requires an explicitly selected configured network, selects one
enabled endpoint deterministically, verifies the remote chain ID, bounds every
request, validates JSON-RPC responses, and normalizes errors safely. It uses
injectable transports so tests remain offline and deterministic.

The account-state service validates public addresses, retrieves native
balances, nonces, chain state, contract-code observations, and latest-block
data, then assembles non-persistent snapshots. Blockchain quantities remain
lossless `bigint` values and reads are rejected if the active network changes
mid-operation.

No wallet-secret access, signing, token discovery, indexing, DApp
connectivity, backend integration, or aggressive endpoint failover is
implemented here.