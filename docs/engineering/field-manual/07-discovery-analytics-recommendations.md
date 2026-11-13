# Part VII: Search, Analytics, and Recommendation Systems

This part defines the concepts used in NUTS discovery and measurement, then separates current implementation from future machine-learning proposals. The feature-specific source of truth is [Discovery and Personalization](../../domains/discovery-and-personalization.md) and [Analytics and Measurement](../../domains/analytics-and-measurement.md).

## Search, retrieval, and ranking

**Retrieval** finds a bounded set of records that may satisfy a query. **Ranking** orders that candidate set by relevance or business value. **Re-ranking** applies a second set of constraints or objectives—such as stock, freshness, policy, or vendor diversity—after an initial score.

NUTS keeps product text search at `/search` separate from the cursor-paginated `/discover` feed. Current search uses PostgreSQL text and trigram techniques; the repository does not operate a separate search cluster. Discover uses deterministic keyset ordering and URL-backed filters. Details and limits are in [Search and discovery](../../domains/discovery-and-personalization.md).

## Recommendation pipeline terms

### Candidate generation

Candidate generation finds a manageable set of products or vendors that could be recommended. Typical sources include recently viewed items, products in the same category, co-purchases, followed vendors, and popular or new inventory.

NUTS currently assembles personalized and discovery results with deterministic application logic. There is no separately deployed candidate-generation service or trained retrieval model. Candidates must still pass product visibility and stock rules.

### Ranking and re-ranking

A **ranker** orders candidates using signals and constraints. A **re-ranker** can then enforce product availability, freshness, vendor/category diversity, or other marketplace rules.

The current ranker is deterministic code in the [`recommendations` API module](../../../apps/api/src/modules/recommendations/recommendations.service.ts). It uses available behavior and catalog signals; it is not a trained AI model. The future scaling plan proposes a bounded model score followed by business-rule re-ranking, with the current logic retained as a fallback.

### Cold start and implicit feedback

**Cold start** describes a shopper or item with too little history for personalized ranking. **Implicit feedback** is behavior that may signal interest without an explicit rating: views, searches, clicks, saves, cart actions, purchases, or vendor follows.

NUTS separates anonymous cold-start marketplace discovery from personalized recommendations. Anonymous browsing uses an opaque recommendation session identifier. The system does not merge anonymous analytics identity into a customer identity when recent history is claimed after sign-in. See the [account and discovery flows](../../domains/discovery-and-personalization.md).

## Impressions, attribution, and evaluation

An **impression** records that a recommendation was shown, ideally with the request, position, surface, and ranker version. Without reliable exposure records, a click or purchase cannot be interpreted against the items that were actually shown. **Attribution** assigns a later outcome to an earlier exposure under an explicit identity and time-window rule.

NUTS has recommendation event types for impressions, clicks, dismissals, and category views. The batch API accepts up to 100 events, and the current service writes accepted events directly to PostgreSQL. Analytics currently uses defined cohort windows and separate retention periods; dashboard freshness and event identity rules are documented in [Analytics and Measurement](../../domains/analytics-and-measurement.md).

**Offline evaluation** compares a model against historical data and metrics before serving it. **Online experiments** compare real user outcomes across controlled variants. A future ranker should be evaluated for conversion and engagement alongside freshness, vendor diversity, repeat exposure, cold-start coverage, latency, and error/fallback rate. No recommendation-quality experiment or trained ranker is claimed as current behavior.

## Embeddings, feature stores, and model serving

- **Embedding:** a learned vector representation used to compare semantic similarity. NUTS does not currently use embeddings for product ranking.
- **Feature store:** a system for consistent offline and online model features. NUTS does not currently operate one.
- **Inference service:** a deployed component that scores candidates with a trained model. NUTS does not currently have one.
- **Fallback:** a known-good behavior used when scoring times out or fails. A future model integration should retain deterministic ranking, set a strict timeout, and avoid making checkout or inventory correctness depend on model availability.

The staged proposal is in the [Recommendation Scaling Plan](../../scaling/recommendations.md). A language model is not the default product ranker; any use for attribute extraction or semantic similarity should have a separate measurable use case.

## Failure modes and scale boundaries

1. **Missing or duplicated exposure events:** results can be biased. Use stable event IDs, deduplicate retries, and measure exposure completeness before training.
2. **Sparse or anonymous history:** do not claim personalized quality where the shopper has no useful history; use a labeled cold-start or marketplace mix.
3. **Stale or unavailable inventory:** filter candidates against current eligibility and stock; a recommendation must never be treated as a reservation.
4. **Database pressure from analytics:** product views have a Redis/RabbitMQ path but still synchronously upsert recent history; other event families may write directly to PostgreSQL. Measure before adding stream infrastructure.
5. **Slow or failed inference:** retain deterministic fallback and record fallback rate without blocking browse or checkout.

For current event routing and failure behavior see the [analytics guide](../../domains/analytics-and-measurement.md). For data-plane alternatives and decision triggers see [Analytics at Scale](../../scaling/analytics-at-scale.md).
