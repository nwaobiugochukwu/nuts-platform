# Operations

This directory documents production operations that can be established from repository configuration. Host-specific commands must be supplied by the actual hosting environment; the repository's image-publishing workflow does not perform a host rollout.

## Runbooks

- [Release and recovery](runbooks/release-and-recovery.md) — repository-backed release flow, checks, and recovery boundaries.

## Current automation and known gaps

- CI runs the repository quality gates defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
- The workflow named `deploy` builds and publishes API and web images to GHCR; it does not deploy them to a host or verify a live rollout. See [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).
- The production Compose profile runs a migration job before the API service. The host must provide its environment, TLS files, secrets, and service lifecycle.
- The repository does not currently contain a host-specific backup/restore procedure, a production incident escalation matrix, or a complete operator procedure for replaying failed outbox/broker messages. Those require the selected host/provider and operational ownership.

Do not treat this index as evidence that those external procedures are already configured.
