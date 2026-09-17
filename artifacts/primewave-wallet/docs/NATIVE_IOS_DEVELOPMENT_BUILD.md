# Native iOS development-build testing

This project includes a development-only setup for testing the Phase 1B-2
biometric flow on a physical iPhone. It does not add wallet functionality,
production signing, App Store submission, or custodial services.

## What is configured

- `expo-dev-client` is installed at the Expo SDK 57-compatible version.
- `app.json` includes the `expo-dev-client` config plugin.
- `app.json` includes the `expo-local-authentication` config plugin with:

  `Use Face ID to unlock your PrimeWave Wallet.`

- `eas.json` contains only a `development` profile:

  - `developmentClient: true`
  - `distribution: internal`

There is intentionally no production build profile and no App Store
submission configuration.

The app has no checked-in `ios/` directory. The native iOS project should be
generated from this static Expo configuration by the native build environment,
so the Replit preview remains an Expo Go/web development surface.

## Replit limitation

Replit can run the Expo workflow and preview this app through Expo Go, but it
cannot build or install an iOS development build for a physical iPhone.
Expo Go also cannot exercise iOS Face ID. Therefore, a native iOS build
artifact is not produced by this workspace.

## Required user-side step

Use one of these supported native environments:

1. **macOS with Xcode and an Apple development team**
   - Check out or open this project on the Mac.
   - Install the workspace dependencies with pnpm.
   - Generate and install the development build on a connected, trusted iPhone
     using the existing Expo project and the `development` build profile.
   - Let Xcode handle the development provisioning for the device.

2. **An approved cloud native-build service**
   - Select the iOS `development` profile from `eas.json`.
   - Complete the provider's Apple development signing setup.
   - Install the resulting internal development build on the physical iPhone.

The build must be installed as a development client, not opened in Expo Go.
After installation, connect the development client to a reachable Metro
server from the development environment. The Replit workflow can continue to
serve JavaScript, but the custom native client and Metro endpoint must be
network-reachable from the iPhone.

## Face ID validation checklist

After the development build is installed:

1. Create or import a wallet and configure the six-digit PIN.
2. Enable biometric unlock using the current PIN.
3. Confirm iOS displays:
   `Use Face ID to unlock your PrimeWave Wallet.`
4. Verify successful Face ID unlock.
5. Verify cancellation and rejection return to the locked state and keep PIN
   fallback available.
6. Verify biometric lockout returns to the locked state.
7. Background the app while the Face ID prompt is active and confirm the
   wallet does not become unlocked while backgrounded.
8. Reopen the app and verify PIN fallback still works.
9. Force-close and reopen the app to confirm the secure lock behavior.

This checklist validates only Phase 1B-2 authentication behavior. It does not
authorize transactions, add blockchain operations, or change the
non-custodial security boundary.