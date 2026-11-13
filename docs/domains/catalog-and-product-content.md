# Catalog and Product Content

> **Scope:** Category taxonomy, purchasable product and variant data, product media, and product trust through reviews. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Category taxonomy, purchasable product and variant data, product media, and product trust through reviews.

<a id="catalog-and-product-content-design"></a>
## Catalog and Product Content: end-to-end design

### Domain model and actors
Manages product categorization in an arbitrary-depth nested category tree (e.g. `Apparel > Men > Outerwear > Jackets`) and handles dynamic URL paths (e.g. `/category/apparel/men/outerwear`).

### Problems and controls
- **Infinite Recursion & Stack Overflow Crashes:**
  - *The Failure Mode:* An administrator moving a category (e.g., `Electronics`) inside one of its own descendants (e.g., `Gaming Laptops`) creates a circular graph loop (`Gaming Laptops -> Electronics -> Computers -> Gaming Laptops`). Any recursive tree builder or breadcrumb generator then loops infinitely, pegging CPU at 100% and crashing the Node.js event loop with `RangeError: Maximum call stack size exceeded`.
  - *How NUTS Solved It:* Engineered a Directed Acyclic Graph (DAG) cycle-detection algorithm in [`CategoriesService.validateParent`](../../apps/api/src/modules/categories/categories.service.ts). Before committing parent updates: (1) it rejects self-parenting (`parentId === id`); (2) it recursively queries all descendants using `getDescendantIds(currentCategoryId)`; (3) if `descendantIds.includes(newParentId)`, it aborts with `400 Bad Request: Circular hierarchy detected` before any database write occurs.
- **Sibling Name Ambiguity & Route Collisions:**
  - *The Failure Mode:* Two distinct categories created with the same name under the same parent generate identical URL path slugs, leading to ambiguous routing and customer confusion.
  - *How NUTS Solved It:* Enforced a database composite unique index `(parentId, slug)` in PostgreSQL coupled with a case-insensitive name pre-check in `CategoriesService` to reject sibling duplicates before hitting constraint violations.
- **Stale Path Slugs & Broken Deep Links:**
  - *The Failure Mode:* Updating a parent category's slug without updating its children causes broken deep links, cached navigation mismatches, and SEO 404 penalties.
  - *How NUTS Solved It:* Updates descendants transactionally and invalidates Redis category-tree and slug caches. Public category reads use cache-aside with a 15-second development TTL and a 1-hour non-development TTL; Next.js page revalidation is a separate web-cache concern.

### Current backend mechanism
- **DAG Cycle Detection Algorithm (`CategoriesService.validateParent`):**
  1. Guard: `parentId !== currentCategoryId` (cannot self-parent).
  2. Traversal: Recursively gather all descendant IDs via `getDescendantIds(currentCategoryId)`.
  3. Cycle check: If `descendantIds.includes(newParentId)`, immediately abort with `400 Bad Request: Circular hierarchy detected`.
- **Cache Eviction Strategy:** Category trees and slug lookups use `CATEGORY_TTL`: **15 seconds in development** and **1 hour otherwise**. Category mutations clear the relevant shared cache keys; verify cache invalidation behavior when changing cache key shapes or adding new category projections.

### Frontend experience and flow
- **Hierarchical Tree Picker (`CategoryPicker`):** Multi-level drill-down modal with visual hierarchy indentation and search filtering.
- **Deep-Slug Dynamic Routing (`/category/[...slug]`):** Next.js App Router catch-all route resolving nested categories server-side with breadcrumbs rendered for SEO.
- **Category browsing UI:** Root pages render **Top Picks** and up to **12 products per direct-subcategory preview**. Each **View all** link opens the subcategory's full product listing. The horizontal text tabs are hash links that scroll to sections; scroll position updates the active tab and breadcrumb. This preview size is independent of the full listing's 24-item page size.

### Domain terminology
- **DAG (Directed Acyclic Graph):** A graph structure that flows in one direction with zero closed loops (no node can be its own ancestor).
- **Slug:** A clean, URL-safe version of a string (e.g., `Gaming Laptops` $\rightarrow$ `gaming-laptops`).
- **Catch-All Route (`[...slug]`):** A Next.js route pattern that captures any number of URL path segments into an array.

### Failure scenarios and edge cases
- Attempting to attach a category to an `ARCHIVED` parent.
- Case-insensitive sibling name collision checks.
- Deletion protection: categories with active products cannot be hard-deleted.

### Trade-offs and design considerations
- *Model categories as a Directed Acyclic Graph (DAG) and recursively check descendant lists before updating parent foreign keys to prevent infinite loops.*
- *Combine server-side breadcrumb generation with client-side tree caching for optimal SEO and sub-10ms navigation.*

---

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Category taxonomy

A marketplace needs nested categories without cycles, broken paths, or public listings that ignore category state.

#### Current backend mechanism

Admin mutations validate parent relationships and update hierarchy; public reads support nested category paths and product filtering. The design is detailed in [Domain 2](catalog-and-product-content.md#catalog-and-product-content-design).

#### Failure scenarios and trade-offs

Invalid slugs should fail as not found, cycles are rejected, and cache invalidation must cover affected descendants. Add attribute facets only after catalog attributes and query plans support reliable filtering.

### Catalog, variants, and inventory

Vendors need product and inventory controls; shoppers need only purchasable, public catalog entries with stable filtering and pagination.

#### Current backend mechanism

Public, vendor, and admin controllers share product and variant services. The Discover endpoint uses keyset pagination with a stable sort key and ID tie-breaker; catalog eligibility excludes inactive/deleted records.

#### Failure scenarios and trade-offs

Cursor values must match the requested sort/filter contract; invalid combinations should be rejected instead of silently changing results. Index choices and any future facet or bulk-catalog features need query-plan and traffic evidence.

### Product media uploads

Product images need provider-backed storage without granting arbitrary upload or outbound URL access.

#### Current backend mechanism

Authorized upload routes validate requests and use the Cloudinary integration; product records retain provider URLs/identifiers rather than binary assets in PostgreSQL.

#### Failure scenarios and trade-offs

Provider failure should not leave a product pointing at an unusable asset. Add upload quotas, orphan cleanup, and cost/size telemetry if volume shows abandoned assets or abuse.

### Product reviews and trust

Product ratings need to come from eligible customers and remain tied to the reviewed product and purchase rules.

#### Current backend mechanism

Review services enforce ownership/eligibility and provide product review summaries and entries; public reads and authenticated mutations have distinct access rules.

#### Failure scenarios and trade-offs

Moderation/removal must stay consistent with rating aggregates. Add moderation workflows and aggregation reconciliation as review volume and marketplace policy require them.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#catalog-media-and-reviews) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale catalog reads, media lifecycle, and review aggregates from measured query, storage, and policy needs.
