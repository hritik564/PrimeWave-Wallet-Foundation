# Database migrations

This directory is the migration boundary for the existing PostgreSQL/Drizzle
package. The Phase 8.2 migration adds only public network and public token
metadata tables. It has no persistence model for wallet secrets, signing
material, authentication secrets, or vault contents, and it does not create
speculative indexing, pricing, notification, or transaction tables.

Generate and review migrations with the existing
`lib/db/drizzle.config.ts` configuration. `generate` creates reviewed SQL under
this directory; `migrate` is the explicit application command. The legacy
`push` commands remain development-only helpers and are not a production
migration mechanism.
The `DATABASE_URL` value is supplied by the server environment and is never
exposed to the mobile client.