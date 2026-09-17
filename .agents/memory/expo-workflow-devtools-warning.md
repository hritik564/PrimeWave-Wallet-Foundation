---
name: Expo workflow DevTools warning
description: Non-fatal React Native DevTools installation warning observed in the managed Expo workflow.
---

The managed Expo workflow can report that React Native DevTools cannot load because
`libglib-2.0.so.0` is unavailable in the environment. Metro can still start and
the Expo web bundle can complete successfully.

**Why:** This is an environment-level optional tooling warning, not an application
bundle failure.

**How to apply:** Treat the workflow as healthy when it reaches the Metro/Web
bundle output and remains running; investigate it separately only if DevTools
itself is required.