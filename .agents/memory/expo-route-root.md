---
name: Expo route root
description: The PrimeWave Wallet Expo artifact resolves routes from src/app rather than the legacy app directory.
---

The PrimeWave Wallet Expo scaffold uses `src/app` as the Expo Router root. New routes and layouts must be created there; files under a top-level `app` directory are not served.

**Why:** Metro reported the active root as `src/app`, and the app showed Expo's starter screen until the routes were moved.

**How to apply:** When adding or changing PrimeWave Wallet routes, check `src/app` first and keep the route tree there.