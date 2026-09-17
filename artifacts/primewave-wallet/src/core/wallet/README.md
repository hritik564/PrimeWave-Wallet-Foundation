# Wallet core

Phase 1B-1 extends the in-memory EVM wallet core. `LocalWalletEngine` creates
and restores a wallet through the internal versioned `SecureVault`. It
generates standard BIP-39 recovery phrases from Expo platform entropy, derives
`m/44'/60'/0'/0/<index>` accounts through `viem`'s standard HD-account API
(backed by `@scure/bip32`), and obtains EVM addresses through `viem`.

The UI-facing `Wallet`, `WalletAccount`, and `WalletEngine` types contain no
mnemonic or private-key fields. The recovery phrase, seed, HD root, and
derived private keys are isolated inside the wallet-core implementation; the
recovery phrase is persisted only through the platform-secure vault and is
never logged or exposed through public models.

`derivation.ts` and `internal/vault.ts` are intentionally secret-bearing
internal modules used by the engine and offline tests. They are not exported
from the wallet barrel as UI APIs. Phase 1B-1 does not implement
authentication UX, recovery UI, signing, RPC, or blockchain connectivity.