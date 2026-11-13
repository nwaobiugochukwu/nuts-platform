# NUTS Documentation

This index separates product behavior, code navigation, shared engineering concepts, runtime operations, measured capacity, and future proposals. Domain guides are the source of truth for feature behavior across the frontend and backend. Current implementation, measured results, and proposals are labeled distinctly.

## Start here

- [Repository overview and quickstart](../README.md)
- [API development guide](../apps/api/README.md)
- [Web development guide](../apps/web/README.md)

## Product behavior and code navigation

- [Business domains](domains/README.md) — end-to-end behavior, problems solved, backend mechanisms, frontend flows, failure cases, trade-offs, and domain-owned scaling directions.
- [Backend module map](reference/backend-module-map.md) — every API module folder mapped to its domain, representative source files, and frontend surfaces.
- [Platform Runtime and Data](platform/runtime-and-data.md) — shared application boundaries, data ownership, database and infrastructure configuration, health checks, API contract publication, and deployable runtime.

## Architecture and engineering reference

- [Architecture diagram gallery](architecture/README.md) — visual views of current boundaries and explicitly proposed paths.
- [Architecture decision records](architecture/adr/README.md) — decision log and template.
- [NUTS Engineering & Distributed Systems Field Manual](engineering/field-manual/README.md) — engineering concepts, concise definitions, NUTS implementation, failure behavior, and trade-offs.
- [Field Manual glossary](engineering/field-manual/glossary.md) — quick definitions with current/proposed NUTS status.

## Operations, performance, and scaling

- [Operations and release guidance](operations/README.md)
- [Performance and Capacity](performance/README.md) — configuration limits, benchmark method, and evidence-backed result record. No concurrency or throughput claim is published without a reproducible benchmark.
- [Scaling Strategy](scaling/README.md) — concurrency, traffic, bottleneck signals, staged actions, and scaling directions for every system area.
- [Analytics at Scale](scaling/analytics-at-scale.md) — options for protecting the commerce database while supporting higher-volume analytics.
- [Recommendation Scaling Plan](scaling/recommendations.md) — a measured progression from deterministic recommendations to optional AI/ML ranking.

## Review snapshots

- [Codebase audit](audits/CODEBASE_AUDIT.md) — a review snapshot; verify findings against current code before acting on them.

## Maintenance

- Update the owning domain guide when implementation changes, and link behavioral claims to source files.
- Keep module names in the code map; keep cross-cutting engineering definitions in the Field Manual; do not duplicate full feature explanations.
- Label current behavior, measured results, and proposals distinctly. A configuration value is not a capacity claim.
- Use an [ADR](architecture/adr/0000-template.md) for consequential architecture choices and record a validation method and revisit trigger.
- CI runs [`scripts/check-doc-links.py`](../scripts/check-doc-links.py) through [the documentation workflow](../.github/workflows/docs.yml). It checks local Markdown targets and heading fragments; it does not test external-link availability or verify the application behavior described by the docs.
