# Database migrations

This directory is the migration boundary for the existing PostgreSQL/Drizzle
package. Phase 8.2 adds public network/token metadata and Phase 8.3 adds only
the read-only indexing foundation tables. There is no persistence model for
wallet secrets, signing material, authentication secrets, or vault contents,
pricing, swap, DApp, or mobile activity data. Phase 8.6 adds only
provider-neutral notification operational tables; push tokens are scoped
device infrastructure identifiers and no wallet secrets are stored. Phase 8.7
adds separate privacy-safe analytics event, error, and performance tables with
bounded expiry and no account or blockchain foreign keys.

Generate and review migrations with the existing
`lib/db/drizzle.config.ts` configuration. `generate` creates reviewed SQL under
this directory; `migrate` is the explicit application command. The legacy
`push` commands remain development-only helpers and are not a production
migration mechanism.
The `DATABASE_URL` value is supplied by the server environment and is never
exposed to the mobile client.