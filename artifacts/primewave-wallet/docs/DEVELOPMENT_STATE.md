# Development State

## Current phase

**Phase 0A — foundation only**

## Completed work

- Created a lightweight Expo and TypeScript mobile application.
- Added a centralized PrimeWave Wallet theme with dark surfaces, gradients,
  typography, spacing, radii, shadows, and component states.
- Added a single foundation screen with no fake balances, addresses,
  transactions, or blockchain claims.
- Added generic EVM network interfaces and an intentionally unconfigured
  PrimeWave Chain primary-network entry.
- Added the non-custodial security architecture document.
- Added application architecture and development-state documentation.
- Added reserved modules for future wallet, security, blockchain, network,
  token, transaction, portfolio, swap, and DApp work.

## Pending work

- No wallet functionality is approved or implemented yet.
- Production PrimeWave Chain configuration must be supplied and reviewed.
- Security review is required before local wallet creation, import, or signing.

## Important architectural decisions

- The mobile app remains independently capable of existing without a PrimeWave
  backend.
- Production network values are not invented in this phase.
- Wallet secrets must remain device-local and must never be sent to backend
  infrastructure.
- The first screen is intentionally an honest foundation state, not a wallet
  simulation.

## Known limitations

- No wallet generation, import, cryptography, vault, authentication, or signing.
- No blockchain RPC, indexer, price service, database, notification service, or
  DApp connection.
- The PrimeWave Chain entry has null chain and endpoint values by design.

## Next recommended phase

**Phase 1 — local wallet lifecycle**, only after approving the security model,
device storage strategy, recovery UX, and threat model.