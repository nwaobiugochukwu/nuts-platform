# Referrals and Growth

> **Scope:** Referral attribution, reward eligibility, and abuse-resistant growth mechanics. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Referral attribution, reward eligibility, and abuse-resistant growth mechanics.

## End-to-end flow

This guide documents the capability across the web experience, API, persisted data, providers, and asynchronous work. Capability implementation details follow below.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### Referral attribution and rewards

Referral codes must be validated and attributed to registration/checkout without allowing self-referrals or duplicate rewards.

#### Current backend mechanism

The API exposes referral validation and account statistics; referral information flows through registration and order data. Reward eligibility and issuance require stable idempotency across retries.

#### Failure scenarios and trade-offs

Validation in the browser is advisory; the server must recheck eligibility at the committing operation. Keep abuse controls and unique reward records aligned as campaigns grow.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#referrals-and-growth) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale referral bursts and reward issuance with server-side eligibility, abuse controls, and database-backed idempotency.
