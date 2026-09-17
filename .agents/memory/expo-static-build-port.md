---
name: Expo static build port
description: Shared Metro port behavior when validating the Expo artifact's static build.
---

The static Expo build script checks and starts Metro on port 8081. If another
artifact workflow already owns that port, Expo enters a non-interactive port
prompt and the build fails before bundling.

**Why:** The failure is an environment/workflow collision, not an application
bundle error; the normal Expo preview workflow can still be healthy on its
managed port.

**How to apply:** Temporarily stop the competing Metro workflow, run the static
build, and restart the workflow afterward. Do not change product routing just
to work around the shared build port.