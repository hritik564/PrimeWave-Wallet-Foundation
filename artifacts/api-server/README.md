# WaveX API foundation

This service is the server-side information/support boundary for WaveX. It is
not a wallet, custody service, signer, broadcaster, or recovery service.

## Current endpoints

Only infrastructure endpoints are enabled:

- `GET /api/v1/healthz` — application process health.
- `GET /api/v1/readyz` — safe readiness status and dependency configuration
  state.
- `GET /api/v1/version` — API namespace identification.

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
foundation. Phase 8.1 adds no database tables or migrations.