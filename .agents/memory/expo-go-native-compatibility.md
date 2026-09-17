---
name: Expo Go native compatibility
description: PrimeWave Wallet startup constraints for running through the managed Expo Go client.
---

PrimeWave Wallet must start in the managed Expo Go client without requiring a
custom development build. Avoid mounting optional native modules during root
layout initialization when an Expo Go-safe React Native primitive can provide
the same behavior.

**Why:** A native bundle can download successfully while Expo Go closes during
startup if a module is absent from the client binary; Metro logs do not
necessarily show that device-side crash.

**How to apply:** Keep the root layout and initial screen on Expo Go-compatible
imports. Treat physical iOS and Android Expo Go launch as a required validation
step after changing native dependencies.