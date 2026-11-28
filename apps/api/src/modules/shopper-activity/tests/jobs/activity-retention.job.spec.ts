import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import {
  ActivityRetentionJob,
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
} from '../../jobs/activity-retention.job';

const DAY = 24 * 60 * 60 * 1000;

describe('ActivityRetentionJob', () => {
  let prisma: any;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T03:30:00.000Z'));
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      recommendationEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      recentProductView: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
    };
  });

  afterEach(() => jest.useRealTimers());

  function build(redisOptions = {}) {
    const { redis, set } = fakeCronRedis(redisOptions);
    const job = new ActivityRetentionJob(prisma, redis);
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((job as any).logger, level)
        .mockImplementation(() => undefined);
    }
    return { job, set };
  }

  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

  it('keeps each kind of data for its own time', () => {
    const { job } = build();

    expect(job.policies.map((p) => [p.name, p.retentionDays])).toEqual([
      ['product views', 730],
      ['shopper activity', 730],
      ['recommendation events', 180],
      ['guest recent product views', 180],
    ]);
  });

  it('runs every policy under one lock, deleting only what is older than its cutoff', async () => {
    const { job, set } = build();

    await job.pruneExpiredActivity();

    expect(set).toHaveBeenCalledTimes(1);
    expect((set.mock.calls[0] as unknown[])[0]).toBe(
      'cron:lock:activity-retention',
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.calls[0][1]).toEqual(
      new Date(Date.now() - 730 * DAY),
    );
    expect(prisma.recommendationEvent.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(Date.now() - 180 * DAY) },
        eventType: { notIn: ['FOLLOW', 'UNFOLLOW'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RETENTION_BATCH_SIZE,
      select: { id: true },
    });
    expect(prisma.recentProductView.findMany).toHaveBeenCalledWith({
      where: {
        userId: null,
        visitorId: { not: null },
        lastViewedAt: { lt: new Date(Date.now() - 180 * DAY) },
      },
      select: { id: true },
      take: RETENTION_BATCH_SIZE,
    });
  });

  it('never touches a signed-in shopper’s recent history, or the follow events', async () => {
    const { job } = build();
    await job.pruneExpiredActivity();

    const guest = prisma.recentProductView.findMany.mock.calls[0][0].where;
    expect(guest.userId).toBeNull();
    const rec = prisma.recommendationEvent.findMany.mock.calls[0][0].where;
    expect(rec.eventType.notIn).toEqual(['FOLLOW', 'UNFOLLOW']);
  });

  it('keeps deleting while batches come back full, and stops at the first short one', async () => {
    prisma.$executeRaw
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(5)
      .mockResolvedValue(0);
    const { job } = build();

    await job.pruneExpiredActivity();

    // 3 batches for product views, then 1 for shopper activity.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it('stops a policy at the per-run limit and says the rest is left for tomorrow', async () => {
    prisma.$executeRaw.mockResolvedValue(RETENTION_BATCH_SIZE);
    const { job } = build();
    const warn = jest.spyOn((job as any).logger, 'warn');

    await job.pruneExpiredActivity();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(RETENTION_MAX_BATCHES * 2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reached its per-run limit'),
    );
  });

  it('deletes recommendation events by id, only those it just listed', async () => {
    prisma.recommendationEvent.findMany.mockResolvedValueOnce(ids(2));
    prisma.recommendationEvent.deleteMany.mockResolvedValue({ count: 2 });
    const { job } = build();

    await job.pruneExpiredActivity();

    expect(prisma.recommendationEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r0', 'r1'] } },
    });
  });

  it('carries on with the other policies when one fails, and reports it', async () => {
    prisma.$executeRaw.mockRejectedValueOnce(new Error('disk full'));
    const { job } = build();
    const error = jest.spyOn((job as any).logger, 'error');

    await job.pruneExpiredActivity();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Retention of product views failed: disk full'),
    );
    expect(prisma.recentProductView.findMany).toHaveBeenCalledTimes(1);
  });

  it('does nothing when another instance holds the lock', async () => {
    const { job } = build({ alreadyLocked: true });

    await job.pruneExpiredActivity();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.recentProductView.findMany).not.toHaveBeenCalled();
  });
});
