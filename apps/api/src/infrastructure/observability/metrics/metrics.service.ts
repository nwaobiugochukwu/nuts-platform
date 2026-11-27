import { Injectable, Logger, Optional } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { PrismaService } from '../../database/prisma.service';
import { RabbitMQService } from '../../messaging/rabbitmq/rabbitmq.service';
import { HeartbeatService, stateFromAge } from '../health/heartbeat.service';
import { currentProcessRole } from '../../../config/process-role';

/** Request and transaction latency buckets, in seconds. */
export const LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Statuses are grouped (2xx, 4xx...) to keep label cardinality low. */
export function statusClass(status: number): string {
  if (!Number.isFinite(status) || status < 100) return 'unknown';
  return `${Math.floor(status / 100)}xx`;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  private readonly httpDuration: Histogram<'method' | 'route' | 'status'>;
  private readonly txDuration: Histogram<'name' | 'outcome'>;
  private readonly txRetries: Counter<'name'>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    @Optional() private readonly heartbeat?: HeartbeatService,
  ) {
    this.registry.setDefaultLabels({ role: currentProcessRole() });
    collectDefaultMetrics({ register: this.registry, prefix: 'nuts_' });

    this.httpDuration = new Histogram({
      name: 'nuts_http_request_duration_seconds',
      help: 'HTTP request duration by method, route and status class',
      labelNames: ['method', 'route', 'status'],
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });
    this.txDuration = new Histogram({
      name: 'nuts_db_transaction_duration_seconds',
      help: 'Database transaction duration by name and outcome',
      labelNames: ['name', 'outcome'],
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });
    this.txRetries = new Counter({
      name: 'nuts_db_transaction_retries_total',
      help: 'Transactions re-run after a conflict or deadlock',
      labelNames: ['name'],
      registers: [this.registry],
    });

    this.registerCollectedGauges();
  }

  observeHttp(
    method: string,
    route: string,
    status: number,
    seconds: number,
  ): void {
    this.httpDuration.observe(
      { method, route, status: statusClass(status) },
      seconds,
    );
  }

  observeTransaction(
    name: string,
    outcome: 'commit' | 'rollback',
    seconds: number,
  ): void {
    this.txDuration.observe({ name, outcome }, seconds);
  }

  countTransactionRetry(name: string): void {
    this.txRetries.inc({ name });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /**
   * Gauges whose values come from the database or broker are read when
   * Prometheus scrapes, so they are always current and cost nothing between
   * scrapes. Each one fails soft: a missing broker must never break scraping.
   */
  private registerCollectedGauges(): void {
    const registers = [this.registry];

    const outbox = new Gauge({
      name: 'nuts_outbox_pending_events',
      help: 'Outbox events waiting to be published',
      registers,
      collect: async () => {
        try {
          outbox.set(
            await this.prisma.outboxEvent.count({
              where: { status: OutboxStatus.PENDING },
            }),
          );
        } catch (error) {
          this.logSoft('outbox pending count', error);
        }
      },
    });
    const oldest = new Gauge({
      name: 'nuts_outbox_oldest_pending_age_seconds',
      help: 'Age of the oldest pending outbox event (0 when none); the best stuck-pipeline signal',
      registers,
      collect: async () => {
        try {
          const row = await this.prisma.outboxEvent.findFirst({
            where: { status: OutboxStatus.PENDING },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          });
          oldest.set(row ? (Date.now() - row.createdAt.getTime()) / 1000 : 0);
        } catch (error) {
          this.logSoft('outbox oldest pending', error);
        }
      },
    });

    const background = new Gauge({
      name: 'nuts_background_up',
      help: '1 when the worker or jobs program has a fresh heartbeat; 0 when it is stale or missing',
      labelNames: ['target'],
      registers,
      collect: async () => {
        if (!this.heartbeat) return;
        for (const target of ['worker', 'jobs'] as const) {
          const age = await this.heartbeat.age(target);
          background.set({ target }, stateFromAge(age) === 'up' ? 1 : 0);
        }
      },
    });

    const up = new Gauge({
      name: 'nuts_rabbitmq_up',
      help: '1 when the broker channel is available',
      registers,
      collect: () => {
        up.set(this.rabbitmq.isAvailable() ? 1 : 0);
      },
    });
    // Both queue gauges are filled from one broker read, shared by whichever
    // gauge is collected first, so neither can come back empty.
    let pending: Promise<void> | null = null;
    const refreshQueues = (): Promise<void> => {
      pending ??= (async () => {
        const stats = await this.rabbitmq.getQueueStats();
        messages.reset();
        consumers.reset();
        for (const stat of stats) {
          messages.set({ queue: stat.queue }, stat.messages);
          consumers.set({ queue: stat.queue }, stat.consumers);
        }
      })().finally(() => {
        pending = null;
      });
      return pending;
    };
    const consumers: Gauge<'queue'> = new Gauge({
      name: 'nuts_rabbitmq_queue_consumers',
      help: 'Active consumers on a queue',
      labelNames: ['queue'],
      registers,
      collect: () => refreshQueues(),
    });
    const messages: Gauge<'queue'> = new Gauge({
      name: 'nuts_rabbitmq_queue_messages',
      help: 'Messages ready in a queue (the dead-letter queue should stay at 0)',
      labelNames: ['queue'],
      registers,
      collect: () => refreshQueues(),
    });
  }

  private logSoft(what: string, error: unknown): void {
    this.logger.warn(
      `Metrics: could not read ${what}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
