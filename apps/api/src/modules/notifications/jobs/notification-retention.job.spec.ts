import { fakeRetentionRedis } from '@api/infrastructure/cache/retention-lock-harness-spec';
import { NotificationRetentionJob } from './notification-retention.job';

const DAY = 24 * 60 * 60 * 1000;

describe('NotificationRetentionJob', () => {
  let prisma: { notification: { findMany: jest.Mock; deleteMany: jest.Mock } };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T00:00:00.000Z'));
    prisma = { notification: { findMany: jest.fn(), deleteMany: jest.fn() } };
  });

  afterEach(() => jest.useRealTimers());

  function build(redisOptions = {}) {
    const harness = fakeRetentionRedis(redisOptions);
    const cron = new NotificationRetentionJob(prisma as never, harness.redis);
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
    return { cron, ...harness };
  }

  const ids = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

  it('removes read notifications after 90 days and unread ones after 180', async () => {
    prisma.notification.findMany
      .mockResolvedValueOnce(ids(2, 'r'))
      .mockResolvedValueOnce(ids(1, 'u'));
    prisma.notification.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const { cron } = build();

    await cron.handleRetentionCleanup();

    const wheres = prisma.notification.findMany.mock.calls.map(
      (c) => c[0].where,
    );
    expect(wheres[0]).toEqual({
      isRead: true,
      createdAt: { lt: new Date(Date.now() - 90 * DAY) },
    });
    expect(wheres[1]).toEqual({
      isRead: false,
      createdAt: { lt: new Date(Date.now() - 180 * DAY) },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r0', 'r1'] } },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['u0'] } },
    });
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'deleted 3 stale notification(s) (2 read, 1 unread)',
      ),
    );
  });

  it('keeps going while a pass deletes whole batches of 1000', async () => {
    prisma.notification.findMany
      .mockResolvedValueOnce(ids(1000, 'r'))
      .mockResolvedValueOnce(ids(3, 'r'))
      .mockResolvedValueOnce([]);
    prisma.notification.deleteMany
      .mockResolvedValueOnce({ count: 1000 })
      .mockResolvedValueOnce({ count: 3 });
    const { cron } = build();

    await cron.handleRetentionCleanup();

    // read pass: full batch then a short one; unread pass: empty.
    expect(prisma.notification.findMany).toHaveBeenCalledTimes(3);
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.handleRetentionCleanup();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('skips the run when Redis is unreachable', async () => {
    const { cron } = build({ setFails: true });

    await cron.handleRetentionCleanup();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect((cron as any).logger.error).toHaveBeenCalled();
  });

  it('stops when it discovers it lost the lock, and still releases', async () => {
    const { cron, releases } = build({ lockLostOnRenew: true });

    await cron.handleRetentionCleanup();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      expect.stringContaining('lock ownership was lost'),
    );
    expect(releases()).toBe(1);
  });

  it('logs a database failure, releases the lock and does not throw', async () => {
    prisma.notification.findMany.mockRejectedValue(new Error('db down'));
    const { cron, releases } = build();

    await expect(cron.handleRetentionCleanup()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Error during notification retention cleanup: db down',
    );
    expect(releases()).toBe(1);
  });

  it('ignores a failure to release the lock', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    const { cron } = build({ releaseFails: true });

    await expect(cron.handleRetentionCleanup()).resolves.toBeUndefined();
  });
});
