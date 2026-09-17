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