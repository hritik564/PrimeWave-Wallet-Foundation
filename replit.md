# PrimeWave Wallet

PrimeWave Wallet is a mobile-first, strictly non-custodial foundation for the PrimeWave ecosystem.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/primewave-wallet run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Expo, React Native, Expo Router, and TypeScript for the mobile app
- API: Express 5 (reserved for future backend capabilities)
- DB: PostgreSQL + Drizzle ORM (not used by Phase 0A)
- Build: Expo tooling and TypeScript

## Where things live

- `artifacts/primewave-wallet` — Expo mobile application and Phase 0A screen
- `artifacts/primewave-wallet/src/theme/index.ts` — PrimeWave Wallet visual tokens
- `artifacts/primewave-wallet/src/core/networks` — generic EVM network types and unconfigured registry
- `artifacts/primewave-wallet/docs` — architecture, security, and development-state source documents

## Architecture decisions

- The first phase is frontend-only and must not create wallet secrets or connect to production chains.
- PrimeWave Chain is represented as the future primary network, but its production values remain unset.
- The app intentionally uses a single foundation route until wallet flows are approved.

## Product

The current build communicates the PrimeWave Wallet foundation and its non-custodial boundary. Wallet functionality is intentionally deferred.

## User preferences

The product brief requires stopping after Phase 0A and waiting for approval before implementing wallet functionality.

## Gotchas

- Never add seed phrase, private key, PIN, password, biometric secret, decrypted vault, or encryption-key handling without a reviewed security design.
- Never invent PrimeWave production chain values or add a production RPC connection in Phase 0A.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.