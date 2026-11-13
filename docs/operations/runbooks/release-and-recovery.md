# Release and Recovery Runbook

## Scope and current deployment boundary

The GitHub Actions workflow named `deploy` builds and publishes API and web images to GitHub Container Registry. It does not roll images onto a host, run a live health verification, or perform rollback. The production and staging Compose configuration includes an API migration job before the API starts. The selected host's deployment commands and secrets are not stored in this repository, so use the hosting platform's approved release procedure for the host-specific steps.

## Before a release

1. Confirm CI passed for the exact commit being released.
2. Identify the immutable image tag or digest for that commit. Do not use a mutable tag as the only record of what was deployed.
3. Confirm the target environment has the required API/web secrets, database, Redis, RabbitMQ, and TLS configuration.
4. Review new migrations for forward compatibility with the current API and for recovery implications. Confirm the hosting provider's database backup and restore point before a high-risk migration.
5. Verify the same commit and migration path in staging before promoting to production, consistent with the repository's source-branch workflow.

## Deploy

1. Use the hosting platform's approved procedure to select the intended API and web images.
2. Ensure exactly one migration job applies pending migrations before the new API instances serve traffic. The Compose production profile models this ordering; do not use `migrate:dev` for a production database.
3. Complete the host's rollout and wait for its readiness checks. A published image is not proof of a successful deployment.

## Verify

- Confirm the host reports API and web instances healthy and serves the expected image revision.
- Check API, web, database, Redis, and RabbitMQ logs for startup errors and repeated retries.
- Check the host's configured health endpoints, API request errors, database connection pressure, and broker queue age/depth.
- Exercise a low-risk public read and a staging-only authenticated flow appropriate to the release.
- Record the deployed image digests, migration state, verification result, and operator in the release record.

## Recover

1. Stop promotion and identify whether the issue is application-only, infrastructure, or schema-related.
2. For an application-only regression, use the host's approved procedure to redeploy the last known-good immutable image pair. Keep API/web versions compatible.
3. Do not assume a database migration can be reversed by redeploying older code. Follow the reviewed forward-fix or provider restore procedure for schema/data incidents.
4. Preserve logs and broker/backlog state needed for diagnosis. Do not delete persistent volumes or purge queues as a recovery shortcut.
5. Verify health and the affected user flow after recovery, then document the incident and follow-up actions.

## Host-specific details still required

Before this is an executable production runbook, add the actual host deployment command, secret and certificate ownership, database backup/restore steps, alert locations, escalation contacts, and tested rollback procedure. Do not fill these from assumptions.
