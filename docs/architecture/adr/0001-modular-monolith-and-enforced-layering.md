# ADR 0001: Modular monolith with enforced layering

- **Status:** Accepted
- **Date:** 2026-11-23
- **Owners:** Platform engineering
- **Related code:** [`apps/api/src`](../../../apps/api/src), [`apps/web/src`](../../../apps/web/src), [`scripts/check-architecture.mjs`](../../../scripts/check-architecture.mjs), [Code organization](../code-organization.md)

## Context

NUTS serves customers, vendors and admins from one catalog, one order ledger and one payment flow. The team is small, deployments are a single API and a single web app, and many features cross domains (checkout touches cart, discounts, inventory, payments, wallets and notifications). Over time the web app accumulated overlapping component folders (`components/*` and `components/domain/*`), two folders for the same screen, and `tsconfig` path fallbacks that made `@/components/notification/X` and `@/components/domain/notification/X` both valid. The API had a few lower-layer files importing domain modules.

## Decision

Stay a **modular monolith**: one deployable API process and one web app, with domain modules as the unit of ownership and extraction. Make the structure self-defending:

- Document the layers and dependency direction in [Code organization](../code-organization.md).
- Remove ambiguity: one `@/` alias in the web app, canonical folders only, no re-export shims.
- Enforce the rules in CI with `scripts/check-architecture.mjs`; known legacy violations are listed explicitly and may only shrink.

## Alternatives considered

| Option | Benefits | Costs and risks | Why selected or rejected |
|---|---|---|---|
| Microservices per domain | Independent scaling and deploys | Distributed transactions for checkout and payments, per-service operations, higher cost for a small team | Rejected: the domains share transactional consistency requirements |
| Monolith without enforced boundaries | Fastest short term | Boundaries erode; extraction becomes a rewrite | Rejected: this is what produced the duplicated folders |
| Modular monolith with documentation only | No tooling | Rules drift without a check | Rejected: a check is cheap and catches regressions in review |
| Full feature-slice web app now | Maximal colocation | Large churn across hundreds of files | Deferred: listed under known gaps; the reorganisation tooling is reusable |

## Consequences

- Any domain can be located by name in both apps, and its cross-domain effects flow through events.
- A pull request that breaks a layer rule fails CI.
- Extracting a domain later means moving its module, its tables and its event consumers; the check keeps those seams visible.
- Four lower-layer imports of modules remain as documented exceptions.

## Validation and revisit trigger

Validated by `npm run check:architecture`, type-check, lint, unit tests and a production web build after the reorganisation. Revisit when a single module needs independent scaling, when the exception list stops shrinking, or when web feature code needs hooks and API clients colocated per feature.
