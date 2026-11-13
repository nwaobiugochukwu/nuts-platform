# Recommendation Scaling Plan

**Status: proposal.** The current ranker is deterministic application logic. AI/ML ranking is a future option and must be evaluated against current behavior, measurable product outcomes, latency, privacy, and a reliable fallback. See [Discovery and Personalization](../domains/discovery-and-personalization.md) and [Field Manual Part VII](../engineering/field-manual/07-discovery-analytics-recommendations.md).

A safe progression is:

1. Improve event quality: reliable impressions, position, clicks, add-to-cart, purchases, dismissals, and exposure deduplication.
2. Define evaluation: offline ranking metrics plus online experiments for conversion, freshness, vendor diversity, repeat exposure, and latency.
3. Add candidate generation from complementary sources such as co-purchases, content/category similarity, followed vendors, and popular/new products.
4. Add model scoring for a bounded candidate set, followed by business-rule re-ranking for stock, freshness, customer preferences, and vendor/category diversity. This candidate-generation/scoring/re-ranking pattern is a common recommendation architecture. [Google recommendation systems overview](https://developers.google.com/machine-learning/recommendation/overview/types)
5. Cache or precompute results where possible; retain the present ranker as a fallback and define an inference timeout budget.
6. Consider embeddings, a feature store, or a separately deployed inference service only after data volume, evaluation results, and latency measurements justify them. A language model is not the default ranking choice; it may later help with product attribute extraction or semantic similarity if those use cases demonstrate value.

These are proposals to validate, not delivery commitments. The current module implementation and frontend surfaces are indexed in the [backend module map](../reference/backend-module-map.md).
