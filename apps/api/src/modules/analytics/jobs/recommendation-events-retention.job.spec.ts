import { fakeRetentionRedis } from '@api/infrastructure/cache/retention-lock-harness-spec';
import { RecommendationEventsRetentionJob } from './recommendation-events-retention.job';

const DAY = 24 * 60 * 60 * 1000;

describe('RecommendationEventsRetentionJob', () => {
  let prisma: {
    recommendationEvent: { findMany: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T03:25:00.000Z'));
    prisma = {
      recommendationEvent: { findMany: jest.fn(), deleteMany: jest.fn() },
    };
  });

  afterEach(() => jest.useRealTimers());

  function build(redisOptions = {}) {
    const harness = fakeRetentionRedis(redisOptions);
    const cron = new RecommendationEventsRetentionJob(
      prisma as never,
      harness.redis,
    );
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
    return { cron, ...harness };
  }

  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));

  it('removes events older than 180 days but keeps follow history', async () => {
    prisma.recommendationEvent.findMany
      .mockResolvedValueOnce(ids(2))
      .mockResolvedValueOnce([]);
    prisma.recommendationEvent.deleteMany.mockResolvedValue({ count: 2 });
    const { cron } = build();

    await cron.pruneExpiredEvents();

    expect(prisma.recommendationEvent.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(Date.now() - 180 * DAY) },
        eventType: { notIn: ['FOLLOW', 'UNFOLLOW'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2000,
      select: { id: true },
    });
    expect(prisma.recommendationEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['e0', 'e1'] } },
    });
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      'Pruned 2 recommendation event(s) older than 180 days.',
    );
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.pruneExpiredEvents();

    expect(prisma.recommendationEvent.findMany).not.toHaveBeenCalled();
  });

  it('skips the run, with a warning, when Redis is unreachable', async () => {
    const { cron } = build({ setFails: true });

    await cron.pruneExpiredEvents();

    expect(prisma.recommendationEvent.findMany).not.toHaveBeenCalled();
    expect((cron as any).logger.warn).toHaveBeenCalled();
  });

  it('renews the lock before every batch and releases it at the end', async () => {
    prisma.recommendationEvent.findMany
      .mockResolvedValueOnce(ids(1))
      .mockResolvedValueOnce(ids(1))
      .mockResolvedValueOnce([]);
    prisma.recommendationEvent.deleteMany.mockResolvedValue({ count: 1 });
    const { cron, renewals, releases } = build();

    await cron.pruneExpiredEvents();

    expect(renewals()).toBe(3);
    expect(releases()).toBe(1);
  });

  it('stops without deleting when it discovers it lost the lock', async () => {
    const { cron, releases } = build({ lockLostOnRenew: true });

    await cron.pruneExpiredEvents();

    expect(prisma.recommendationEvent.findMany).not.toHaveBeenCalled();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      expect.stringContaining('lock ownership was lost'),
    );
    expect(releases()).toBe(1);
  });

  it('logs a database failure, still releases the lock, and does not throw', async () => {
    prisma.recommendationEvent.findMany.mockRejectedValue(new Error('db down'));
    const { cron, releases } = build();

    await expect(cron.pruneExpiredEvents()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Recommendation event retention failed: db down',
    );
    expect(releases()).toBe(1);
  });

  it('only warns when the lock cannot be released', async () => {
    prisma.recommendationEvent.findMany.mockResolvedValue([]);
    const { cron } = build({ releaseFails: true });

    await expect(cron.pruneExpiredEvents()).resolves.toBeUndefined();
    expect((cron as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not release'),
    );
  });
});
