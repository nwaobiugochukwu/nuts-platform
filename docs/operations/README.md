# Operations

This directory documents production operations that can be established from repository configuration. Host-specific commands must be supplied by the actual hosting environment; the repository's image-publishing workflow does not perform a host rollout.

## Runbooks

- [Processes, health and monitoring](processes-and-monitoring.md) — API roles under PM2, health endpoints, Prometheus metrics and alerts.
- [Release and recovery](runbooks/release-and-recovery.md) — repository-backed release flow, checks, and recovery boundaries.

## Current automation and known gaps

- CI runs the repository quality gates defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
- The workflow named `deploy` builds and publishes API and web images to GHCR; it does not deploy them to a host or verify a live rollout. It starts only after the CI workflow succeeds on a **push** to `staging` or `main` (a merge), never for a pull request: a PR such as `staging` → `main` has head branch `staging`, and reacting to its CI run used to trigger a second, duplicate publish. CI itself runs twice per change by design: once for the pull request and once after the merge. See [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).
- The production Compose profile runs a migration job before the API service. The host must provide its environment, TLS files, secrets, and service lifecycle.
- The repository does not currently contain a host-specific backup/restore procedure, a production incident escalation matrix, or a complete operator procedure for replaying failed outbox/broker messages. Those require the selected host/provider and operational ownership.

Do not treat this index as evidence that those external procedures are already configured.
