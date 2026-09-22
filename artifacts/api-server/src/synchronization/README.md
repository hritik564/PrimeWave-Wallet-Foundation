# Phase 8.4 synchronization and reconciliation

This module is a bounded, read-only bridge from Phase 8.3 indexed public
observations to a future wallet synchronization client. It does not replace
the mobile `ActivityRepository`, `ActivityService`, `ActivityReadModelService`,
signing lifecycle, broadcast engine, or confirmation engine.

## Scope and identity

Every operation is scoped by the canonical tuple:

```text
networkId + chainId + accountAddress
```

Transaction identity is:

```text
networkId + transactionHash
```

ERC-20 Transfer identity is:

```text
networkId + transactionHash + logIndex
```

Token metadata is not copied into synchronization records. The existing
`networkId + canonical contractAddress` metadata identity remains supplementary
only.

## Matching and states

The service prefers an exact transaction hash. Amount, timestamp, recipient,
asset, or counterparty are never sufficient to merge activity. A local
activity without a hash is `local_only`; a hashed local activity not yet found
in indexed evidence is `unresolved`; a hash match is `matched` unless the
indexed receipt is already `confirmed` or `reverted`. Conflicting local
identities remain `conflict`. Unknown receipt outcomes remain `unknown`.

Indexed-only observations are returned without a local activity ID. The
backend is authoritative only for public blockchain evidence: hash, block
context, receipt status, and indexed timestamp. Local intent and authorization
remain wallet-owned.

## Cursor and bounded historical synchronization

`account_sync_state` stores the account/network cursor, last successful block,
status, synchronization time, and bounded error metadata. A checkpoint only
consumes a range already fully covered by `indexed_blocks`; it never invokes
RPC, starts an indexer, or scans history. Ranges and result pages are bounded
by the existing indexer limits. Repeated checkpoints are idempotent through
database identities and conflict-safe updates.

## API

All routes are under `/api/v1` (the `/api` compatibility mount is also
available):

- `GET /synchronization/status` — scoped cursor/status.
- `GET /synchronization/activity` — bounded indexed transactions and ERC-20
  transfers for an explicit block range and page.
- `GET /synchronization/reconciliation` — bounded reconciliation identities,
  states, and evidence for the same range.
- `POST /synchronization/checkpoint` — consume an explicit bounded,
  already-indexed range and advance the account cursor.

The routes accept public identifiers only. They do not accept local wallet
secrets, raw signed transactions, arbitrary SQL, arbitrary RPC methods, or
unbounded history requests. Existing request validation, secret-material
rejection, rate limiting, and sanitized error handling apply.

## Privacy and deletion

Public blockchain observations are not deleted when a local wallet record is
removed. Application-owned synchronization state and reconciliation metadata
are separate and can be deleted by a future authenticated account-management
operation. This phase does not introduce wallet authentication or a public
address ownership claim, so it does not expose a deletion endpoint or pretend
that a public address is an authenticated user.

The provider-neutral `LocalActivityContext` contract contains only public
account scope, a local activity ID, an optional public transaction hash, and a
local lifecycle label. It never contains keys, seed phrases, PINs, vault
contents, SecureStore values, signing capabilities, or raw signed bytes.

## Phase 8.5 market-data separation

The Phase 8.5 price endpoint is a separate public valuation boundary. It does
not alter synchronization identity, state, cursor, or reconciliation behavior.
Market prices never establish token verification, balance, ownership,
confirmation, or trust. Synchronization does not consume prices, and market
data does not become blockchain truth.