# WaveX notification infrastructure

Phase 8.6 provides the server-side notification boundary only. It does not
send production push notifications and does not modify the Expo wallet.

## Architecture

The event source, typed event model, preference evaluation, event repository,
delivery queue, and provider adapter are separate. Future Phase 8.4
synchronization or other approved sources may call `NotificationService` with
public event data. They do not call a push SDK directly.

Supported event types:

- `transaction_confirmed`
- `transaction_reverted`
- `incoming_transaction`
- `swap_completed`
- `security_event`

Event generation is not automatically wired to every indexer or
synchronization record in this phase. Synthetic deterministic events are used
in tests.

## Device and preference boundary

Every device registration and preference record is scoped by
`networkId + chainId + accountAddress`. Device identity is an installation
identifier, not an account-ownership proof. Registration never grants signing
authority.

Preference defaults are all `false`:

- transaction confirmations
- incoming transactions
- transaction failures/reverts
- swaps
- security/session events

The API never returns `pushToken` or `deviceIdentifier`. Tokens are treated as
sensitive infrastructure identifiers and are not logged, included in event
payloads, analytics, or error messages.

## Idempotency and delivery

Transaction events use:

```text
networkId + transactionHash + notificationType + account
```

Incoming transfer events additionally include `logIndex` when present.
Security events require an explicit source deduplication component. The
database uniqueness constraint and repository check both enforce idempotency.

Queue records use `pending`, `sending`, `sent`, `delivered`, `failed`,
`disabled`, and `expired`. A provider result is not treated as delivered
unless the provider explicitly reports delivery. Retryable failures use a
bounded backoff and maximum attempts; invalid tokens, disabled registrations,
malformed requests, and missing provider configuration are permanent for that
delivery.

The repository has PostgreSQL/Drizzle and in-memory implementations. There is
no continuously running worker in Phase 8.6. Delivery processing is an
explicit service operation and can use `DeterministicMockNotificationProvider`
in tests. `UnconfiguredNotificationProvider` reports configuration absence
instead of fabricating success.

## Security and privacy

Notification data contains public blockchain/application information only.
It must never contain seed phrases, private keys, PINs, SecureStore/vault
contents, encryption keys, signing capabilities, raw signed transactions,
authentication credentials, provider keys, or database credentials. Full
blockchain transaction objects and raw calldata are outside this boundary.

The existing request pipeline provides request IDs, validation, body limits,
rate limiting, secret-material rejection, security headers, and sanitized
errors. Notification API responses are account-scoped and omit internal
provider and queue details. No public arbitrary-send endpoint exists.

Mobile push permissions, Expo/APNs/FCM integrations, notification UI,
analytics, price alerts, arbitrary messaging, production workers, and
automatic event generation remain deferred.