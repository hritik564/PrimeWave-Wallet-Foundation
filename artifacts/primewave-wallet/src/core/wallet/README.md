# Wallet core

Phase 1A provides the in-memory EVM wallet core. `LocalWalletEngine` generates
standard BIP-39 recovery phrases from Expo platform entropy, derives
`m/44'/60'/0'/0/<index>` accounts through `viem`'s standard HD-account API
(backed by `@scure/bip32`), and obtains EVM addresses through `viem`.

The UI-facing `Wallet`, `WalletAccount`, and `WalletEngine` types contain no
mnemonic or private-key fields. The recovery phrase, seed, HD root, and
derived private keys are isolated inside the wallet-core implementation and
are never persisted or logged.

`derivation.ts` is intentionally a secret-bearing internal module used by the
engine and offline deterministic tests. It is not exported from the wallet
barrel as a UI API. Phase 1A does not implement secure persistent storage,
authentication, recovery UI, signing, RPC, or blockchain connectivity.