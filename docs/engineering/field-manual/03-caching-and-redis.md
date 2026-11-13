# Part III: Distributed Caching & Redis Architecture

32. **In-Memory Key-Value Architecture & Memory Footprint:**
    - **Concept & Foundation:** Redis is an in-memory, single-threaded (event loop based), non-blocking data store delivering sub-millisecond read/write operations. By keeping entire datasets in RAM and using optimized C data structures (Strings, Hashes, Lists, Sets, Sorted Sets), it serves as a high-speed caching and ephemeral coordination layer.
    - **NUTS Production Implementation:**
      - The local Redis service stores keys for:
        - Active session security stamps (`auth:stamp:{role}:{userId}`).
        - Ephemeral 6-digit OTP verification codes (`otp:{email}`).
        - Refresh token rotation grace window records (`auth:grace:{hash}`).
        - Hierarchical category tree caches (`catalog:categories:tree`).
        - Redis-backed fixed-window rate-limit counters shared across API instances, with bounded per-instance fallback when Redis is unavailable.
    - **Architecture & Interview Takeaway:** *Redis executes commands on a single thread. Avoid long-running commands like `KEYS *` in production because they block all other client operations; use `SCAN` or key namespacing with explicit TTLs.*

33. **Cache Invalidation & The Two Hard Problems in Computer Science:**
    - **Concept & Foundation:** *"There are only two hard things in Computer Science: cache invalidation and naming things."* Keeping cached data synchronized with the primary database is critical. Serving stale data can result in displaying incorrect prices, out-of-stock items, or outdated merchant status.
    - **NUTS Production Implementation:**
      - NUTS employs **Explicit Event-Driven Cache Invalidation**:
        - When an administrator creates, updates, re-parents, or deletes a category, `CategoriesService` calls `cacheService.del('catalog:categories:tree')` and evicts matching slug keys.
        - When a user logs out globally or resets their password, the API attempts to evict `auth:stamp:{role}:{userId}`. If Redis invalidation is unavailable, the 60-second stamp TTL bounds how long a cached stamp can remain in circulation.
    - **Architecture & Interview Takeaway:** *Never rely on TTLs alone for critical business data. Pair time-based expiration with active event-driven invalidation upon entity mutations.*

34. **Cache Patterns: Cache-Aside vs. Write-Through vs. Write-Behind:**
    - **Concept & Foundation:**
      - *Cache-Aside (Lazy Loading):* The application first checks the cache. On a hit, it returns data. On a miss, it reads from the database, writes the result to the cache, and returns data.
      - *Write-Through:* The application writes to the cache and database simultaneously before returning success.
      - *Write-Behind (Write-Back):* The application writes to the cache immediately and asynchronously flushes changes to the database in background batches.
    - **NUTS Production Implementation:** NUTS uses cache-aside through `CacheService.wrap(key, ttlSeconds, computeFn)`. It checks the cache, coalesces concurrent work within the process, computes on a miss, and populates the cache. Selected expensive reads use `wrapWithLock` for cross-instance Redlock coordination. Cache errors and lock contention have bounded fallbacks to the data source rather than waiting without limit.
    - **Architecture & Interview Takeaway:** *Cache-aside keeps derived data out of the system of record, but cache outage behavior and stampede controls must be explicit. Cross-instance locking is a separate capability from ordinary per-process request coalescing.*

35. **TTLs, Eviction Policies & Memory Sizing:**
    - **Concept & Foundation:** Memory is finite. Time-to-Live (TTL) ensures keys are removed after a set duration. When memory limits are reached (`maxmemory`), Redis evicts keys according to an eviction policy: `volatile-lru` (least recently used keys with TTL), `allkeys-lru`, or `noeviction` (rejects writes).
    - **NUTS Production Implementation:**
      - Representative TTL assignments:
        - Refresh token grace concurrency window: 15 seconds.
        - Ephemeral OTP verification codes: 10 minutes.
        - Category tree and slug cache: 15 seconds in development and 1 hour otherwise.
        - Unpaid-order cron lock: 4 minutes; other jobs use their own lock and renewal policies.
      - Redis memory policy and persistence depend on the selected deployment; do not assume the local or hosted instance uses a particular eviction or persistence configuration.
    - **Architecture & Interview Takeaway:** *Never store unbounded keys in Redis without an explicit TTL. An unmanaged Redis instance will eventually exhaust RAM and reject new writes.*

