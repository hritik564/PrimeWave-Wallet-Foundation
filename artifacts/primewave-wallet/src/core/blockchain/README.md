# Blockchain core

The network metadata and registry foundation lives in
`src/core/networks`. Phase 2.2 adds the typed JSON-RPC provider engine in
`src/core/blockchain/rpc`.

The provider requires an explicitly selected configured network, selects one
enabled endpoint deterministically, verifies the remote chain ID, bounds every
request, validates JSON-RPC responses, and normalizes errors safely. It uses
injectable transports so tests remain offline and deterministic.

No wallet-secret access, signing, balances, token discovery, indexing, DApp
connectivity, backend integration, or aggressive endpoint failover is
implemented here.