---
name: Expo preview timing
description: A transient screenshot timing issue that can occur immediately after restarting the managed Expo workflow.
---

The first preview screenshot immediately after an Expo workflow restart can
capture a blank page even when Metro is healthy and the bundle is compiling.
Wait until the workflow logs show the web bundle has completed, then capture
the preview again.

**Why:** The preview browser can load before the restarted Metro web bundle
has finished attaching to the proxied route; a retry after the bundle log is
present rendered the app normally.

**How to apply:** Treat a blank first capture after a restart as inconclusive.
Check the Expo workflow logs and retry once after a successful `Web Bundled`
message before debugging application code.