# Part IV: Asynchronous Messaging & Event Reliability (RabbitMQ)

41. **Message Broker Architecture: Producers, Exchanges, Queues & Consumers:**
    - **Concept & Foundation:** Decouples message publishers from consumers via AMQP topology:
      - *Producer:* Application component creating and publishing messages.
      - *Exchange:* Routing engine inspecting message routing keys and headers.
      - *Queue:* FIFO buffer holding messages until consumed.
      - *Consumer:* Background worker reading messages from queues and executing tasks.
    - **NUTS Production Implementation:**
      - Producers publish asynchronous events to the topic exchange `nuts.events`.
      - RabbitMQ routes email-dispatch events to the durable `q.nuts.emails` queue.
      - `EmailConsumer` handles queued email dispatch through the provider service; selected domain events use the outbox relay rather than direct controller-to-broker publishing.
    - **Architecture & Interview Takeaway:** *Decoupling components through message brokers prevents slow third-party APIs (e.g. Brevo email latency) from degrading customer-facing HTTP response times.*

42. **Message Acknowledgements, Publisher Confirms & At-Least-Once Delivery:**
    - **Concept & Foundation:** By default, standard `publish()` is fire-and-forget; if the broker crashes before flushing to disk or RAM buffers overflow, messages are silently lost. Similarly, consumers must explicitly acknowledge messages only after work completes.
    - **NUTS Production Implementation:**
      - **Publisher Confirms (`createConfirmChannel`):** `RabbitMQService` upgrades standard channels to AMQP Confirm Channels. Published messages resolve a Promise on positive broker acknowledgement (`ack`) or gracefully report backpressure/failure, while logging publisher buffer backpressure (`!writable`).
      - **Manual Consumer Acknowledgements:** RabbitMQ consumers operate with `noAck: false`.
      - After the external email API returns a `2xx` success code, the worker executes `channel.ack(message)`.
      - If an unexpected error occurs, the worker issues `channel.nack(message, false, false)` to route the failure directly to the shared dead-letter queue. The current topology does not retry consumer-handler failures through a delayed retry queue.
    - **Architecture & Interview Takeaway:** *Pair Publisher Confirms with manual Consumer Acknowledgements. Fire-and-forget publishing creates a false sense of reliability in distributed architectures.*

43. **Poison Messages, Retries & Dead Letter Exchanges (DLX / DLQ):**
    - **Concept & Foundation:** A *poison message* is a malformed or invalid message that repeatedly fails a consumer. Blind requeueing can create an infinite crash loop. A Dead Letter Exchange (DLX) routes rejected messages away from the primary queue for inspection or controlled replay.
    - **NUTS Production Implementation:**
      - Work queues declare a dead-letter exchange (`nuts.dlx`) and route rejected messages to the shared durable `q.nuts.dlq`.
      - The transactional outbox relay retries broker publication on its 10-second polling/wake-up cycle and marks rows exhausted at five failed attempts. This retry limit applies to outbox-to-broker publishing, not to consumer handler execution.
      - A consumer handler error currently uses `nack(requeue=false)` and goes directly to the DLQ; there is no delayed exponential retry queue or automatic DLQ replay workflow in this topology.
    - **Architecture & Interview Takeaway:** *Every production queue must have a corresponding Dead Letter Queue (DLQ). Unhandled poison messages must never be allowed to block healthy queue traffic.*

44. **Consumer Prefetch, Congestion & Backpressure Management:**
    - **Concept & Foundation:** Without prefetch limits, a message broker pushes all pending messages in a queue to connected workers simultaneously. This floods worker memory and crashes Node.js processes during sudden message surges. Prefetch specifies the maximum number of unacknowledged messages a worker can hold.
    - **NUTS Production Implementation:**
      - The email worker explicitly sets `channel.prefetch(10)`.
      - The worker receives at most 10 email jobs concurrently. As each job completes and is acknowledged (`ACK`), the broker sends the next job, maintaining smooth memory usage and predictable throughput.
    - **Architecture & Interview Takeaway:** *Always configure consumer prefetch (`channel.prefetch`) to match worker concurrency limits. This applies backpressure to the broker and prevents worker Out-Of-Memory (OOM) crashes.*

45. **The Dual-Write Problem & The Transactional Outbox Pattern:**
    - **Concept & Foundation:** When an application must update a database and publish an event to a message broker in response to a business action, network partitions can cause one to succeed while the other fails. Updating the database but failing to publish leaves the system inconsistent; publishing first risks broadcasting events for transactions that subsequently roll back.
      - **NUTS Production Implementation:**
      - Selected flows (including payment confirmation, refund completion, order status changes, and vendor follow changes) persist their business change and outbox event in the same database transaction. This is not currently a claim that every order creation emits an outbox event.
        1. If the transaction rolls back, neither the business change nor its associated outbox row is committed.
        2. The relay wakes after a new outbox event and also polls every 10 seconds. It claims up to 50 eligible rows with `FOR UPDATE SKIP LOCKED` and publishes them to RabbitMQ.
        3. A positive publisher confirmation moves the row to `PUBLISHED`; failures increment attempts and are retried up to the configured limit. Delivery is at least once, so consumers need idempotent handling.
    - **Architecture & Interview Takeaway:** *Never attempt distributed dual-writes across heterogeneous systems without an Outbox or two-phase commit. Storing event intent in the local database transaction prevents a committed business change from losing its publication request; retries still depend on relay and broker recovery, and at-least-once delivery requires idempotent consumers.*

46. **Circuit Breaker Pattern & Cascading Failure Prevention:**
    - **Concept & Foundation:** When an external dependency (payment gateway, email API) experiences an outage, repeated synchronous calls tie up application threads, exhaust connection pools, and cause cascading system failures. A Circuit Breaker monitors failure rates and has three states:
      - *Closed:* Normal operation; traffic flows to external service.
      - *Open:* Failure threshold exceeded; calls fail immediately without touching the external service.
      - *Half-Open:* Probe requests test whether the external service has recovered.
    - **NUTS Production Implementation:**
      - `CircuitBreakerService` wraps Paystack, email-provider, and Cloudinary calls with timeouts and a consecutive-failure breaker.
      - Three consecutive failures open each circuit. The half-open probe windows are 10 seconds for Paystack, 30 seconds for email, and 15 seconds for Cloudinary; request timeouts are 8, 10, and 15 seconds respectively. Email send failures do not automatically enter a delayed RabbitMQ retry queue; consumer failures are routed to the DLQ.
    - **Architecture & Interview Takeaway:** *Fail fast when downstream dependencies collapse. Circuit breakers isolate external outages and prevent them from dragging down your core application.*

---
