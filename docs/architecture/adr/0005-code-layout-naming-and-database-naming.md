# ADR 0005: Code layout, naming, and database naming

- **Status:** Accepted; implemented and enforced by the architecture check.
- **Date:** 2026-11-27
- **Owners:** Platform engineering
- **Related code:** [`check-architecture.mjs`](../../../scripts/check-architecture.mjs), [`architecture-layout-rules.mjs`](../../../scripts/architecture-layout-rules.mjs), [`app.module.ts`](../../../apps/api/src/app.module.ts)
- **Related:** the audit and the full standard are in [event-driven-and-resilience-audit.md](../event-driven-and-resilience-audit.md), section 6.

## Context

The API had grown by accretion. Consumers sat in four different places; the audit feature lived in `common` and was aliased to a folder that did not exist; five families of path aliases hid old folder names; `modules/admin` grouped three unrelated domains by audience while every other module grouped by domain; some modules kept services at the root and others in folders; file kinds were inconsistent (`cron` next to `job`, `type` next to `types`, `response` next to `dto`, 32 files with no kind). Nothing stopped it drifting again.

## Decision

1. **Group by business domain first, by kind of file second, and keep technical plumbing separate.**
   - `modules/<domain>/` holds one business domain: its `*.module.ts` files and only the standard folders (`controllers`, `services`, `dto`, `consumers`, `events`, `jobs`, `listeners`, `guards`, `decorators`, `interceptors`, `strategies`, `middleware`, `templates`, `constants`, `types`, `utils`, `mappers`, `pipes`, `throttler`). Every file goes in the folder for its kind, wherever it came from.
   - `infrastructure/` is technical adapters only, grouped by purpose: `database`, `cache`, `messaging` (`rabbitmq`, `outbox`, `events`), `storage`, `observability` (`metrics`, `health`), `resilience`, `workflows`, `mail`.
   - `common/` is generic code that knows nothing about the business. `config/` holds environment and process-role code. `bootstrap/` holds start-up concerns that compose the application and may use any layer (instrumentation, environment loading, Swagger, process-error handlers, cache warm-up).
   - `common` and `infrastructure` never import `modules`. No exceptions.
2. **Names.** Files and folders are kebab-case, `<name>.<kind>.ts`, from a fixed set of kinds. A service, controller, module, consumer, job, listener, guard, interceptor, pipe, filter, middleware or strategy exports a class named after its file (`unpaid-orders.job.ts` exports `UnpaidOrdersJob`; `rabbitmq` is written `RabbitMQ`). Scheduled work is `job`, not `cron`. Entry points and `index.ts` barrels have no kind; test helpers end in `-spec.ts`.
3. **One alias.** `@api/*` is the only internal path alias, in the compiler, the runtime config PM2 uses and Jest.
4. **Domains.** Authentication for customers, vendors and administrators lives in `auth`. The old `admin` module is split into `staff`, `platform` and `announcements`. Token and account-lock services stay in `security`: they are primitives that `auth` builds on, and moving them would make `security` depend on `auth`.
5. **Database naming.** Tables and columns created from now on are `snake_case`, tables plural, columns mapped with `@map`. Existing tables and columns are **not** renamed. The database holds 281 camelCase columns against 46 snake_case ones (three tables use both); renaming them would be a large, risky migration touching every query for no functional gain.
6. **Enforcement.** The architecture check (a CI job) fails on a file without an allowed kind, a class that does not match its file, a module with a non-standard folder or a file at its root, a consumer outside `consumers/`, a removed alias, or a lower layer importing modules. The rules are plain functions with their own tests.

## Consequences

- A new developer can find any file by its kind and domain, and the layout cannot drift back without CI saying so.
- The move was mechanical (a script resolved every import and rewrote documentation and check references); behaviour did not change, which was verified each step by the tests and by comparing the API's full route set (269 routes) before and after.
- The two remaining naming gaps are the mixed database column naming (decision 5) and very large service files, which are split during the money-code work, not here.
- Adding a kind or a module folder is a deliberate edit to `architecture-layout-rules.mjs`, reviewed like any other change.

## Alternatives considered

- **Leave the layout alone and document it.** Rejected: documentation does not stop drift, and the layout was already contradicting its own docs.
- **Group by audience (admin, vendor, customer) at the top level.** Rejected: it spreads one domain (orders, products) across three places and makes business rules harder to find. Audience is expressed as a prefix on controllers, DTOs and services inside the domain.
- **Rename every existing database column to `snake_case`.** Rejected for now (decision 5).
- **Barrel files for every module as the only way to import across modules.** Deferred: the check forbids reaching into another module's controllers, jobs, consumers and listeners, which removes the worst coupling without a barrel in every module.
