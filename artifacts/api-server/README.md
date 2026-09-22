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
identity constraint. The migration is generated under `lib/db/migrations`.

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