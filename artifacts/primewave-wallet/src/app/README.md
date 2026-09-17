# App layer

Expo Router owns the runtime route tree in `app/`. This folder is reserved for
future application-level providers and composition that should not live in a
screen.

The authenticated route renders the WaveX Home shell from
`src/components/WalletHomeShell.tsx`. Home requests public account data through
`PortfolioReadModelService`; it does not call RPC, transaction, wallet-secret,
or persistence APIs directly. Assets is the second implemented destination and
uses the same read-model result as Home for local search, visibility filtering,
and public asset presentation. Swap, Activity, and Settings remain navigation
placeholders until their controlled phases. Receive is a public
address/QR/copy/share surface only; it uses the same account and selected
network context and has no transaction authority or secret access.