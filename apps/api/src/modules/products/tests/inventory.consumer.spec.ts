import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { InventoryConsumer } from '../consumers/inventory.consumer';
import {
  fakeProcessed,
  fakeRabbit,
} from '../../../infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

describe('InventoryConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let idempotency: ReturnType<typeof fakeProcessed>;
  let prisma: any;
  let tx: any;
  let consumer: InventoryConsumer;

  beforeEach(() => {
    harness = fakeRabbit();
    idempotency = fakeProcessed();
    tx = {
      product: { update: jest.fn() },
      stockHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) =>
        work(tx),
      ),
    };
    consumer = new InventoryConsumer(
      harness.rabbit,
      prisma,
      new TransactionRunnerService(prisma, {} as never),
      idempotency.processed,
    );
    jest
      .spyOn((consumer as any).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown, messageId?: string) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.INVENTORY)(payload, {
      properties: { messageId },
    });
  }

  /** The product row after the increment: what Postgres returns from the atomic update. */
  const stockAfterIncrement = (stock: number) =>
    tx.product.update.mockResolvedValueOnce({ stock });

  it('ignores a message without a product id', async () => {
    await handle({ adjustment: 5 });
    await handle(undefined);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores an adjustment for a product that no longer exists', async () => {
    tx.product.update.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { code: 'P2025' }),
    );

    await handle({ productId: 'p1', adjustment: 5 });

    expect(tx.stockHistory.create).not.toHaveBeenCalled();
  });

  it('adds the adjustment with an atomic increment and writes the history in the same transaction', async () => {
    stockAfterIncrement(7); // was 10, adjusted by -3

    await handle({
      productId: 'p1',
      variantId: 'v1',
      adjustment: -3,
      reason: 'Order shipped',
      createdBy: 'admin-1',
      timestamp: '2026-11-01T10:00:00.000Z',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stock: { increment: -3 } },
      select: { stock: true },
    });
    expect(tx.stockHistory.create).toHaveBeenCalledWith({
      data: {
        productId: 'p1',
        variantId: 'v1',
        adjustment: -3,
        oldStockQuantity: 10,
        newStockQuantity: 7,
        description: 'Order shipped',
        createdBy: 'admin-1',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
      },
    });
  });

  it('never lets stock go below zero, correcting it inside the same transaction', async () => {
    stockAfterIncrement(-8); // was 2, adjusted by -10

    await handle({ productId: 'p1', adjustment: -10 });

    expect(tx.product.update).toHaveBeenLastCalledWith({
      where: { id: 'p1' },
      data: { stock: 0 },
    });
    const data = tx.stockHistory.create.mock.calls[0][0].data;
    expect(data.oldStockQuantity).toBe(2);
    expect(data.newStockQuantity).toBe(0);
  });

  it('fills in a default reason and author', async () => {
    stockAfterIncrement(2);

    await handle({ productId: 'p1', adjustment: 1 });

    const data = tx.stockHistory.create.mock.calls[0][0].data;
    expect(data.description).toBe('Inventory adjustment');
    expect(data.createdBy).toBe('rabbitmq-inventory-worker');
    expect(data.variantId).toBeNull();
  });

  it('rethrows a database failure so the queue retries it instead of losing the adjustment', async () => {
    prisma.$transaction.mockRejectedValue(new Error('deadlock'));

    await expect(handle({ productId: 'p1', adjustment: 1 })).rejects.toThrow(
      'deadlock',
    );
  });

  it('does not apply the same adjustment twice when the broker redelivers it', async () => {
    const dup = fakeProcessed(['m-1']);
    consumer = new InventoryConsumer(
      harness.rabbit,
      prisma,
      new TransactionRunnerService(prisma, {} as never),
      dup.processed,
    );
    harness.consumers.length = 0;
    await consumer.onModuleInit();

    await harness.handlerFor(RABBITMQ_QUEUES.INVENTORY)(
      { productId: 'p1', adjustment: 4 },
      { properties: { messageId: 'm-1' } },
    );

    expect(dup.runOnce).toHaveBeenCalledWith(
      'inventory',
      'm-1',
      expect.any(Function),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
