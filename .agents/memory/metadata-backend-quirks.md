---
name: Metadata backend toolchain quirks
description: Workspace-specific Express 5 request validation and Drizzle migration generation behavior.
---

Express 5 exposes `request.query` through a getter, so validated/transformed
query data must be stored on an explicit request field rather than assigning
back to `request.query`.

**Why:** Direct assignment throws at runtime and turns otherwise valid metadata
batch requests into sanitized 500 responses.

**How to apply:** Keep parsed query/params/body values on validated request
properties and have route handlers consume those values.

Drizzle Kit in this workspace expects migration `out` to be a package-relative
path such as `./migrations`; an absolute path built from `__dirname` is
prefixed again and fails during generation.

**Why:** The configured Drizzle Kit version resolves `out` relative to its
working directory even when the config supplies an absolute-looking path.

**How to apply:** Keep the schema path absolute if needed, but use
`out: "./migrations"` for the existing `lib/db` package.