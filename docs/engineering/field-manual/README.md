# The NUTS Engineering & Distributed Systems Field Manual

This is the reference for engineering terms and cross-cutting patterns: what each concept means, why teams use it, how NUTS implements it today, the relevant failures and trade-offs, and what remains proposed. Current code behavior is source-linked; a concept is never evidence that NUTS has implemented every recommended control.

Use the [glossary](glossary.md) for short definitions and implementation status. Use the [domain guides](../../domains/README.md) for end-to-end product behavior and the [backend module map](../../reference/backend-module-map.md) to locate code.

## Topics

- [Part I: Networking, protocols, and web APIs](01-networking-and-web-api.md)
- [Part II: Databases, query optimization, and concurrency](02-databases-and-concurrency.md)
- [Part III: Distributed caching and Redis](03-caching-and-redis.md)
- [Part IV: Asynchronous messaging and RabbitMQ](04-messaging-and-rabbitmq.md)
- [Part V: Application security](05-application-security.md)
- [Part VI: Software quality and delivery](06-quality-and-delivery.md)
- [Part VII: Search, analytics, and recommendation systems](07-discovery-analytics-recommendations.md)

## Documentation rules

- Keep a general definition and the NUTS implementation distinct.
- Link every implementation claim to the owning source, configuration, or domain guide.
- Label a behavior as proposed when it has no current code path; include the decision trigger and fallback.
- Keep feature-specific workflows in the owning domain guide and link to them instead of copying them here.
- Treat external references as further reading, not proof of NUTS behavior.
