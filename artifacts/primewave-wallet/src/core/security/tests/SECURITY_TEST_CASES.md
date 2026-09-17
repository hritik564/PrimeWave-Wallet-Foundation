# Future security test cases

These are implementation-gated contract tests, not passing placeholder tests.

## Data handling

- Secrets are never sent over a network.
- Secrets are never written to logs, analytics, crash reports, URLs, or query
  parameters.
- Secrets are never stored in backend infrastructure.
- Complete transaction payloads are not logged when they contain sensitive
  user information.

## Access control

- Unauthorized wallet access is rejected.
- A locked wallet cannot sign.
- Vault access requires authentication.
- Invalid authentication is rejected.
- Malformed encrypted vault state fails safely.
- Corrupted wallet state fails safely.

## Signing

- A transaction cannot sign without explicit confirmation.
- Confirmation displays asset, amount, destination, network, fee, total, and
  transaction type.
- Automatic, silent, and background signing are impossible through the public
  contract.
- Malicious or ambiguous transaction data is rejected or clearly presented.

## Recovery and platform behavior

- Wrong recovery phrases are rejected once recovery exists.
- Sensitive screens request platform-appropriate privacy behavior.
- Sensitive clipboard operations require explicit confirmation.
- RPC failures fail safely without exposing secret material.