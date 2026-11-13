# Part II: Database Systems, Query Optimization & Concurrency

23. **ACID Guarantees & Transaction Boundaries:**
    - **Concept & Foundation:** The fundamental properties of relational database reliability:
      - *Atomicity:* All operations inside a transaction succeed together or all roll back completely (All-or-Nothing).
      - *Consistency:* State transitions preserve all database invariants and constraints.
      - *Isolation:* Concurrent transactions execute without dirty reads, non-repeatable reads, or phantom updates.
      - *Durability:* Once committed, data survives power failures and system crashes via write-ahead logging (WAL).
    - **NUTS Production Implementation:** `OrdersService.checkout()` performs the database changes in a Prisma transaction:
      1. Locks the candidate cart and validates the address and purchasable items.
      2. Atomically reserves/decrements inventory and creates the order, items, payment row, and checkout idempotency record.
      If a database mutation fails, those changes roll back together. Paystack initialization happens only after commit; if the provider call fails, the committed pending order can be retried, and the unpaid-order expiry flow later restores inventory if payment never completes. Checkout itself does not append an outbox event.
    - **Architecture & Interview Takeaway:** *Keep ACID transactions as short as possible. Never make external network HTTP calls inside an open database transaction; use a durable state and retry/reconciliation path for provider calls that happen after commit.*

24. **CAP Theorem & PACELC Trade-Offs:**
    - **Concept & Foundation:**
      - *CAP Theorem:* In a distributed system with Network Partitions (P), you can choose either Consistency (C) or Availability (A), but never both.
      - *PACELC Theorem:* Extends CAP: If there is a Partition (P), how do you trade off Availability (A) and Consistency (C); Else (E), how do you trade off Latency (L) and Consistency (C)?
    - **NUTS Production Implementation:**
      - **CP (Consistency / Partition-Tolerant):** Applied to Inventory Reservation, Order Checkout, and Escrow Balance Settlements. If database locks cannot be acquired or network partitions occur, the checkout request fails fast with an error rather than overselling physical stock.
      - **Availability-oriented reads:** Public category and analytics projections use Redis/local caches with bounded fallbacks; catalog/search can still query PostgreSQL. There is no repository-managed read-replica topology, and cache behavior is not a guarantee that every dependency outage returns stale data instead of an error.
    - **Architecture & Interview Takeaway:** *Enterprise systems are not uniformly CP or AP. Partition your architecture so financial and inventory domains prioritize Consistency (CP), while browsing and search prioritize Availability and Low Latency (AP).*

25. **Database Connection Starvation & Pooling (pg adapter and optional provider pooler):**
    - **Concept & Foundation:** PostgreSQL operates a process-per-connection architecture where each client connection allocates 5-10 MB of RAM. High concurrency or serverless auto-scaling can spawn hundreds of instances, exhausting `max_connections` and crashing the database. Connection poolers maintain a small pool of persistent physical connections and multiplex client requests through them.
    - **NUTS Production Implementation:** `PrismaService` uses Prisma's PostgreSQL (`pg`) adapter with a per-process connection pool. `DB_CONNECTION_LIMIT` defaults to 15 in code (the checked-in example sets 10); `DB_IDLE_TIMEOUT_MS` and `DB_POOL_TIMEOUT` configure idle release and connection acquisition. These limits multiply by API replica count. The environment example supplies a provider transaction-pool URL for `DATABASE_URL` and a direct/session `DIRECT_URL` for migrations; this is a deployment option, not an internal PgBouncer service.
    - **Architecture & Interview Takeaway:** *Budget connections across every application replica. If runtime uses a provider's transaction pooler, use a direct/session URL for migrations and validate driver compatibility with that pool mode.*

26. **The N+1 Query Problem & Batch Loading:**
    - **Concept & Foundation:** The N+1 problem occurs when an application executes 1 database query to fetch N parent records, and then executes N individual queries to fetch associated child records for each parent (e.g. 50 orders $\rightarrow$ 50 queries for order items = 51 queries).
    - **NUTS Production Implementation:**
      - Reviewed high-volume flows use Prisma relation selects/includes to batch related data (for example, order items and variants), but this is not eliminated across every query; use query logs/APM to check each endpoint's query count.
      - `SearchService` uses parameterized PostgreSQL queries and some response aggregation in SQL where it fits the endpoint; inspect the query plan and returned row volume when changing search projections.
    - **Architecture & Interview Takeaway:** *Always inspect database query logs in development. An API endpoint whose query count scales linearly with the number of returned records will collapse under production load.*

