import { ANALYTICS_EVENT_RETENTION_DAYS } from '@api/common/utils/date-range.util';
import { fakeRetentionRedis } from '@api/infrastructure/cache/retention-lock-harness-spec';
import { AnalyticsEventRetentionJob } from './analytics-event-retention.job';

const DAY = 24 * 60 * 60 * 1000;

describe('AnalyticsEventRetentionJob', () => {
  let prisma: { $executeRaw: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T03:40:00.000Z'));
    prisma = { $executeRaw: jest.fn() };
  });

  afterEach(() => jest.useRealTimers());

  function build(redisOptions = {}) {
    const harness = fakeRetentionRedis(redisOptions);
    const cron = new AnalyticsEventRetentionJob(prisma as never, harness.redis);
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
    return { cron, ...harness };
  }

  const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?');

  it('prunes product views, then marketplace events, older than the retention window', async () => {
    prisma.$executeRaw.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
    const { cron } = build();

    await cron.pruneExpiredEvents();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toContain(
      'DELETE FROM "product_views"',
    );
    expect(sqlOf(prisma.$executeRaw.mock.calls[1])).toContain(
      'DELETE FROM "marketplace_events"',
    );
    const cutoff = new Date(Date.now() - ANALYTICS_EVENT_RETENTION_DAYS * DAY);
    expect(prisma.$executeRaw.mock.calls[0][1]).toEqual(cutoff);
    expect(prisma.$executeRaw.mock.calls[0][2]).toBe(2000);
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      `Removed 10 product_views event(s) older than ${ANALYTICS_EVENT_RETENTION_DAYS} days.`,
    );
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      `Removed 4 marketplace_events event(s) older than ${ANALYTICS_EVENT_RETENTION_DAYS} days.`,
    );
  });

  it('keeps deleting while batches are full', async () => {
    prisma.$executeRaw
      .mockResolvedValueOnce(2000)
      .mockResolvedValueOnce(2000)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    const { cron } = build();

    await cron.pruneExpiredEvents();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it('stops at 25 batches per table and warns that the next run will continue', async () => {
    prisma.$executeRaw.mockResolvedValue(2000);
    const { cron } = build();

    await cron.pruneExpiredEvents();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(50);
    expect((cron as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'reached its per-run batch limit for product_views',
      ),
    );
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.pruneExpiredEvents();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips the run when Redis is unreachable', async () => {
    const { cron } = build({ setFails: true });

    await cron.pruneExpiredEvents();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('stops when it discovers it lost the lock, and still releases', async () => {
    const { cron, releases } = build({ lockLostOnRenew: true });

    await cron.pruneExpiredEvents();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      expect.stringContaining('lock ownership was lost'),
    );
    expect(releases()).toBe(1);
  });

  it('logs a database failure, releases the lock and does not throw', async () => {
    prisma.$executeRaw.mockRejectedValue(new Error('db down'));
    const { cron, releases } = build();

    await expect(cron.pruneExpiredEvents()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Analytics event retention failed: db down',
    );
    expect(releases()).toBe(1);
  });
});
