# WaveX API foundation

This service is the server-side information/support boundary for WaveX. It is
not a wallet, custody service, signer, broadcaster, or recovery service.

## Current endpoints

Infrastructure endpoints:

- `GET /api/v1/healthz` — application process health.
- `GET /api/v1/readyz` — safe readiness status and dependency configuration
  state.
- `GET /api/v1/version` — API namespace identification.

Public metadata endpoints:

- `GET /api/v1/metadata/networks` — safe public network metadata. RPC URLs and
  credentials are never returned.
- `GET /api/v1/metadata/tokens/:networkId/:contractAddress` — one bounded
  public ERC-20 metadata record.
- `GET /api/v1/metadata/tokens?networkId=<id>&addresses=<csv>` — a bounded
  batch of at most 50 token identities.

Indexer status:

- `GET /api/v1/indexing/status` — sanitized read-only indexing configuration,
  cursor, progress, and error status. There is no public start-indexing
  endpoint.

Token identity is always the normalized pair
`networkId + contractAddress`. Missing records return explicit `unavailable`
metadata rather than invented names, symbols, decimals, logos, or verification.

`GET /api/healthz` remains as a compatibility path for the existing Replit
workflow startup probe. It is not a second API version.

## Configuration

Configuration is loaded in `src/config.ts` and is environment-specific:

- `NODE_ENV` — `development`, `test`, or `production`.
- `PORT` — server port.
- `DATABASE_URL` — PostgreSQL URL; required in production and never returned by
  an endpoint.
- `CORS_ALLOWED_ORIGINS` — comma-separated explicit browser origins. Do not use
  a wildcard for production.
- `REQUEST_BODY_LIMIT` — bounded Express JSON body limit; defaults to `64kb`.
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` — documented,
  in-memory foundation defaults of 60 seconds and 120 requests.
- `LOG_LEVEL` — supported Pino log level.
- `SEPOLIA_RPC_URL` — server-only configuration presence marker. Its value is
  never returned by metadata endpoints.
- `INDEXER_ENABLED` — enables the manually invoked indexing service boundary;
  it does not start a worker. Defaults to `true`.
- `INDEXER_<NETWORK_ID>_RPC_URL` — HTTPS RPC endpoint configuration for a
  supported network, for example `INDEXER_ETHEREUM_SEPOLIA_RPC_URL`.
  `SEPOLIA_RPC_URL` is used for `ethereum-sepolia` when its indexer-specific
  variable is absent.
- `INDEXER_RPC_TIMEOUT_MS` and the `INDEXER_MAX_*` variables — bounded
  provider-response and block-range limits. See `src/config.ts` for defaults.

No backend secret is placed in Expo public configuration. No credentials are
invented in this repository.

## Boundaries

The request pipeline assigns request IDs, applies security headers, explicit
CORS, JSON/body limits, rate limiting, secret-material rejection, and
sanitized errors. Prohibited secret-shaped fields are rejected before any
future persistence boundary can receive the request. Request bodies are never
logged wholesale.

The authentication interfaces are intentionally deferred. User/application
authentication, wallet ownership, public blockchain address ownership, and
transaction signing authorization are separate concepts. Server authentication
must never grant or imply local signing permission.

The existing `@workspace/db` package remains the PostgreSQL/Drizzle
foundation. Phase 8.2 adds only `public_network_metadata` and
`public_token_metadata`, with bounded fields and a composite unique token
identity constraint. Phase 8.3 adds `indexer_state`, `indexed_blocks`,
`indexed_transactions`, `indexed_logs`, and `indexed_token_transfers`. The
migrations are generated under `lib/db/migrations`.

## Metadata model

Token metadata keeps these concepts separate:

- metadata availability: `available`, `partial`, `invalid`, `unavailable`
- provenance: verified provider, user-provided, registry, or unavailable
- verification: unverified, pending, verified, or rejected
- discovery: not discovered, user declared, or observed
- visibility and trust status
- freshness: fresh, cached, stale, or unavailable

A logo is a bounded reference with its own provenance. The server does not
download arbitrary remote images and has no remote image proxy.

Network metadata preserves the existing registry concepts. PrimeWave remains a
placeholder with no invented chain ID, RPC endpoint, or explorer URL. Public
RPC URLs are not returned by the API.

If the metadata database is unavailable, network metadata falls back to the
safe catalog and token requests return explicit unavailable records. The mobile
wallet remains local-first and does not require this backend for creation,
recovery, authentication, signing, or broadcasting.

## Phase 8.3 indexing foundation

The indexer is separated into read-only RPC access, observation, normalization,
validation, and persistence:

```text
configured RPC
  -> chain ID verification
  -> bounded block/log observation
  -> strict normalization and ERC-20 Transfer decoding
  -> transactional, idempotent persistence
  -> future activity synchronization
```

Only configured server-side RPC URLs are used. RPC credentials are never
stored in database rows or returned by the API. The RPC client exposes only
the read methods needed by the observer and has no raw-RPC proxy.

Manual execution is available through the service boundary for tests and future
administrative orchestration, but no public start endpoint or infinite worker
was added. The public status endpoint exposes only network identity,
configuration presence, cursor progress, safe status values, and bounded error
metadata.

The cursor advances only after a bounded range is normalized and persisted.
Block number/hash/parent relationships are checked, chain IDs are verified
against configuration, and parent discontinuities enter `reorg_detected`
without advancing the successful cursor. Deep reorg reconciliation remains
deferred.

Indexed logs use network identity plus transaction hash and log index.
Recognized ERC-20 Transfer events retain exact integer amounts as decimal
strings. Token metadata is referenced conceptually through the existing
`networkId + canonical contractAddress` identity; verification and trust are
not copied into indexing records.

## Phase 8.4 transaction synchronization and reconciliation

Phase 8.4 consumes Phase 8.3 indexed rows without creating a second mobile
Activity database or confirmation engine. The mobile Activity system remains
authoritative for local intent, authorization, signing lifecycle, broadcast
lifecycle, and local presentation. The backend is authoritative only for
indexed public transaction evidence.

Synchronization is scoped by `networkId + chainId + canonical accountAddress`.
Transaction identity is `networkId + transactionHash`; ERC-20 Transfer
identity is `networkId + transactionHash + logIndex`. Amounts, timestamps,
recipients, and token names are supporting data only and never merge records.
The states `local_only`, `indexed`, `matched`, `confirmed`, `reverted`,
`unknown`, `conflict`, and `unresolved` remain distinct.

Bounded routes:

- `GET /api/v1/synchronization/status`
- `GET /api/v1/synchronization/activity`
- `GET /api/v1/synchronization/reconciliation`
- `POST /api/v1/synchronization/checkpoint`

The checkpoint route reads only already-indexed block coverage. It never calls
RPC, starts indexing, signs, broadcasts, or performs unlimited historical
scanning. Pages, ranges, request bodies, and errors are bounded; the existing
rate limiter and secret-material guard apply. No mobile Activity UI
integration is included in Phase 8.4.