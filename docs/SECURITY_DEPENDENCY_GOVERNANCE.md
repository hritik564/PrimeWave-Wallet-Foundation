# Security dependency governance

This repository treats the committed `pnpm-lock.yaml` as the reproducible
dependency graph. Dependency changes must update the relevant package manifest
or workspace override and the lockfile together; hand-editing resolved package
versions is not an accepted remediation.

Before a production release:

1. Review direct and transitive dependency changes and their runtime/build
   classification.
2. Run the read-only dependency vulnerability audit and record unresolved
   advisories with their dependency path, affected scope, and compatibility
   decision. The audit must not automatically update packages.
3. Generate the deterministic dependency inventory with
   `pnpm run security:sbom` and retain it with the release evidence.
4. Confirm package provenance, lockfile integrity, minimum release-age policy,
   and the review status of any package override.
5. Do not treat a temporarily unavailable external vulnerability database as a
   reason to break normal development; resolve the audit status before
   production release instead.

The current advisories are intentionally isolated rather than addressed by
unrelated toolchain upgrades. `decode-uri-component` is overridden to the
compatible maintained `0.5.0` release for the Expo `query-string` path.
`uuid@7.0.3` is remediated only on the build-only
`xcode@3.0.1` path with `uuid@11.1.1`; xcode uses the compatible `uuid.v4()`
API, while the affected v3/v5/v6 buffer APIs are not used. No WaveX
production runtime source imports uuid, and the Expo/React Native toolchain
was not upgraded.