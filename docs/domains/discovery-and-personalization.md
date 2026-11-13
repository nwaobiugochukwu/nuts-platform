# Discovery and Personalization

> **Scope:** Search, catalog discovery, saved intent, and the complete current and proposed recommendation system. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Search, catalog discovery, saved intent, and the complete current and proposed recommendation system.

<a id="discovery-and-personalization-design"></a>
## Discovery and Personalization: end-to-end design

### Domain model and actors
Provides instant, typo-tolerant search across products, categories, vendors, and SKUs with relevance scoring directly inside PostgreSQL without external cluster maintenance.

### Problems and controls
- **External Search Operational Complexity & Failure Modes:**
  - *The Failure Mode:* Operating a separate search cluster adds maintenance, index synchronization, and network failure points before measured relevance, freshness, or throughput needs justify it.
  - *How NUTS Solved It:* Implemented relevance ranking in parameterized PostgreSQL queries using full-text search and `pg_trgm` similarity across product, SKU, vendor, category, and description fields. This avoids a separately operated search cluster at current scale; latency and catalog capacity depend on real query plans and deployment data and should be measured.
- **Zero Results on Typos & Misspellings:**
  - *The Failure Mode:* Standard `LIKE` or `ILIKE` queries return zero results when users make slight spelling mistakes (e.g., "shooes" instead of "shoes").
  - *How NUTS Solved It:* Configured a fallback tier in raw SQL evaluating `similarity(p.name, :term) > 0.3`, matching misspelled queries against the GIN trigram index and sorting results by relevance score.

### Current backend mechanism
- **Multi-Tier Relevance Scoring:**
  Queries run through a tiered `CASE` ranking in raw PostgreSQL SQL:
  1. **Exact Name Match:** Weight `10.0 + similarity`
  2. **Prefix Name Match (`ILIKE term%`):** Weight `6.0 + similarity`
  3. **Exact SKU Match:** Weight `5.0`
  4. **Prefix SKU Match:** Weight `4.0`
  5. **Substring Name Match (`ILIKE %term%`):** Weight `3.0 + similarity`
  6. **Full-Text Match (`to_tsvector @@ plainto_tsquery`):** Weight `2.8 + similarity`
  7. **Store Name Match:** Weight `2.0 + similarity`
  8. **Trigram Fuzzy Fallback (`similarity() > 0.3`):** Weight `1.0`
- **Performance evidence:** No measured search latency target is published here. Query latency depends on catalog size, filters, indexes, database tier, and concurrent load; benchmark representative queries before setting an SLO.

### Frontend experience and flow
- **Interactive Search Drawer (`SearchDrawer`):** Slide-out search interface with debounced keystroke execution (250ms).
- **Instant Autocomplete & Recents:** Displays previous searches stored in client session alongside live product suggestions.
- **Faceted Filters:** Dynamic category, price range, and in-stock filters reflected immediately in browser URL query parameters.

### Domain terminology
- **GIN Index (Generalized Inverted Index):** A database index designed for multi-value elements like text arrays and full-text documents.
- **Trigram (`pg_trgm`):** Breaking words into 3-character slices (e.g. `shoes` $\rightarrow$ `sho`, `hoe`, `oes`) to measure how similar two words are even with typos.
- **tsvector:** A sorted list of distinct normalized lexemes optimized for full-text search.

### Failure scenarios and edge cases
- Special characters and punctuation in search queries.
- Multi-word search terms matching across store name, product description, and category.
- Search queries returning zero matches falling back to popular recommendations.

### Trade-offs and design considerations
- *PostgreSQL's built-in `pg_trgm` and `tsvector` avoid operating an external search cluster for current needs. No catalog-size or latency threshold is claimed until representative data and load are benchmarked.*

---

## Cross-application behavior and integration contracts

### Storefront reads

1. A Next.js route loads public products or categories through a server adapter in apps/web/src/api/server.
2. The server adapter calls the API using INTERNAL_API_URL and applies Next.js revalidation and tags where configured.
3. The browser uses the typed API modules and TanStack Query for interactive mutations and client-side refresh.
4. Public product responses exclude inactive and soft-deleted items. Product details, catalog lists, and recommendation surfaces use separate response DTOs.

### Product discovery

The home page contains independent shelves with different purposes and a fixed order: **A good place to start**; **Recently viewed / Continue where you left off**; **Based on your activity / Picked for you**; **Shop by interest**; **Your followed stores / New from vendors you follow**; and **Vendors to explore**. **A good place to start** is a horizontal sampler of up to 12 purchasable products with an image, with one product per vendor. The client first composes up to eight activity based picks with the API's stable daily rotating marketplace mix, then uses additional relevant products if the mix cannot fill all slots. If fewer than 12 eligible vendors are available, the shelf shows fewer products rather than repeating vendors or inserting placeholders. Products already shown in this sampler and in recent history are removed from later product shelves. **Picked for you** appears only when at least four unique products remain. Product cards retain the plus-to-cart and wishlist actions; variant products open the detail page for option selection. **Shop by interest** links root categories into `/category/[slug]`, where shoppers can continue through the category hierarchy. **Vendors to explore** remains focused on vendor discovery.

