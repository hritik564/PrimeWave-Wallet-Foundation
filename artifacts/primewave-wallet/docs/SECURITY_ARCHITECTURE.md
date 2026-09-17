# PrimeWave Wallet Security Architecture

## Non-negotiable invariant

PrimeWave Wallet is strictly non-custodial. User-controlled signing material
must remain under the user's control on the user's device.

The following values must never be transmitted to or stored on PrimeWave
backend infrastructure:

- Seed phrases and mnemonic phrases
- Private keys and raw signing keys
- Wallet passwords and wallet PINs
- Biometric secrets
- Decrypted wallet vaults
- Encryption keys

The future backend must never be responsible for signing user transactions.
Future signing will occur locally on the user's device, with clear user
consent at the point of signing.

## Phase 0A boundary

This phase does not generate, import, encrypt, decrypt, store, transmit, or
sign with any wallet secret. It also does not connect to a production
blockchain RPC, create a backend, or implement authentication.

## Future security review requirements

Before wallet creation or import is implemented, the project must define and
review:

1. Device-local secret storage and lifecycle.
2. Recovery and backup warnings.
3. Screen privacy and sensitive-data redaction.
4. Signing confirmation and transaction intent display.
5. Logging and telemetry rules that exclude secrets.
6. Threat modeling and platform-specific secure storage behavior.