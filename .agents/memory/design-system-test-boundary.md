---
name: Design-system test boundary
description: Keep Node-run design-system contract tests independent from React Native JSX module loading.
---

Token and manifest contract tests should import runtime-neutral design-system
submodules rather than the root barrel when running under Node. The root barrel
also exports React Native JSX primitives and can make the Node/tsx runner try
to parse Expo vector-icon JSX without the app's Babel configuration.

**Why:** The mobile test command uses Node's test runner, while the component
barrel is intended for Metro/Expo. Separating the test imports keeps focused
tests fast and avoids coupling token validation to the native bundler.

**How to apply:** Test tokens, icon maps, motion, and the component manifest via
their direct modules; use Expo/Metro or a configured component test environment
for rendered primitive tests.