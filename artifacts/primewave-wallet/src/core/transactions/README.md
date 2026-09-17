# Transaction core

`src/core/transactions/construction` contains the Phase 2.5 UI-independent
unsigned transaction construction engine. It consumes public wallet-account
metadata, the selected configured network, the existing account-state service,
the existing RPC provider, and the Phase 2.4 gas/fee engine.

The construction lifecycle is:

```text
TransactionIntent
  ↓
Public validation and normalization
  ↓
Known local account validation
  ↓
Network and chain validation
  ↓
Nonce retrieval when omitted
  ↓
Gas estimation when omitted
  ↓
Fee-model selection
  ↓
UnsignedTransaction + TransactionPreview
```

The engine supports native transfers and generic contract calls. It does not
decode ABI data or claim that a contract is safe. All blockchain quantities are
`bigint`, fee selection remains explicitly Legacy or EIP-1559, and canonical
debug/test serialization converts quantities to decimal strings without losing
precision.

Private keys, recovery phrases, vault handles, PINs, biometric secrets,
signing capabilities, and secure-storage implementations are outside this
module. It does not sign, broadcast, persist, replace, speed up, cancel, or
automatically approve transactions.

`contracts.ts` remains the earlier reserved signing-flow contract surface. It
is not used by the Phase 2.5 construction implementation.

## Phase 2.6 local signing

`src/core/transactions/signing` performs local transaction signing only. Its
input must be the validated unsigned transaction produced by Phase 2.5 plus a
transaction-specific authorization. The authorization binds:

- account ID and normalized sender
- network ID and chain ID
- transaction type
- recipient, value, calldata, nonce, and gas limit
- Legacy or EIP-1559 fee model and fee fields
- a deterministic digest of the canonical unsigned transaction
- explicit approval and authorization context

Signing also requires the existing wallet authenticator to report an
authenticated/unlocked state. Authentication is checked before the one-time
opaque signing capability is issued. The UI does not receive a key and does
not call the low-level key operation directly.

The existing `LocalWalletEngine` derives the requested HD account from the
in-memory wallet secret and uses the existing `viem` dependency to produce
standard Legacy or EIP-1559 EVM serialization. The mnemonic and derived
signing account remain inside the local wallet/security boundary. The returned
`SignedTransaction` contains only the signed raw transaction, its locally
computed hash, and public network/account metadata.

The signing engine:

- never calls RPC or backend services
- never calls `eth_sendRawTransaction`
- never persists or logs secret material
- rejects authorization or transaction-field mismatches
- rejects account, network, chain, authentication, and concurrent-signing
  failures
- releases references to the temporary derived signing account after signing

JavaScript garbage collection cannot guarantee cryptographic memory
zeroization. The implementation minimizes the derived-account lifetime and
does not retain it in service state; stronger native cryptographic isolation
remains future hardening.

**Phase 2.6 performs local transaction signing only. Broadcasting is
intentionally deferred to Phase 2.7.**