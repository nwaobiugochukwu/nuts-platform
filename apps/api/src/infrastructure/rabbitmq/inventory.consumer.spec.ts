import { RABBITMQ_QUEUES } from './rabbitmq.constants';
import { InventoryConsumer } from './inventory.consumer';
import { fakeRabbit } from './consumer-harness-spec';

describe('InventoryConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let prisma: any;
  let consumer: InventoryConsumer;

  beforeEach(() => {
    harness = fakeRabbit();
    prisma = {
      product: {
        findUnique: jest.fn(),
        update: jest.fn((args: unknown) => args),
      },
      stockHistory: { create: jest.fn((args: unknown) => args) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    consumer = new InventoryConsumer(harness.rabbit, prisma);
    jest
      .spyOn((consumer as any).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.INVENTORY)(payload);
  }

  it('ignores a message without a product id', async () => {
    await handle({ adjustment: 5 });
    await handle(undefined);

    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('ignores an adjustment for a product that no longer exists', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    await handle({ productId: 'p1', adjustment: 5 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('updates the stock and writes the history in one transaction', async () => {
    prisma.product.findUnique.mockResolvedValue({ stock: 10 });

    await handle({
      productId: 'p1',
      variantId: 'v1',
      adjustment: -3,
      reason: 'Order shipped',
      createdBy: 'admin-1',
      timestamp: '2026-11-01T10:00:00.000Z',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stock: 7 },
    });
    expect(prisma.stockHistory.create).toHaveBeenCalledWith({
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

  it('never lets stock go below zero', async () => {
    prisma.product.findUnique.mockResolvedValue({ stock: 2 });

    await handle({ productId: 'p1', adjustment: -10 });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stock: 0 },
    });
    expect(
      prisma.stockHistory.create.mock.calls[0][0].data.newStockQuantity,
    ).toBe(0);
  });

  it('fills in a default reason and author', async () => {
    prisma.product.findUnique.mockResolvedValue({ stock: 1 });

    await handle({ productId: 'p1', adjustment: 1 });

    const data = prisma.stockHistory.create.mock.calls[0][0].data;
    expect(data.description).toBe('Inventory adjustment');
    expect(data.createdBy).toBe('rabbitmq-inventory-worker');
    expect(data.variantId).toBeNull();
  });

  // KNOWN DEFECTS (audit R21 and R6). These describe the correct behaviour and fail today, so
  // they are marked `failing`: they pass the build now and turn red once the defect is fixed,
  // which is the reminder to delete the `.failing`.
  it.failing(
    'rethrows a database failure so the broker retries it instead of losing it',
    async () => {
      prisma.product.findUnique.mockResolvedValue({ stock: 10 });
      prisma.$transaction.mockRejectedValue(new Error('deadlock'));

      await expect(handle({ productId: 'p1', adjustment: 1 })).rejects.toThrow(
        'deadlock',
      );
    },
  );

  it.failing(
    'applies the change atomically instead of writing a value computed from an earlier read',
    async () => {
      prisma.product.findUnique.mockResolvedValue({ stock: 10 });

      await handle({ productId: 'p1', adjustment: 4 });

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { stock: { increment: 4 } },
      });
    },
  );
});
