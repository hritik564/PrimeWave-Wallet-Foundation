# DApp core — Phases 7.1–7.3

This module defines the provider-neutral architecture and approval boundary for
Web3 connections. WalletConnect-specific SDK code remains isolated under
`providers/walletconnect`; the app UI consumes the provider-neutral proposal
model and explicit approval actions.

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

`DAppTransport` translates provider-specific messages at the edge without
leaking provider concepts into the wallet core. The WalletConnect/Reown
adapter handles pairing, namespaces, proposal lifecycle, explicit approval,
rejection, session updates, expiry, and disconnects. The approval UI never
constructs raw provider namespaces or calls the SDK directly.

## Connection approval UI

Phase 7.3 presents a real proposal only after the Phase 7.2 adapter emits it.
The screen shows untrusted DApp metadata, a deterministic icon fallback,
public account context, every validated requested network, and human-readable
capabilities. Metadata is never presented as verified.

Connect and Reject are separate explicit actions. Connect performs a final
expiry, identity, account, active-network, and configured-network checkpoint
before calling the adapter's authorization boundary. A changed account or
network produces a stale state instead of approving the old proposal.

Preview Test Mode does not create DApp proposals, sessions, or approval
results. Real WalletConnect validation requires a native development build,
configured public WalletConnect project ID, and physical-device/deep-link
testing. This phase does not claim that native-device validation has been
performed.

The connected state is intentionally lightweight and supports disconnecting
through the existing adapter boundary. Message signing, typed-data signing,
transaction execution, broadcasting, automatic network switching, and DApp
management are deferred.

## Network requests

Chain requests preserve requested chain, active chain, session-approved chains,
and configured/enabled state. This phase never changes the active
`NetworkRegistry` selection and never silently switches networks.