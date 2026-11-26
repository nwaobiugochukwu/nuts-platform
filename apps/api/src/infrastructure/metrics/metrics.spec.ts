import { MetricsService, statusClass } from './metrics.service';
import { tokenMatches } from './metrics-server';

describe('metrics helpers', () => {
  it('groups status codes by class', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
    expect(statusClass(0)).toBe('unknown');
  });

  it('compares the scrape token without accepting near matches', () => {
    expect(tokenMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(tokenMatches('Bearer s3cre', 's3cret')).toBe(false);
    expect(tokenMatches('Bearer s3cret!', 's3cret')).toBe(false);
    expect(tokenMatches(undefined, 's3cret')).toBe(false);
  });
});

describe('MetricsService', () => {
  function build(overrides: { pending?: number; oldest?: Date | null } = {}) {
    const prisma = {
      outboxEvent: {
        count: jest.fn().mockResolvedValue(overrides.pending ?? 0),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.oldest ? { createdAt: overrides.oldest } : null,
          ),
      },
    };
    const rabbit = {
      isAvailable: jest.fn().mockReturnValue(true),
      getQueueStats: jest.fn().mockResolvedValue([
        { queue: 'q.nuts.dlq', messages: 3, consumers: 0 },
        { queue: 'q.nuts.emails', messages: 0, consumers: 1 },
      ]),
    };
    return new MetricsService(prisma as never, rabbit as never);
  }

  it('exposes http, transaction, outbox and broker series', async () => {
    const metrics = build({
      pending: 4,
      oldest: new Date(Date.now() - 90_000),
    });
    metrics.observeHttp('GET', '/products', 200, 0.12);
    metrics.observeTransaction('order.settle', 'commit', 0.03);
    metrics.countTransactionRetry('order.settle');

    const text = await metrics.render();
    expect(text).toContain('nuts_http_request_duration_seconds_count');
    expect(text).toContain('route="/products"');
    expect(text).toContain('nuts_db_transaction_duration_seconds_count');
    expect(text).toContain(
      'nuts_db_transaction_retries_total{name="order.settle"',
    );
    expect(text).toContain('nuts_outbox_pending_events');
    expect(text).toMatch(/nuts_outbox_pending_events\{[^}]*\} 4/);
    expect(text).toMatch(
      /nuts_outbox_oldest_pending_age_seconds\{[^}]*\} (8\d|9\d)(\.\d+)?/,
    );
    expect(text).toMatch(
      /nuts_rabbitmq_queue_messages\{[^}]*queue="q\.nuts\.dlq"[^}]*\} 3/,
    );
    expect(text).toMatch(
      /nuts_rabbitmq_queue_consumers\{[^}]*queue="q\.nuts\.emails"[^}]*\} 1/,
    );
    expect(text).toContain('nuts_rabbitmq_up');
    expect(text).toContain('nuts_process_cpu_user_seconds_total');
  });

  it('reports zero oldest age when nothing is pending', async () => {
    const text = await build({ pending: 0, oldest: null }).render();
    expect(text).toMatch(/nuts_outbox_oldest_pending_age_seconds\{[^}]*\} 0/);
  });
});