The Discover page, titled **Good Finds Across the Market** with subtitle **Find your next favourite from vendors across NUTS.**, initially renders a server-fetched product page, then requests GET /api/v1/discover as the shopper scrolls. The API returns a nextCursor and supports stable keyset ordering by newest, oldest, price ascending, and price descending. The cursor contains the active sort value and product ID so rows with equal timestamps or prices have deterministic continuation. The filter drawer has separate underlined vendor and category search inputs with suggested selectable options, plus availability, price, and sort controls; selected filters are preserved in the URL. Product text search remains on /search. Shoppers see a separate personalized shelf when recommendations are available. The UI page size is 24 and the API accepts up to 100. The browser and server clients use /discover directly; there is no fallback to a second discovery URL.

Category root pages use a separate preview layout: **Top Picks** and each direct-subcategory section are linked by horizontal hash tabs. The URL hash, active tab, breadcrumb, and scroll position follow the section in view. Each subcategory preview shows at most 12 products; **View all** opens its full page-based listing. The shopper-facing tabs and previews do not display product totals.

The /search route still uses the existing page-based search flow. Keeping search and general discovery separate avoids changing the existing search response contract; a later consolidation should first compare search ranking and category/store result behavior.

### Recommendation model

Recommendations are a deterministic, explainable ranker in the API. Signals include recent views, searches, cart and wishlist actions, qualifying purchases, category activity, store follows, and recommendation interactions. Anonymous browsing uses an opaque recommendation session identifier; it does not authorize an account. The homepage composes the personalized for-you results with the API's marketplace mix for exploration. That mix is stable per shopper or visitor identity for the UTC day, excludes followed vendors, favors recent eligible listings, and returns one in-stock product with an image from each of up to 12 distinct active vendors. Category selections from **Shop by interest** are tracked as category-view events and can inform subsequent personalized recommendations. The full cursor-paginated product feed exists on Discover rather than as a second homepage product rail.

The ranker is not a trained ML service. It needs observable quality measures before adding a more complex model: impression-to-click, add-to-cart, conversion, hide/dismiss, vendor diversity, freshness, and cold-start coverage. Keep event retention bounded and remove personal identifiers from analytical aggregates where they are no longer needed.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Search and query relevance

Shoppers and portal operators need useful results despite typos and multiple searchable fields, without adding an external search cluster prematurely.

#### Current backend mechanism

PostgreSQL full-text and trigram search support relevance tiers; public and role-scoped admin/vendor controllers keep authorization separate. Product-feed cursor pagination and text-search pagination are different contracts.

#### Failure scenarios and trade-offs

Query plans and indexes determine real limits; no catalog-size or latency guarantee should be inferred from the ranking weights. Consider an external search system only after measured relevance, freshness, or throughput needs exceed PostgreSQL's fit.

### Personalized recommendation surfaces and ranking

Shoppers need relevant discovery even with sparse histories, while recommendations should avoid stale, unavailable, or repetitive products.

#### Current backend mechanism

The current service is deterministic business logic over history and marketplace signals; it combines activity-based candidates with a rotating marketplace mix and applies freshness/diversity rules. It is not a trained ML service.

#### Failure scenarios and trade-offs

Anonymous session identity and signed-in history remain distinct for analytics. Current ranking uses multiple database reads and bounded candidate pools; measure latency and business lift before caching more aggressively or adding a model. The staged AI/ML plan is in the [recommendation scaling plan](../scaling/recommendations.md).

### Saved products and variants

Customers need persistent saved products/variants that remain correctly scoped and reflect product availability changes.

#### Current backend mechanism

Authenticated wishlist operations associate a customer with product/variant records; product eligibility is checked when items are added and read.

#### Failure scenarios and trade-offs

Removed or inactive products must not leak through stale cached results. Preserve saved intent where useful while clearly presenting unavailable inventory; monitor cache invalidation as lists grow.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#discovery-and-recommendations) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale search and recommendation reads through measured query tuning, bounded candidates, evaluation, and controlled introduction of specialized systems. The detailed model progression is in the [recommendation plan](../scaling/recommendations.md). Definitions and NUTS implementation are in [Field Manual Part VII](../engineering/field-manual/07-discovery-analytics-recommendations.md).
