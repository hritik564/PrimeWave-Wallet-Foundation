# WaveX privacy-safe analytics

Phase 8.7 adds a minimal provider-neutral analytics boundary. It measures the
product, not the person.

## Privacy model

Analytics uses only a random, non-semantic session identity by default. The
mobile client persists a random installation identifier in ordinary app
storage only to document lifecycle/reset behavior; it sends a session-scoped
identifier and never derives either value from a wallet address, device
hardware identifier, transaction hash, or personal data.

Analytics is separate from wallet/account identity, blockchain indexing,
synchronization, notifications, metadata, market data, and security logs. No
analytics table references an account or blockchain table.

The event allowlist accepts only these product events:

`app_opened`, `onboarding_started`, `onboarding_completed`,
`wallet_created_completed`, `wallet_import_completed`, `screen_viewed`,
`asset_search_used`, `receive_screen_opened`, `send_review_opened`,
`transaction_reviewed`, `transaction_broadcast_started`,
`transaction_completed`, `swap_review_opened`, `swap_completed`,
`dapp_connection_started`, `dapp_connection_completed`, and `settings_opened`.

Properties are event-specific and limited to coarse categories:
screen category, transaction type category, network category, swap provider
category, DApp category, outcome category, and duration bucket. Unknown event
names and properties are rejected. Exact balances, amounts, addresses,
transaction hashes, calldata, signatures, URLs, arbitrary text, push tokens,
credentials, and wallet secrets are prohibited.

## Reliability and retention

Event, error, and performance records have separate bounded retention
configuration. Cleanup is explicit and bounded through
`AnalyticsService.cleanupExpired`; this phase does not start an unbounded
worker. Analytics persistence and provider delivery are independent. A
provider timeout, unavailable server, malformed event, or missing provider
never blocks wallet functionality.

Anonymous ingestion remains intentionally unauthenticated. Admission is
bounded per anonymous installation/session identity, across the active
anonymous-identity set, and globally per abuse window. These controls do not
use wallet addresses, hardware identifiers, or fingerprinting. The limits are
process-local and reset when the API process restarts; a multi-instance
production deployment requires a shared admission/rate-limit service.

`AnalyticsService.cleanupExpired` is a bounded maintenance entry point that
deletes expired events, errors, and performance rows in separate bounded
operations. `ANALYTICS_CLEANUP_ON_STARTUP=true` enables a non-blocking,
best-effort startup invocation, but startup invocation is not a guaranteed
retention scheduler. Production must run this entry point from an existing
controlled maintenance mechanism at an interval appropriate for the configured
retention values.

The deterministic mock provider is test-only. No Firebase, Google Analytics,
Mixpanel, Amplitude, PostHog, Segment, advertising tracker, or production
analytics provider SDK is installed.