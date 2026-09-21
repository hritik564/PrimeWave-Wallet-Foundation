# Database migrations

This directory is the migration boundary for the existing PostgreSQL/Drizzle
package. Phase 8.1 adds no application tables: the backend has no persistence
model for wallet secrets, signing material, authentication secrets, or vault
contents, and it does not create speculative Phase 8 feature tables.

When a later phase introduces an approved public-data schema, generate and
review a migration with the existing `lib/db/drizzle.config.ts` configuration.
The `DATABASE_URL` value is supplied by the server environment and is never
exposed to the mobile client.