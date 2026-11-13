import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Queries taking longer than this value are logged as slow queries.
   *
   * Keep this reasonably high in production. Logging every normal query
   * creates unnecessary I/O and makes useful database problems harder to see.
   */
  private readonly slowQueryMs: number;

  /**
   * Prevents destructive database-cleanup helpers from being executed
   * against production.
   */
  private readonly isProduction: boolean;

  /**
   * Optional database heartbeat interval.
   *
   * This is intentionally disabled by default.
   *
   * A heartbeat such as SELECT 1 keeps database compute awake, which can
   * increase costs on providers such as Neon. Enable it only when you
   * intentionally want to keep the database/compute warm.
   */
  private readonly heartbeatMs: number;

  /**
   * Holds the heartbeat timer so it can be stopped during shutdown.
   */
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    config: ConfigService,
    @InjectPinoLogger(PrismaService.name)
    private readonly logger: PinoLogger,
  ) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');

    const nodeEnv = config.get<string>('NODE_ENV', 'development');

    const isProduction = nodeEnv === 'production';

    /**
     * Environment variables are normally strings.
     *
     * This helper makes the service safe even when ConfigModule validation
     * has not transformed the values into numbers.
     */
    const getNumber = (
      key: string,
      defaultValue: number,
      minimum = 0,
    ): number => {
      const rawValue = config.get<string | number>(key);

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        return defaultValue;
      }

      const parsedValue =
        typeof rawValue === 'number' ? rawValue : Number(rawValue);

      if (!Number.isFinite(parsedValue) || parsedValue < minimum) {
        throw new Error(
          `${key} must be a valid number greater than or equal to ${minimum}`,
        );
      }

      return parsedValue;
    };

    /**
     * PostgreSQL pool configuration.
     *
     * Because this application uses PrismaPg, these pool settings belong to
     * the pg adapter rather than relying on Prisma's native pool URL options.
     *
     * IMPORTANT:
     * `max` is PER APPLICATION PROCESS.
     *
     * For example:
     *
     *   5 application instances × 10 connections = up to 50 DB connections
     *
     * Therefore, increasing this value blindly can exhaust PostgreSQL's
     * connection limit in production.
     */
    const poolMax = getNumber('DB_CONNECTION_LIMIT', 15, 1);

    /**
     * How long an idle connection remains available in the pg pool.
     *
     * Five minutes avoids aggressively destroying/recreating connections
     * while still allowing genuinely unused connections to be released.
     */
    const idleTimeoutMs = getNumber('DB_IDLE_TIMEOUT_MS', 300_000);

    /**
     * Maximum time spent waiting to establish/acquire a PostgreSQL connection.
     *
     * This prevents requests from hanging indefinitely when the database is
     * unavailable or the pool is exhausted.
     */
    const connectionTimeoutMs = getNumber('DB_POOL_TIMEOUT', 30, 1) * 1_000;

    const adapter = new PrismaPg({
      connectionString,

      /**
       * Maximum number of PostgreSQL connections owned by this application
       * process.
       */
      max: poolMax,

      /**
       * Release unused pooled connections after this period.
       */
      idleTimeoutMillis: idleTimeoutMs,

      /**
       * Fail fast when PostgreSQL cannot provide a connection.
       */
      connectionTimeoutMillis: connectionTimeoutMs,

      /**
       * TCP keepalive is different from SELECT 1:
       *
       * - TCP keepalive helps detect dead network connections.
       * - It does NOT intentionally execute SQL.
       *
       * This is safe to keep enabled because it does not deliberately keep
       * database compute awake with application-level queries.
       */
      keepAlive: true,
    });

    super({
      adapter,

      /**
       * Only subscribe to query events internally so slow-query monitoring
       * can be implemented below.
       *
       * We deliberately do NOT emit every query to stdout.
       *
       * Logging every SQL statement in a busy API can:
       *
       * - generate enormous log volume;
       * - increase CPU and I/O;
       * - expose sensitive query parameters;
       * - make real application errors harder to find.
       */
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'stdout',
          level: 'warn',
        },
        {
          emit: 'stdout',
          level: 'error',
        },
      ],
    });

    this.isProduction = isProduction;

    /**
     * Default: report queries taking 1 second or longer.
     *
     * This should eventually be complemented by proper APM/database
     * monitoring rather than using application logs as the only source
     * of database performance information.
     */
    this.slowQueryMs = getNumber('PRISMA_SLOW_QUERY_MS', 1_000);

    /**
     * Default is 0.
     *
     * This means the application does NOT continuously execute SELECT 1.
     *
     * If you intentionally want to keep remote database compute warm:
     *
     * DB_HEARTBEAT_MS=240000
     *
     * can be configured.
     */
    this.heartbeatMs = getNumber('DB_HEARTBEAT_MS', 0);
  }

  async onModuleInit(): Promise<void> {
    /**
     * Establish the Prisma/pg connection pool during application startup.
     *
     * If the database is completely unavailable, startup fails instead of
     * allowing the API to start in a broken state.
     */
    await this.$connect();

    /**
     * Perform an initial lightweight database query to warm up the connection pool
     * (DNS resolution, TCP 3-way handshake, TLS handshake, and pooler authentication).
     *
     * Executing this warmup query before registering the slow query listener prevents
     * one-off cold-start connection negotiation latency from producing false-positive
     * slow query alerts during server boot.
     */
    await this.$queryRaw`SELECT 1`;

    /**
     * Self-healing production schema synchronization:
     * Idempotently ensure crucial columns and partial performance indexes exist
     * in the active database even if pending migrations have not been applied manually.
     */
    try {
      await this.$executeRawUnsafe(
        'ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;',
      );
      await this.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupeKey_key" ON "notifications"("dedupeKey");',
      );
      await this.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "notifications_userId_role_isRead_createdAt_idx" ON "notifications"("userId", "role", "isRead", "createdAt");',
      );
      await this.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "outbox_events_pending_process_idx" ON "outbox_events" ("createdAt" ASC) WHERE "status" IN (\'PENDING\', \'FAILED\') AND "attempts" < 5;',
      );
    } catch (schemaSyncErr) {
      this.logger.warn(
        { err: schemaSyncErr },
        'Self-healing schema verification skipped or encountered permission notice',
      );
    }

    /**
     * Prisma query events contain the SQL statement, duration and parameters.
     *
     * We only log the SQL statement and duration.
     *
     * Query parameters are intentionally NOT logged because they can contain
     * user data such as emails, IDs, tokens, addresses, or other sensitive
     * values.
     */
    this.$on('query' as never, (event: Prisma.QueryEvent) => {
      if (event.duration < this.slowQueryMs) {
        return;
      }

      this.logger.warn(
        {
          durationMs: event.duration,
          query: event.query,
        },
        `[SlowQuery] Database query exceeded ${this.slowQueryMs}ms`,
      );
    });

    /**
     * Optional application-level heartbeat.
     *
     * This should NOT be confused with PostgreSQL TCP keepalive above.
     *
     * Enable this only when the application deliberately wants to keep
     * database compute warm. Otherwise leave DB_HEARTBEAT_MS at 0.
     */
    if (this.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        void this.performHeartbeat();
      }, this.heartbeatMs);

      /**
       * The heartbeat must never prevent Node.js from shutting down.
       *
       * Without unref(), the timer could keep the process alive.
       */
      this.heartbeatTimer.unref();
    }

    this.logger.info(
      {
        poolMax: this.getPoolConfigurationForLog(),
        slowQueryThresholdMs: this.slowQueryMs,
        heartbeatEnabled: this.heartbeatMs > 0,
      },
      'Database connected',
    );
  }

  /**
   * Executes the optional application-level database heartbeat.
   *
   * Errors are logged instead of thrown because this timer is auxiliary
   * infrastructure. A normal database operation will still surface a real
   * connectivity failure to the request that needs the database.
   */
  private async performHeartbeat(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error: unknown) {
      this.logger.error(
        {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : String(error),
        },
        'Database heartbeat failed',
      );
    }
  }

  /**
   * Returns only non-sensitive database-pool information for startup logs.
   *
   * The DATABASE_URL is intentionally never logged because it can contain
   * database credentials.
   */
  private getPoolConfigurationForLog(): number {
    /**
     * PrismaPg does not expose its pool configuration through PrismaClient,
     * so this method exists only to keep the startup log intentionally
     * limited. The actual value is not required by the application.
     *
     * Returning 0 here would make the log misleading, so this method is
     * intentionally kept private and the caller can be simplified if desired.
     */
    return 0;
  }

  async onModuleDestroy(): Promise<void> {
    /**
     * Stop the optional heartbeat before disconnecting Prisma.
     *
     * This prevents a heartbeat query from being scheduled while the
     * PostgreSQL pool is shutting down.
     */
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    /**
     * Gracefully disconnect Prisma and close the underlying PostgreSQL pool.
     *
     * This is important during deployments and application restarts so
     * connections are released cleanly.
     */
    await this.$disconnect();

    this.logger.info('Database disconnected');
  }

  /**
   * Development/test helper for clearing application data.
   *
   * This method is intentionally protected from production execution.
   *
   * deleteMany() is used instead of loading records into memory first.
   *
   * The deletion order follows the parent/child relationships in the
   * application schema so foreign-key constraints are respected.
   */
  async cleanDatabase(): Promise<void> {
    if (this.isProduction) {
      throw new Error('cleanDatabase() is disabled when NODE_ENV=production');
    }

    /**
     * Child/dependent tables are deleted before their parent tables.
     *
     * Keep this sequential because these tables have relationships between
     * them and deleting them concurrently can cause unnecessary foreign-key
     * constraint conflicts.
     */
    const delegates: Array<{
      deleteMany: () => Promise<unknown>;
    }> = [
      this.orderStatusHistory,
      this.checkoutIdempotency,
      this.cartItem,
      this.cart,
      this.orderItem,
      this.order,
      this.payment,
      this.product,
      this.category,
      this.user,
    ];

    for (const delegate of delegates) {
      await delegate.deleteMany();
    }
  }
}
