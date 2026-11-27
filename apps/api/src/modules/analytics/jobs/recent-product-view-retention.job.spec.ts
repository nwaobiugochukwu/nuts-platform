import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import { RecentProductViewRetentionJob } from './recent-product-view-retention.job';

const DAY = 24 * 60 * 60 * 1000;

describe('RecentProductViewRetentionJob', () => {
  let prisma: {
    recentProductView: { findMany: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T03:00:00.000Z'));
    prisma = {
      recentProductView: { findMany: jest.fn(), deleteMany: jest.fn() },
    };
  });

  afterEach(() => jest.useRealTimers());

  function build(redisOptions = {}) {
    const { redis, set } = fakeCronRedis(redisOptions);
    const cron = new RecentProductViewRetentionJob(prisma as never, redis);
    jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);
    jest
      .spyOn((cron as any).logger, 'error')
      .mockImplementation(() => undefined);
    return { cron, set };
  }

  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `v${i}` }));

  it('removes only guest history older than 180 days, never signed-in history', async () => {
    prisma.recentProductView.findMany.mockResolvedValue(ids(2));
    prisma.recentProductView.deleteMany.mockResolvedValue({ count: 2 });
    const { cron, set } = build();

    await cron.removeExpiredRecentHistory();

    expect(prisma.recentProductView.findMany).toHaveBeenCalledWith({
      where: {
        userId: null,
        visitorId: { not: null },
        lastViewedAt: { lt: new Date(Date.now() - 180 * DAY) },
      },
      select: { id: true },
      take: 2000,
    });
    expect(prisma.recentProductView.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['v0', 'v1'] } },
    });
    expect(set).toHaveBeenCalledWith(
      'cron:lock:recent-product-view-retention',
      expect.any(String),
      'PX',
      1_800_000,
      'NX',
    );
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      'Removed 2 expired recent product views.',
    );
  });

  it('stays quiet when nothing expired', async () => {
    prisma.recentProductView.findMany.mockResolvedValue([]);
    const { cron } = build();

    await cron.removeExpiredRecentHistory();

    expect(prisma.recentProductView.deleteMany).not.toHaveBeenCalled();
    expect((cron as any).logger.log).not.toHaveBeenCalled();
  });

  it('continues through full batches and stops at a short one', async () => {
    prisma.recentProductView.findMany
      .mockResolvedValueOnce(ids(2000))
      .mockResolvedValueOnce(ids(5));
    prisma.recentProductView.deleteMany.mockResolvedValue({ count: 1 });
    const { cron } = build();

    await cron.removeExpiredRecentHistory();

    expect(prisma.recentProductView.findMany).toHaveBeenCalledTimes(2);
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.removeExpiredRecentHistory();

    expect(prisma.recentProductView.findMany).not.toHaveBeenCalled();
  });

  it('logs a failure and does not throw', async () => {
    prisma.recentProductView.findMany.mockRejectedValue(new Error('db down'));
    const { cron } = build();

    await expect(cron.removeExpiredRecentHistory()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Failed to remove expired recent product views',
      expect.any(String),
    );
  });
});
