# Architecture Decision Records

This directory records consequential architecture choices and their validation history. Use an ADR when a choice affects multiple domains, data ownership, security, operational reliability, or a long-lived interface.

## Decisions

- [ADR 0001: Modular monolith with enforced layering](0001-modular-monolith-and-enforced-layering.md) — accepted.
- [ADR 0002: Hub-consolidated fulfillment with distance-priced, tracked delivery in Lagos](0002-hub-consolidated-fulfillment-and-lagos-delivery.md) — accepted, not yet implemented.
- [ADR 0003: Independent processes under PM2, an asynchronous audit pipeline and Temporal for durable workflows](0003-process-model-audit-pipeline-and-durable-workflows.md) — proposed, not yet implemented.
- [ADR 0004: Operational safety and environment parity](0004-operational-safety-and-environment-parity.md) — accepted; implemented on the release branch, not yet merged or deployed.

The [template](0000-template.md) is available for new decisions.

## Writing and lifecycle

- Record the context, constraints, decision, alternatives, consequences, and validation/revisit trigger.
- Use `Proposed` while the choice is under review, `Accepted` after the decision, and `Superseded` or `Deprecated` when it no longer governs the system.
- Link the ADR from the owning domain, platform, or scaling guide once it is relevant to implementation.
- Keep implementation status in the source-of-truth guide; an ADR records why a decision was made, not every detail of current behavior.
