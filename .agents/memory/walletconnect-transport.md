---
name: WalletConnect React Native transport
description: Durable constraints for the wallet-side Reown WalletKit integration.
---

Use the official wallet-side React Native path with `@reown/walletkit` and
`@walletconnect/react-native-compat`, importing the compatibility module before
Reown/WalletConnect runtime imports. Expo also needs the documented public
polyfill/native support packages and a native development build for pairing and
deep-link validation.

**Why:** The React Native package path differs from web WalletConnect usage, and
the SDK's default storage would outlive the provider instance. This wallet
keeps protocol/session state session-scoped by supplying explicit in-memory
storage to `Core`.

**How to apply:** Keep provider-specific types and runtime imports under the
WalletConnect adapter. Translate only public proposal/session data into the
provider-neutral DApp models, leave proposals pending without an explicit
authorization boundary, and re-verify package versions against official docs
before future upgrades.