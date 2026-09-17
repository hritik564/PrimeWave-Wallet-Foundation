# Development-only preview test mode

`PreviewTestMode` exists only to make the `__DEV__` Replit web preview usable
for UI and navigation testing. It is selected only when `__DEV__` is true and
the runtime has a browser document.

The preview mode does not call `LocalWalletEngine`, `SecureVault`,
`expo-secure-store`, `AuthenticationManager`, biometric APIs, RPC providers,
or signing code. It exposes one fixed public development address and stores
only a versioned preview phase plus a non-secret PIN fingerprint in an
isolated browser-local state key. The preview PIN is a test-state value, not a
wallet credential.

Native iOS and Android builds continue to use the existing SecureStore-backed
wallet and authentication path. Production builds cannot activate this module
because the runtime `__DEV__` boundary is required.