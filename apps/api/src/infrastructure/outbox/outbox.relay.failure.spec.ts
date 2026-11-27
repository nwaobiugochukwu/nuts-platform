import { OutboxStatus } from '@prisma/client';
import { OutboxRelay } from './outbox.relay';

const DAY = 24 * 60 * 60 * 1000;

describe('OutboxRelay under failure', () => {
  let relay: OutboxRelay;
  let prisma: any;
  let rabbit: { isAvailable: jest.Mock; publish: jest.Mock };

  const event = (id: string, attempts = 0) => ({
    id,
    eventType: 'order.shipped',
    payload: { orderId: id },
    attempts,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((cb: (tx: any) => Promise<unknown>) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    rabbit = {
      isAvailable: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(true),
    };
    relay = new OutboxRelay(prisma, rabbit as never);
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((relay as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  const settleCalls = () =>
    prisma.outboxEvent.updateMany.mock.calls.map((c: any[]) => c[0]);
  const settled = (status: OutboxStatus) =>
    settleCalls().filter((call: any) => call.data.status === status);

  it('claims with a row lock that skips rows another relay holds, and never re-claims exhausted rows', async () => {
    await relay.processOutboxEvents();

    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('attempts < 5');
    expect(sql).toContain('LIMIT 50');
  });

  it('settles a mixed batch per event: published ones PUBLISHED, refused ones FAILED', async () => {
    prisma.$queryRaw.mockResolvedValue([event('a'), event('b'), event('c')]);
    rabbit.publish.mockImplementation(
      (_type: string, payload: { orderId: string }) =>
        Promise.resolve(payload.orderId !== 'b'),
    );

    await relay.processOutboxEvents();

    expect(settled(OutboxStatus.PUBLISHED)[0].where.id.in.sort()).toEqual([
      'a',
      'c',
    ]);
    expect(settled(OutboxStatus.FAILED)[0].where.id.in).toEqual(['b']);
    expect(settled(OutboxStatus.FAILED)[0].data.attempts).toEqual({
      increment: 1,
    });
  });

  it('when publishing throws, marks every claimed row FAILED with the error and frees the relay', async () => {
    prisma.$queryRaw.mockResolvedValue([event('a'), event('b')]);
    rabbit.publish.mockRejectedValue(new Error('channel closed'));

    await expect(relay.processOutboxEvents()).resolves.toBeUndefined();

    const failed = settled(OutboxStatus.FAILED)[0];
    expect(failed.where).toEqual({
      id: { in: ['a', 'b'] },
      status: OutboxStatus.PROCESSING,
    });
    expect(failed.data.lastError).toBe('channel closed');
    expect(failed.data.attempts).toEqual({ increment: 1 });

    // The next run is not blocked by the failed one.
    prisma.$queryRaw.mockResolvedValue([]);
    await relay.processOutboxEvents();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('after a crash between publish and settle, the rows go back to FAILED and will be published again (at least once)', async () => {
    prisma.$queryRaw.mockResolvedValue([event('a')]);
    prisma.outboxEvent.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim -> PROCESSING
      .mockRejectedValueOnce(new Error('connection lost')) // settle -> PUBLISHED fails
      .mockResolvedValue({ count: 1 });

    await relay.processOutboxEvents();

    expect(rabbit.publish).toHaveBeenCalledTimes(1);
    expect(settled(OutboxStatus.FAILED)[0].where.id.in).toEqual(['a']);
  });

  it('runs one batch at a time even if woken repeatedly', async () => {
    let release: (value: boolean) => void = () => undefined;
    prisma.$queryRaw.mockResolvedValue([event('a')]);
    rabbit.publish.mockReturnValue(
      new Promise<boolean>((resolve) => (release = resolve)),
    );

    const first = relay.processOutboxEvents();
    await new Promise((resolve) => setImmediate(resolve));
    await relay.processOutboxEvents();
    relay.notifyNewEvent();
    release(true);
    await first;

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rabbit.publish).toHaveBeenCalledTimes(1);
  });

  it('pauses with one warning while the broker is down, and says when it resumes', async () => {
    rabbit.isAvailable.mockReturnValue(false);
    await relay.processOutboxEvents();
    await relay.processOutboxEvents();

    expect((relay as any).logger.warn).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    rabbit.isAvailable.mockReturnValue(true);
    await relay.processOutboxEvents();

    expect((relay as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('available again'),
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('idles, warning once, while the outbox table does not exist yet', async () => {
    prisma.$queryRaw.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'P2021' }),
    );

    await relay.processOutboxEvents();
    await relay.processOutboxEvents();

    expect((relay as any).logger.warn).toHaveBeenCalledTimes(1);
    expect((relay as any).logger.error).not.toHaveBeenCalled();
  });

  it('wakes the relay immediately when told a new event was stored', async () => {
    relay.notifyNewEvent();
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  describe('housekeeping', () => {
    it('removes only PUBLISHED rows older than 90 days, in batches of 1000', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-27T03:00:00.000Z'));
      prisma.outboxEvent.findMany.mockResolvedValue([
        { id: 'x1' },
        { id: 'x2' },
      ]);
      prisma.outboxEvent.deleteMany.mockResolvedValue({ count: 2 });

      await relay.prunePublishedEvents();

      expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: OutboxStatus.PUBLISHED,
            processedAt: { lt: new Date(Date.now() - 90 * DAY) },
          },
          take: 1000,
        }),
      );
      expect(prisma.outboxEvent.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['x1', 'x2'] }, status: OutboxStatus.PUBLISHED },
      });
      jest.useRealTimers();
    });

    it('a failed cleanup is logged, not thrown', async () => {
      prisma.outboxEvent.findMany.mockRejectedValue(new Error('db down'));

      await expect(relay.prunePublishedEvents()).resolves.toBeUndefined();
      expect((relay as any).logger.error).toHaveBeenCalled();
    });

    it('raises an alert listing delayed, stuck or exhausted events', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([
        {
          id: 'e1',
          eventType: 'order.shipped',
          status: 'FAILED',
          attempts: 5,
          lastError: 'x',
          createdAt: new Date(),
        },
      ]);

      await relay.reportStalledEvents();

      expect((relay as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Outbox reliability alert'),
      );
    });

    it('stays quiet when nothing is stalled', async () => {
      await relay.reportStalledEvents();

      expect((relay as any).logger.error).not.toHaveBeenCalled();
    });
  });

  // KNOWN DEFECT (audit R3): a refused publish is retried on the very next 10-second tick, so all
  // five attempts are spent in under a minute, and a row with five attempts is never retried again.
  // The correct behaviour is to schedule the retry later with backoff. Marked `failing` until fixed.
  it.failing(
    'schedules a refused event for a later retry instead of the next tick',
    async () => {
      prisma.$queryRaw.mockResolvedValue([event('a', 1)]);
      rabbit.publish.mockResolvedValue(false);

      await relay.processOutboxEvents();

      const failed = settled(OutboxStatus.FAILED)[0];
      expect(failed.data.nextAttemptAt).toBeInstanceOf(Date);
      expect(failed.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    },
  );
});
