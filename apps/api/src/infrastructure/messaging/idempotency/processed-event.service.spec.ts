import { fakeCronRedis } from '../../cache/cron-lock-harness-spec';
import { ProcessedEventService } from './processed-event.service';

describe('ProcessedEventService', () => {
  let prisma: {
    processedEvent: {
      createMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let service: ProcessedEventService;
  const work = jest.fn();

  beforeEach(() => {
    work.mockReset().mockResolvedValue(undefined);
    prisma = {
      processedEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new ProcessedEventService(prisma as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('claims the message, runs the work, then marks it done', async () => {
    await expect(service.runOnce('email', 'm-1', work)).resolves.toBe('ran');

    expect(prisma.processedEvent.createMany).toHaveBeenCalledWith({
      data: [{ consumer: 'email', messageId: 'm-1', status: 'PROCESSING' }],
      skipDuplicates: true,
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(prisma.processedEvent.updateMany).toHaveBeenCalledWith({
      where: { consumer: 'email', messageId: 'm-1' },
      data: { status: 'DONE', completedAt: expect.any(Date) },
    });
  });

  it('skips the work for a message another delivery already finished or is handling', async () => {
    prisma.processedEvent.createMany.mockResolvedValue({ count: 0 });
    prisma.processedEvent.updateMany.mockResolvedValue({ count: 0 }); // not a stale claim

    await expect(service.runOnce('email', 'm-1', work)).resolves.toBe(
      'duplicate',
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('takes over a claim left by a crashed delivery once it is older than five minutes', async () => {
    prisma.processedEvent.createMany.mockResolvedValue({ count: 0 });
    prisma.processedEvent.updateMany
      .mockResolvedValueOnce({ count: 1 }) // the take-over
      .mockResolvedValue({ count: 1 });

    await expect(service.runOnce('email', 'm-1', work)).resolves.toBe('ran');

    const takeover = prisma.processedEvent.updateMany.mock.calls[0][0];
    expect(takeover.where.status).toBe('PROCESSING');
    expect(takeover.where.claimedAt.lt.getTime()).toBeLessThanOrEqual(
      Date.now() - 5 * 60_000 + 50,
    );
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('releases the claim and rethrows when the work fails, so the retry can run', async () => {
    work.mockRejectedValue(new Error('provider down'));

    await expect(service.runOnce('email', 'm-1', work)).rejects.toThrow(
      'provider down',
    );
    expect(prisma.processedEvent.deleteMany).toHaveBeenCalledWith({
      where: { consumer: 'email', messageId: 'm-1', status: 'PROCESSING' },
    });
  });

  it('handles a message with no id as before, since it cannot be de-duplicated', async () => {
    await expect(service.runOnce('email', undefined, work)).resolves.toBe(
      'ran',
    );
    expect(prisma.processedEvent.createMany).not.toHaveBeenCalled();
  });

  it('does not fail the message when marking it done fails', async () => {
    prisma.processedEvent.updateMany.mockRejectedValue(new Error('db'));

    await expect(service.runOnce('email', 'm-1', work)).resolves.toBe('ran');
  });

  it('removes only finished records older than 14 days, and only on the instance that wins the lock', async () => {
    const { redis } = fakeCronRedis();
    service = new ProcessedEventService(prisma as never, redis);

    await service.pruneOldRecords();

    const where = prisma.processedEvent.deleteMany.mock.calls[0][0].where;
    expect(where.status).toBe('DONE');
    expect(where.completedAt.lt.getTime()).toBeLessThan(
      Date.now() - 13 * 24 * 60 * 60_000,
    );

    const other = fakeCronRedis({ alreadyLocked: true });
    prisma.processedEvent.deleteMany.mockClear();
    service = new ProcessedEventService(prisma as never, other.redis);
    await service.pruneOldRecords();
    expect(prisma.processedEvent.deleteMany).not.toHaveBeenCalled();
  });
});
