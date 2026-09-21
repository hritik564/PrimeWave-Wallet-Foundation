# DApp core — Phase 7.1

This module defines a provider-neutral architecture for future Web3
connections. It contains no UI, transport implementation, WalletConnect SDK,
deep links, QR pairing, backend API, persistence, message signing, transaction
signing, or broadcasting.

## Trust boundary

DApp metadata, session data, and request payloads are untrusted public input.
They are validated for shape, size, URL safety, account scope, network scope,
and lifecycle state. A DApp name, icon, URL, origin, or provider identifier is
not proof of trust.

The models never contain private keys, recovery phrases, PINs, secure-vault
values, or raw signing handles. The module does not import secure storage or
the local wallet engine.

## Sessions and permissions

`DAppSession` is explicitly scoped to a session ID, DApp identity, account,
public wallet address, network, and chain. `InMemoryDAppSessionRepository`
provides bounded, deterministic, account/network-isolated storage. Sessions
are not persisted yet.

Connection and authorization are separate. An active session may have account
or network access without having message-signing or transaction-signing
permission. Permissions are explicit, account-scoped, network-scoped where
appropriate, revocable, inspectable, and never granted automatically.

## Requests and lifecycle

The request models cover connect, disconnect, account access, network
information, message signing, typed data, transaction intent, and chain
requests. Transaction requests contain only public intent and must remain on
the existing path:

```text
DApp request
  → validation and context binding
  → future WaveX transaction review
  → existing construction
  → explicit user authorization
  → existing local signing
  → existing broadcast/confirmation
```

There is no shortcut from a DApp request to a raw signer or broadcast method.
Typed-data payloads remain exact provider-supplied strings and are not parsed or
rewritten by this layer.

`DAppRequestService` keeps the provider-neutral lifecycle explicit:

```text
created → pending → approved → completed
                   ├→ rejected
                   ├→ failed
                   └→ expired
```

User rejection, validation failure, expiry, disconnect, unsupported requests,
account mismatch, and network mismatch remain distinguishable errors/states.

## Provider boundary

`DAppTransport` is an interface only. A future transport can translate
provider-specific messages at the edge without leaking provider concepts into
the wallet core. WalletConnect pairing, namespaces, relays, deep links, and
approvals are intentionally deferred to a later reviewed phase.

## Network requests

Chain requests preserve requested chain, active chain, session-approved chains,
and configured/enabled state. This phase never changes the active
`NetworkRegistry` selection and never silently switches networks.