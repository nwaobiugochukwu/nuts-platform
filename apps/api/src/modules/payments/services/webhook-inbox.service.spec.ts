import { createHash } from 'node:crypto';
import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { WebhookInboxService } from './webhook-inbox.service';

describe('WebhookInboxService', () => {
  const body = '{"event":"charge.success","data":{"reference":"R1"}}';
  const key = createHash('sha256').update(body).digest('hex');
  let tx: {
    webhookInbox: {
      createMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let prisma: { webhookInbox: Record<string, jest.Mock> };
  let runner: FakeTransactionRunner;
  let service: WebhookInboxService;

  beforeEach(() => {
    tx = {
      webhookInbox: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'existing-id' }),
      },
    };
    prisma = {
      webhookInbox: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    runner = new FakeTransactionRunner(tx);
    service = new WebhookInboxService(prisma as never, runner as never);
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((service as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  describe('receive', () => {
    const input = {
      provider: 'paystack',
      eventType: 'charge.success',
      rawBody: body,
    };

    it('stores the raw body once, keyed by its hash, and publishes payment.webhook_received in the same transaction', async () => {
      const result = await service.receive(input);

      expect(result.duplicate).toBe(false);
      expect(runner.runs).toEqual(['webhook.receive']);
      const row = tx.webhookInbox.createMany.mock.calls[0][0];
      expect(row.skipDuplicates).toBe(true);
      expect(row.data[0]).toMatchObject({
        id: result.inboxId,
        provider: 'paystack',
        eventKey: key,
        eventType: 'charge.success',
        payload: body, // byte for byte
      });
      expect(runner.published).toEqual([
        {
          type: 'payment.webhook_received',
          aggregate: { type: 'webhook', id: result.inboxId },
          payload: {
            inboxId: result.inboxId,
            provider: 'paystack',
            eventType: 'charge.success',
          },
        },
      ]);
    });

    it('recognises the provider sending the same event again and queues nothing', async () => {
      tx.webhookInbox.createMany.mockResolvedValue({ count: 0 });

      const result = await service.receive(input);

      expect(result).toEqual({ inboxId: 'existing-id', duplicate: true });
      expect(tx.webhookInbox.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { provider_eventKey: { provider: 'paystack', eventKey: key } },
        select: { id: true },
      });
      expect(runner.published).toHaveLength(0);
    });

    it('treats a different body as a different event', async () => {
      await service.receive({ ...input, rawBody: body + ' ' });

      expect(
        tx.webhookInbox.createMany.mock.calls[0][0].data[0].eventKey,
      ).not.toBe(key);
    });

    it('stores nothing and publishes nothing when the transaction fails', async () => {
      tx.webhookInbox.createMany.mockRejectedValue(new Error('db down'));

      await expect(service.receive(input)).rejects.toThrow('db down');
      expect(runner.published).toHaveLength(0);
    });
  });

  it('marks a webhook processed and clears its error', async () => {
    await service.markProcessed('in-1');

    expect(prisma.webhookInbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'in-1' },
      data: expect.objectContaining({
        status: 'PROCESSED',
        lastError: null,
        processedAt: expect.any(Date),
      }),
    });
  });

  it('counts a failed attempt and keeps the reason, without failing the retry', async () => {
    await service.markAttemptFailed('in-1', new Error('db down'));

    expect(prisma.webhookInbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'in-1', status: 'RECEIVED' },
      data: { attempts: { increment: 1 }, lastError: 'db down' },
    });

    prisma.webhookInbox.updateMany.mockRejectedValue(new Error('still down'));
    await expect(
      service.markAttemptFailed('in-1', 'x'),
    ).resolves.toBeUndefined();
  });

  it('removes only processed webhooks older than 30 days, and only on the instance that wins the lock', async () => {
    const { redis } = fakeCronRedis();
    service = new WebhookInboxService(prisma as never, runner as never, redis);

    await service.pruneProcessed();

    const where = prisma.webhookInbox.deleteMany.mock.calls[0][0].where;
    expect(where.status).toBe('PROCESSED');
    expect(where.processedAt.lt.getTime()).toBeLessThan(
      Date.now() - 29 * 24 * 60 * 60_000,
    );

    prisma.webhookInbox.deleteMany.mockClear();
    const other = fakeCronRedis({ alreadyLocked: true });
    service = new WebhookInboxService(
      prisma as never,
      runner as never,
      other.redis,
    );
    await service.pruneProcessed();
    expect(prisma.webhookInbox.deleteMany).not.toHaveBeenCalled();
  });
});
