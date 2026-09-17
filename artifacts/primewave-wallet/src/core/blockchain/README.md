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

## Phase 2.4: EVM Gas & Fee Engine

`src/core/blockchain/gas-fee` provides a UI-independent, read-only
`GasFeeEngine`. It accepts only public transaction parameters: optional
`from`, optional `to`, native `value`, and hexadecimal calldata. Addresses are
checksum-normalized before `eth_estimateGas`; contract destinations are
supported without attempting trust or risk analysis.

The engine exposes:

- `estimateGas` through `eth_estimateGas`
- legacy fee data through `eth_gasPrice`
- EIP-1559 fee data through the latest block's `baseFeePerGas` and
  `eth_maxPriorityFeePerGas`
- `getFeeData` with legacy fallback when EIP-1559 data is missing or
  unsupported
- `getFeeQuote`, which calculates the maximum estimated network fee using
  bigint multiplication
- `formatNativeUnits` for decimal display strings only

For EIP-1559 quotes, `maxFeePerGas` is exactly
`baseFeePerGas + maxPriorityFeePerGas`. The engine does not add hidden
multipliers, padding, retries, or automatic fee increases. A missing or
unsupported fee model is reported as a normalized safe result/error rather
than replaced with an arbitrary value.

Gas limits, gas prices, base fees, priority fees, max fees, native values, and
estimated network fees remain `bigint` values internally. No floating-point
arithmetic, JavaScript `Number` conversion, fiat pricing, or fee persistence is
used. Every asynchronous operation captures one configured network context,
verifies the remote chain ID, and rejects stale results after a network
change.

Gas estimation does not sign, broadcast, or construct transactions. No private
keys, recovery phrases, PINs, biometric secrets, encryption keys, or signing
credentials enter the engine. Token balances, ERC-20 behavior, swaps, DApps,
WalletConnect, indexing, backend custody, and transaction history remain
outside this phase.

No wallet-secret access, signing, token discovery, indexing, DApp
connectivity, backend integration, or aggressive endpoint failover is
implemented here.