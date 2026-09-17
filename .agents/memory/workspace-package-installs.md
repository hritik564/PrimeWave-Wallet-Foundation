---
name: Workspace package installs
description: Package installation behavior for the pnpm monorepo's artifact workspaces.
---

When adding a dependency to an artifact, target the artifact workspace explicitly
with the pnpm filter; the generic package helper may attempt to add the package
to the monorepo root and stop at the workspace-root safeguard.

**Why:** The repository has multiple artifact packages, and root-targeted installs
can fail even when the dependency and version are valid for the target app.

**How to apply:** Use the exact workspace package name from the artifact's
`package.json` when installing a package, then verify the artifact package and
workspace lockfile changed as expected.