27. **Optimistic vs. Pessimistic Locking & Lost Update Defense:**
    - **Concept & Foundation:**
      - *Optimistic Locking:* Assumes conflicts are rare. Reads records with a `version` number; updates only if the version hasn't changed (`UPDATE ... WHERE id = :id AND version = :currentVersion`). If 0 rows updated, a conflict occurred and the client retries.
      - *Pessimistic Locking:* Assumes conflicts are frequent. Acquires an exclusive database row lock immediately upon reading (`SELECT ... FOR UPDATE`), blocking other transactions until the lock is released.
    - **NUTS Production Implementation:**
      - **Pessimistic Locking (`SELECT ... FOR UPDATE`):** Used during Checkout in `OrdersService` when locking candidate cart rows to prevent concurrent checkout submissions from two tabs.
      - **Atomic Conditional Writes (Optimistic Mutation):** Used for stock decrements: `UPDATE variants SET stock = stock - :qty WHERE id = :id AND stock >= :qty`. If stock is insufficient, the query affects 0 rows, prompting an instant `409 Conflict`.
    - **Architecture & Interview Takeaway:** *Optimistic locking is ideal for low-contention scenarios (user profile updates); atomic conditional updates and pessimistic locking are essential for high-contention physical inventory decrements.*

28. **Distributed Deadlocks & Ordered Lock Acquisition:**
    - **Concept & Foundation:** A deadlock occurs when Transaction A holds Lock 1 and waits for Lock 2, while Transaction B holds Lock 2 and waits for Lock 1. The database detects the cycle in its wait-for graph and forcibly terminates one transaction with a deadlock error.
    - **NUTS Production Implementation:**
      - `OrdersService` sorts checkout stock mutations by their affected row IDs before issuing conditional stock updates.
      - That ordering reduces cycles when concurrent checkouts contend for the same stock rows. Other lock interactions can still deadlock, so keep PostgreSQL deadlock handling and transaction rollback in place.
    - **Architecture & Interview Takeaway:** *A consistent lock order lowers deadlock risk for a defined set of resources. Treat it as a mitigation, not a proof that an application can never deadlock.*

29. **Database Indexing Mechanics (B-Tree, GIN, Composite Indexes):**
    - **Concept & Foundation:** Indexes are auxiliary data structures that allow the database engine to find matching rows in $O(\log N)$ time rather than performing full table scans ($O(N)$).
      - *B-Tree:* Default self-balancing search tree optimized for equality (`=`) and range queries (`<`, `>`, `BETWEEN`).
      - *GIN (Generalized Inverted Index):* Maps elements (words, array values, JSON keys) to lists of row IDs containing them.
      - *Composite Index:* An index spanning multiple columns where column order matters (leftmost prefix rule).
    - **NUTS Production Implementation:**
      - B-Tree indexes on foreign keys: `userId`, `vendorId`, `orderId`, and `status`.
      - Composite index on `[vendorId, createdAt DESC]` for merchant backoffice order pagination.
      - PostgreSQL full-text and trigram indexes support search and typo-tolerant matching. Query latency depends on data volume, query plan, cache state, and deployed database capacity and must be measured.
    - **Architecture & Interview Takeaway:** *Indexes accelerate reads but slow down writes. Index foreign keys, frequently filtered status columns, and composite sort keys, but avoid indexing high-churn write columns with low query frequency.*

30. **Full-Text Search, Trigrams (`pg_trgm`) & `tsvector` Lexemes:**
    - **Concept & Foundation:** Standard `LIKE '%query%'` queries cannot use standard B-Tree indexes and force slow sequential table scans. Advanced text search uses:
      - *Trigrams:* Slicing strings into 3-character chunks to calculate similarity scores, enabling typo tolerance (e.g. `snakers` matches `sneakers`).
      - *tsvector & tsquery:* Parsing text into normalized linguistic stems/lexemes (e.g. `running` $\rightarrow$ `run`), matching text with boolean search operators.
    - **NUTS Production Implementation:** NUTS combines both inside `SearchService` via raw PostgreSQL SQL:
      - Generates `tsvector` for full-text phrase matching.
      - Uses `pg_trgm` `similarity(name, :query)` for fuzzy typo handling.
      - Applies tiered `CASE` ranking across exact, prefix, substring, full-text, SKU, vendor, category, description, and trigram matches. Fuzzy matching uses a similarity threshold; the current code makes no fixed latency or maximum-catalog-size guarantee.
    - **Architecture & Interview Takeaway:** *PostgreSQL full-text search and `pg_trgm` can avoid a separate search cluster at current scale, but validate relevance and query plans using production-like data before setting a capacity or latency target.*

31. **SQL Injection Defense & Parameterized Abstract Syntax Trees:**
    - **Concept & Foundation:** SQL Injection occurs when untrusted user input is concatenated directly into SQL query strings, allowing attackers to manipulate query logic, bypass authentication, or drop tables.
    - **NUTS Production Implementation:**
      - Prisma ORM compiles type-safe TypeScript expressions into parameterized queries (`$1`, `$2`), separating SQL command logic from user data at the database driver protocol layer.
      - Where raw SQL is required in `SearchService`, queries strictly use Prisma's tagged template literal `Prisma.sql` (e.g. `prisma.$queryRaw(Prisma.sql\`SELECT * FROM products WHERE name ILIKE \${term}\`)`), which automatically compiles inputs into bind parameters.
    - **Architecture & Interview Takeaway:** *Never concatenate strings to build SQL queries. Always use parameterized queries or type-safe ORM abstractions to ensure user input is treated strictly as data.*

---
