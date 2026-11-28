# Code Organization and Dependency Rules

NUTS is a **modular monolith in an npm-workspaces monorepo**: one deployable API process and one deployable web app, split internally into domain modules with explicit boundaries. The goal is that any feature can be found by its domain name, can be changed without reading unrelated code, and could later be extracted into a service by following its existing boundary. The rules below are enforced by [`scripts/check-architecture.mjs`](../../scripts/check-architecture.mjs) (`npm run check:architecture`, run in CI). The reasoning is recorded in [ADR 0001](adr/0001-modular-monolith-and-enforced-layering.md).

## Repository layout

| Path | Responsibility |
|---|---|
| `apps/api` | NestJS API (one process). Domain modules over shared infrastructure. |
| `apps/web` | Next.js App Router app: customer storefront, vendor portal, admin portal. |
| `packages/database` | Prisma schema, ordered migrations, seed scripts. The only owner of the data model. |
| `nginx`, `docker-compose*.yml`, `apps/*/Dockerfile` | Runtime and deployment. |
| `scripts` | Repository tooling (doc link check, architecture check, postinstall). |
| `docs` | Documentation; see the [index](../README.md). |

## API (`apps/api/src`)

```text
modules/<domain>/        one folder per business domain
  <domain>.module.ts       Nest wiring; the only file other modules import to depend on this module
  <domain>.service.ts      business logic (provider shared with other modules)
  controllers/             HTTP surface (public, vendor, admin variants live side by side)
  dto/                     request/response contracts (shared as types)
  jobs/ consumers/ listeners/   scheduled work and event handlers owned by the domain
  constants/ types/        domain-private unless re-exported deliberately
common/                  cross-cutting building blocks with no domain knowledge
infrastructure/          Prisma, Redis/cache, RabbitMQ, outbox, mail, media, config, resiliency
```

Dependency direction is one-way: `modules → common → infrastructure`. Rules:

1. **Lower layers do not import modules.** `common/` and `infrastructure/` must not import `@api/modules/*`. Four guards/decorators/middleware still do (maintenance mode, registrations, OTP); they are listed as legacy exceptions in the check script and the list may only shrink. The target fix is to move the lookup behind an interface owned by `common/`.
2. **Modules share providers, not internals.** A module may inject another module's exported service and use its DTOs and constants. It must not import another module's `controllers/` or `jobs/`.
3. **The database is shared but ownership is not.** Each table is written by one module's services; other modules call that module instead of writing its tables.
4. **Cross-domain side effects go through events** (transactional outbox, then RabbitMQ), so the emitting module does not depend on its consumers. See [Notifications and Asynchronous Delivery](../domains/notifications-and-async-delivery.md).
5. **Naming:** `kebab-case` folders and files; `<thing>.service.ts`, `<thing>.controller.ts`, `<thing>.module.ts`, `<thing>.spec.ts` next to the code under test. The module folder is plural (`wallets`) and file prefixes are singular for the aggregate they manage (`wallet.service.ts`); keep that convention for new modules.

## Web (`apps/web/src`)

```text
app/                 routes only: layouts, pages, loading/error boundaries, route handlers
components/
  ui/                design-system primitives (button, dialog, input, card...)
  form/              react-hook-form field components and uploaders
  data/              DataTable, management toolbar
  feedback/          loaders, skeletons, route progress and error views
  modal/             confirm/OTP prompts built on ui/dialog
  navigation/        link and routing helpers
  theme/             theme toggle and selector
  layout/            app shells: storefront navbar/footer/bottom nav, vendor and admin panel shell
  domain/<feature>/  feature components: auth, cart, category, home, maintenance,
                     notification, order, payments, product, promotions, review,
                     search, vendor, voucher, wishlist, analytics
api/
  core/              HTTP clients, interceptors, token storage, error mapping
  services/          one typed client per backend domain (the browser's view of an API module)
  dto/               request/response types mirrored from the API
  server/            server-only fetch adapters with Next cache options
hooks/               data and behaviour hooks shared by features
zustand/             client session and UI state
lib/                 pure helpers (no React components); unit-tested with node:test
provider/            React providers composed in the root layout
```

Rules:

1. **One import alias: `@/`.** Do not add `paths` fallbacks to `tsconfig.json`; an import must name the real folder (`@/components/domain/notification/NotificationBell`). Relative imports are for files in the same folder or its direct neighbours.
2. **Routes are leaves.** Nothing outside `app/` imports from `app/`. Pages compose feature components; they do not hold business UI.
3. **Shared UI never knows features.** `components/ui|form|data|feedback|modal|navigation|theme` must not import `components/domain` or `app`.
4. **Non-UI layers do not render.** `lib/`, `api/`, `zustand/` and `hooks/` must not import components.
5. **A feature owns its components.** Put a component in `components/domain/<feature>` unless at least two unrelated features use it, then promote it to a shared layer. Layout shells live in `components/layout`.
6. **Server and client API access are different layers.** Server components use `api/server` with the internal API URL; browser code uses `api/services` through `api/core` clients.
7. **Back navigation uses history, not hard-coded parents.** Use `components/navigation/BackLink` (with a fallback href) for any "back to ..." control; `provider/NavigationHistoryTracker` records client navigation and `lib/navigation-history.ts` holds the pure logic.
8. **Naming:** components `PascalCase.tsx`; hooks `use-kebab-case.ts`; services, libs and stores `kebab-case.ts`; tests `<name>.test.mjs` beside the unit.

## Adding a feature

1. API: create `modules/<domain>` with module, service, controllers, DTOs; register the module; add events through the outbox if other domains must react.
2. Web: add a typed client in `api/services`, DTOs in `api/dto`, a hook in `hooks/`, components in `components/domain/<domain>`, and routes in `app/`.
3. Docs: update the [domain guide](../domains/README.md) and the [backend module map](../reference/backend-module-map.md).
4. Run `npm run check:architecture`, `npm run typecheck` and `npm run lint` before opening a pull request.

## Known gaps

- The four legacy `common → modules` imports above.
- Feature-level `hooks/` and `api/services` are still global folders rather than colocated with their feature. Colocating them (`features/<domain>/{components,hooks,api}`) is the next step if the web app keeps growing; the import rewrite script used for the last reorganisation can be reused.
- Module boundaries are checked by import path only; they are not yet enforced at the Nest DI level.