36. **Cache Stampede (Thundering Herd) & Probabilistic Early Expiration:**
    - **Concept & Foundation:** When a popular cached key expires, thousands of concurrent user requests experience a cache miss simultaneously. All requests hit the database at the exact same instant to recompute the value, saturating CPU and crashing the database.
    - **NUTS Production Implementation:**
      - `CacheService.wrapWithLock` supports a cross-instance Redlock for expensive shared reads, including analytics summary queries. On a cold miss, one instance computes and populates Redis; contenders wait briefly for the value, then fall back to a database computation after a bounded wait. Category tree reads currently use ordinary cache-aside and per-process request coalescing rather than this cross-instance lock.
    - **Architecture & Interview Takeaway:** *Protect heavy database read queries with locking or probabilistic early recomputation (XFetch) to prevent traffic spikes from causing cascading database failures upon cache expiration.*

37. **Distributed Mutual Exclusion Locks (Mutex / Redlock):**
    - **Concept & Foundation:** In a multi-replica application deployment, standard in-process locks (like JavaScript mutexes) only synchronize threads within a single container. Coordinating tasks across multiple containers requires a distributed locking mechanism.
    - **NUTS Production Implementation:**
      - `UnpaidOrdersCron` runs across multiple container replicas.
      - To prevent concurrent containers from canceling the same unpaid orders twice, the cron attempts to acquire an atomic distributed lock via Redis:
        `SET cron:lock:unpaid-orders <workerId> NX PX 240000`
      - Only the replica that successfully sets the key proceeds to execute the cancellation job; other replicas skip the iteration gracefully.
    - **Architecture & Interview Takeaway:** *Always use atomic `SET key value NX PX <milliseconds>` when implementing distributed mutexes. The `NX` ensures mutual exclusion, and `PX` ensures locks are automatically released if the holding worker crashes.*

38. **Redis Pub/Sub vs. Redis Streams vs. Message Brokers:**
    - **Concept & Foundation:**
      - *Redis Pub/Sub:* Fire-and-forget message broadcasting. If a subscriber is offline, the message is permanently lost (no persistence, no acknowledgements).
      - *Redis Streams:* Persistent, append-only log with consumer groups and offset tracking.
      - *RabbitMQ:* Dedicated enterprise message broker with persistent queues, complex routing topologies (topic, fanout, direct), consumer backpressure, and dead-letter handling.
    - **NUTS Production Implementation:**
      - **Redis Pub/Sub:** Used for ephemeral real-time SSE broadcasts across API cluster nodes (`notifications:stream`).
      - **RabbitMQ:** Used for asynchronous email, notification, analytics, vendor, and inventory work. The outbox relay retries failed publishes up to five attempts; a consumer handler exception is currently rejected directly to the shared DLQ, with no delayed retry queue.
    - **Architecture & Interview Takeaway:** *Use Redis Pub/Sub for ephemeral, real-time broadcasts where dropped messages are acceptable (live UI badge updates). Use dedicated brokers like RabbitMQ for mission-critical transactional tasks.*

39. **Atomic Operations & Embedded Lua Scripting:**
    - **Concept & Foundation:** Redis processes individual commands atomically. However, multi-step operations (Read-Modify-Write) are subject to race conditions if interleaved with other commands. Embedded Lua scripts execute atomically inside Redis without interruption.
    - **NUTS Production Implementation:**
      - `RedisThrottlerStorage` runs its fixed-window increment, expiry, and block-duration updates in one Lua script so API replicas share an atomic rate-limit decision. Refresh rotation is a separate database compare-and-set: only one request can rotate the current refresh ID, then the new session is cached in Redis under the old ID for 15 seconds. That cache is written after commit and is not a lock; a request in the commit-to-cache gap or during Redis failure can still hit the token-reuse path.
    - **Architecture & Interview Takeaway:** *When multiple Redis commands must execute as an indivisible unit without network round-trip interleaving, encapsulate them in an atomic Lua script.*

40. **Redis Persistence (RDB vs. AOF) & High-Availability Replication:**
    - **Concept & Foundation:**
      - *RDB (Redis Database Backup):* Point-in-time snapshots of the dataset written to disk at specified intervals. Low storage overhead, fast recovery, but risk of data loss between snapshots.
      - *AOF (Append Only File):* Logs every write operation received by the server. Provides maximum data durability (`fsync everysec`), but larger file size and slower restart recovery.
    - **NUTS Production Implementation:** Persistence, replication, and eviction are deployment settings, not guaranteed by this repository. Local development Compose settings do not establish the policy for a hosted Redis service. Choose durability and recovery settings based on whether Redis holds only rebuildable cache data or also short-lived coordination/session state.
    - **Architecture & Interview Takeaway:** *Redis persistence is a deployment decision. Document the actual provider configuration and recovery point objective instead of assuming RDB, AOF, or replication is enabled.*

---
