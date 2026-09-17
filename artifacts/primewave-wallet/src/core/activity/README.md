# Activity / transaction history architecture

Phase 5.1 provides a UI-independent public transaction activity model,
repository, lifecycle service, and read model. It does not build the Activity
screen, transaction detail UI, backend indexing, external indexers,
notifications, analytics, or cloud persistence.

Records are scoped by `accountId`, `networkId`, and exact `chainId`. A local
record uses a generated `localTransactionId` before a blockchain hash exists.
Once a hash is available, the same record associates it with the scoped
network/hash identity. Blockchain-discovered records may omit the local ID
but must have a scoped hash.

The lifecycle preserves `draft`, `signed`, `broadcasting`, `broadcasted`,
`confirming`, `confirmed`, `reverted`, `failed`, and `unknown` as distinct
states. `ActivityService` consumes the existing signing, broadcast, and
confirmation results; it does not broadcast, poll receipts, access secrets,
or create a second transaction engine. Unknown outcomes remain unknown until
an explicit future reconciliation updates the record.

`InMemoryActivityRepository` is the approved Phase 5.1 persistence decision.
It keeps public financial metadata in the current session only. It does not
use AsyncStorage, localStorage, SecureStore, a database, a backend, or an
analytics service.

Reads are bounded to a maximum of 100 records and use deterministic
newest-first ordering. Records with known block context sort ahead of
hash-known pending records, which sort ahead of local-only records. Block
numbers are the primary order when present; observation times are secondary.
No blockchain timestamp is invented.

All quantities remain `bigint` or exact strings. The read model contains
public metadata only: no mnemonic, private key, PIN, biometric credential,
SecureStore value, or signing capability is accepted by this module.