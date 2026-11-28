import { ConflictException } from '@nestjs/common';
import { restoreOrderStock } from './restore-order-stock.util';

describe('restoreOrderStock', () => {
  let tx: { $queryRaw: jest.Mock; stockHistory: { createMany: jest.Mock } };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      stockHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
  });

  it('puts product stock back and records the change in the stock history', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'p1', oldStock: 3, newStock: 5 }]);

    await restoreOrderStock(
      tx as never,
      [{ productId: 'p1', variantId: null, quantity: 2 }],
      'Stock restored after cancellation',
    );

    expect(tx.stockHistory.createMany).toHaveBeenCalledWith({
      data: [
        {
          productId: 'p1',
          adjustment: 2,
          oldStockQuantity: 3,
          newStockQuantity: 5,
          description: 'Stock restored after cancellation',
        },
      ],
    });
  });

  it('puts variant stock back against the variant', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: 'var1', productId: 'p1', oldStock: 0, newStock: 4 },
    ]);

    await restoreOrderStock(
      tx as never,
      [{ productId: 'p1', variantId: 'var1', quantity: 4 }],
      'x',
    );

    expect(tx.stockHistory.createMany.mock.calls[0][0].data[0]).toMatchObject({
      productId: 'p1',
      variantId: 'var1',
      adjustment: 4,
    });
  });

  it('handles items in a fixed order, whatever order the order lists them, so concurrent restores cannot deadlock', async () => {
    tx.$queryRaw.mockImplementation(() =>
      Promise.resolve([{ id: 'x', productId: 'x', oldStock: 0, newStock: 1 }]),
    );
    const idsQueried = () =>
      tx.$queryRaw.mock.calls.map(([sql]: [{ values: unknown[] }]) =>
        sql.values.find((v) => typeof v === 'string'),
      );
    const items = [
      { productId: 'b', variantId: null, quantity: 1 },
      { productId: 'a', variantId: null, quantity: 1 },
      { productId: 'c', variantId: 'v0', quantity: 1 },
    ];

    await restoreOrderStock(tx as never, items, 'x');
    const forward = idsQueried();
    tx.$queryRaw.mockClear();
    await restoreOrderStock(tx as never, [...items].reverse(), 'x');

    // Sorted by the variant id when there is one, else the product id.
    expect(forward).toEqual(['a', 'b', 'v0']);
    expect(idsQueried()).toEqual(forward);
  });

  it('fails the whole transaction when a row cannot be updated, writing no history', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      restoreOrderStock(
        tx as never,
        [{ productId: 'gone', variantId: null, quantity: 1 }],
        'x',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.stockHistory.createMany).not.toHaveBeenCalled();
  });

  it('writes nothing for an order with no items', async () => {
    await restoreOrderStock(tx as never, [], 'x');

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.stockHistory.createMany).not.toHaveBeenCalled();
  });
});
