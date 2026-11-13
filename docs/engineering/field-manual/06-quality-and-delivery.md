# Part VI: Software Quality, Testing & CI/CD Gates

52. **The Test Pyramid: Unit, Integration & End-to-End (E2E) Testing:**
    - **Concept & Foundation:** A balanced test suite follows the testing pyramid:
      - *Unit Tests (Base):* Fast, isolated tests mocking dependencies, verifying individual business logic methods.
      - *Integration Tests (Middle):* Tests verifying interactions between services, real database adapters, and cache layers.
      - *E2E Tests (Top):* High-fidelity tests simulating complete user journeys from HTTP request to database persistence.
    - **NUTS Production Implementation:**
      - **Representative Unit Specs (`*.spec.ts`):** Jest specs cover services such as `CartService`, `OrdersService`, `UnpaidOrdersCron`, and `GlobalExceptionFilter`, generally using mocked Prisma clients.
      - **Service Tests:** Jest suites verify business logic with mocked Prisma, Redis, broker, and provider dependencies.
      - **HTTP/E2E-Style Tests:** Nest applications are exercised through Supertest, including authentication cookies and checkout/payment webhook flows, but the current suites replace Prisma and Redis with mocks and use in-memory test state. They do not validate real PostgreSQL transactions or a live broker.
    - **Architecture & Interview Takeaway:** *Unit tests give fast feedback on business algorithms; integration tests catch database query and schema regressions; E2E tests ensure critical revenue workflows function end-to-end.*

53. **Mocking, Fakes & Database Sandbox Isolation:**
    - **Concept & Foundation:** Tests must be deterministic and independent. Tests that mutate shared database state can interfere with one another, causing flaky failures. Mocking replaces external dependencies with controlled fakes.
    - **NUTS Production Implementation:**
      - Service tests use mocks for Prisma and Redis; HTTP/E2E-style specs also provide mocked infrastructure and simulated in-memory database state.
      - The current automated suite does not use an ephemeral PostgreSQL database with per-test transaction rollback. Real-database migration, query-plan, locking, and broker integration checks therefore remain separate operational validation work.
    - **Architecture & Interview Takeaway:** *Never point automated test suites at shared persistent staging databases. Tests must be isolated, idempotent, and capable of executing concurrently in any order.*

54. **Monorepo CI/CD Pipeline & Quality Gates:**
    - **Concept & Foundation:** Continuous Integration (CI) enforces automated quality gates on every Pull Request, preventing regressions, linting violations, type errors, or broken builds from reaching main branches.
    - **NUTS Production Implementation:**
      - GitHub Actions workflow (`.github/workflows/ci.yml`) has these repository checks:
        1. **Lockfile Integrity:** Verifies `npm ci` can use the committed lockfile.
        2. **Linting:** Runs the workspace `npm run lint` command.
        3. **Typechecking:** Runs the workspace `npm run typecheck` command.
        4. **API Tests:** Runs `npm run test:api`.
          5. **Web Unit Tests:** Runs the web unit test workspace command.
        6. **Application Builds:** Builds both API and web after the preceding checks pass.
      - Whether GitHub branch-protection rules require these checks is configured in repository settings and is not enforced by this workflow file itself. The separate `deploy` workflow builds and publishes images; it does not roll them onto a host.
    - **Architecture & Interview Takeaway:** *Automated CI checks are effective only when repository protection requires them and production deployment adds its own health checks and rollback path.*

---
