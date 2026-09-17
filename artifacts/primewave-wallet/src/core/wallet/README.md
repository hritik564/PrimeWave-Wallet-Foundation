# Wallet core

Future home for wallet lifecycle interfaces and local wallet state. Phase 0A
does not generate wallets, keys, mnemonics, or vaults.

Phase 0B adds `contracts.ts` for the future `WalletEngine` boundary. The UI
must communicate with that boundary rather than accessing security or
cryptographic implementation details directly.