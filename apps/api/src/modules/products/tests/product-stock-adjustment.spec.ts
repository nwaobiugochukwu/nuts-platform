import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import {
  STOCK_ADJUSTMENT_CONSUMER,
  claimStockAdjustment,
} from '../utils/stock-adjustment-claim.util';
import { ProductVariantsService } from '../services/product-variants.service';
import { ProductsService } from '../services/products.service';

const REQUEST = '00000000-0000-4000-8000-000000000001';

describe('claimStockAdjustment', () => {
  const tx = (count: number) => ({
    processedEvent: { createMany: jest.fn().mockResolvedValue({ count }) },
  });

  it('applies an adjustment that carries no id, recording nothing (nothing to recognise it by)', async () => {
    const t = tx(1);

    await expect(claimStockAdjustment(t as never, undefined)).resolves.toBe(
      true,
    );
    expect(t.processedEvent.createMany).not.toHaveBeenCalled();
  });

  it('applies the first adjustment with an id, and records it', async () => {
    const t = tx(1);

    await expect(claimStockAdjustment(t as never, REQUEST)).resolves.toBe(true);
    expect(t.processedEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          consumer: STOCK_ADJUSTMENT_CONSUMER,
          messageId: REQUEST,
          status: 'DONE',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('refuses to apply an adjustment whose id was already recorded', async () => {
    await expect(claimStockAdjustment(tx(0) as never, REQUEST)).resolves.toBe(
      false,
    );
  });
});

describe('ProductsService.updateStock', () => {
  let tx: any;
  let cache: { del: jest.Mock; delByPattern: jest.Mock };
  let service: ProductsService;

  beforeEach(() => {
    tx = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          slug: 'shoe',
          stock: 10,
          hasVariants: false,
          vendor: { storeSlug: 'shop' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          slug: 'shoe',
          stock: 15,
          updatedAt: new Date('2026-11-28T10:00:00.000Z'),
        }),
      },
      stockHistory: { create: jest.fn() },
      processedEvent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    cache = {
      del: jest.fn().mockResolvedValue(undefined),
      delByPattern: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProductsService(
      {} as never,
      new FakeTransactionRunner(tx) as never,
      cache as never,
      {} as never,
      { invalidateLookup: jest.fn() } as never,
    );
  });

  it('adds the stock, records the change and who made it, and clears the caches', async () => {
    const result = await service.updateStock('p1', 5, 'admin-1', 'Recount');

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', isDeleted: false },
      data: { stock: { increment: 5 } },
    });
    expect(tx.stockHistory.create).toHaveBeenCalledWith({
      data: {
        productId: 'p1',
        adjustment: 5,
        oldStockQuantity: 10,
        newStockQuantity: 15,
        description: 'Recount',
        createdBy: 'admin-1',
      },
    });
    expect(result).toMatchObject({ id: 'p1', stock: 15, inStock: true });
    expect(cache.delByPattern).toHaveBeenCalled();
  });

  it('never takes more than is there: a reduction is guarded in the same statement', async () => {
    await service.updateStock('p1', -4);
    expect(tx.product.updateMany.mock.calls[0][0].where).toEqual({
      id: 'p1',
      isDeleted: false,
      stock: { gte: 4 },
    });

    tx.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateStock('p1', -400)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('applies an adjustment with an id once, recording the id in the same transaction', async () => {
    await service.updateStock('p1', 5, 'admin-1', undefined, REQUEST);

    expect(tx.processedEvent.createMany).toHaveBeenCalledTimes(1);
    expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.stockHistory.create).toHaveBeenCalledTimes(1);
  });

  it('does NOT apply a repeat of the same id: no change, no history, current stock returned, nothing cleared', async () => {
    tx.processedEvent.createMany.mockResolvedValue({ count: 0 });
    tx.product.findUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      slug: 'shoe',
      stock: 15,
      updatedAt: new Date(),
    });

    const result = await service.updateStock(
      'p1',
      5,
      'admin-1',
      undefined,
      REQUEST,
    );

    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.stockHistory.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'p1', stock: 15 });
    expect(cache.delByPattern).not.toHaveBeenCalled();
  });

  it('refuses a product whose stock is kept per variant, and one that does not exist', async () => {
    tx.product.findFirst.mockResolvedValueOnce({
      id: 'p1',
      slug: 's',
      stock: 0,
      hasVariants: true,
      vendor: null,
    });
    await expect(service.updateStock('p1', 1)).rejects.toThrow(/variant level/);

    tx.product.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateStock('gone', 1)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ProductVariantsService.updateStock', () => {
  let prisma: any;
  let tx: any;
  let cache: {
    del: jest.Mock;
    delByPattern: jest.Mock;
    buildKey: jest.Mock;
    invalidateProductCache: jest.Mock;
  };
  let service: ProductVariantsService;

  beforeEach(() => {
    prisma = {
      productVariant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'v1',
          productId: 'p1',
          isActive: true,
          stock: 4,
          product: { lowStockThreshold: 2, isDeleted: false },
        }),
      },
    };
    tx = {
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'v1',
          productId: 'p1',
          stock: 9,
          isActive: true,
          updatedAt: new Date(),
        }),
      },
      stockHistory: { create: jest.fn() },
      processedEvent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    cache = {
      del: jest.fn().mockResolvedValue(undefined),
      delByPattern: jest.fn().mockResolvedValue(undefined),
      buildKey: jest.fn((prefix: string, ...parts: string[]) =>
        [prefix, ...parts].join(':'),
      ),
      invalidateProductCache: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProductVariantsService(
      prisma,
      new FakeTransactionRunner(tx) as never,
      cache as never,
    );
  });

  it('adds the stock and records the change and who made it', async () => {
    const result = await service.updateStock(
      'v1',
      { quantity: 5, description: 'Recount' },
      'vendor-1',
    );

    expect(tx.stockHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adjustment: 5,
        oldStockQuantity: 4,
        newStockQuantity: 9,
        variantId: 'v1',
        createdBy: 'vendor-1',
      }),
    });
    expect(result).toMatchObject({ id: 'v1', stock: 9, inStock: true });
  });

  it('refuses a zero adjustment, a missing variant, and a reduction below zero', async () => {
    await expect(service.updateStock('v1', { quantity: 0 })).rejects.toThrow(
      /cannot be zero/,
    );

    prisma.productVariant.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateStock('gone', { quantity: 1 })).rejects.toThrow(
      NotFoundException,
    );

    tx.productVariant.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateStock('v1', { quantity: -99 })).rejects.toThrow(
      /Insufficient stock/,
    );
  });

  it('does NOT apply a repeat of the same id: no change, no history, current stock returned, no cache clearing', async () => {
    tx.processedEvent.createMany.mockResolvedValue({ count: 0 });

    const result = await service.updateStock('v1', {
      quantity: 5,
      requestId: REQUEST,
    });

    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
    expect(tx.stockHistory.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'v1', stock: 9 });
    expect(cache.delByPattern).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('lets a vendor adjust only their own variant, and passes the id through', async () => {
    prisma.productVariant.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateStockForVendor('vendor-1', 'v1', { quantity: 1 }),
    ).rejects.toThrow(/do not have access/);

    prisma.productVariant.findFirst
      .mockResolvedValueOnce({ id: 'v1' })
      .mockResolvedValueOnce({
        id: 'v1',
        productId: 'p1',
        isActive: true,
        stock: 4,
        product: { lowStockThreshold: 2, isDeleted: false },
      });
    await service.updateStockForVendor('vendor-1', 'v1', {
      quantity: 1,
      requestId: REQUEST,
    });

    expect(
      tx.processedEvent.createMany.mock.calls[0][0].data[0].messageId,
    ).toBe(REQUEST);
    expect(tx.stockHistory.create.mock.calls[0][0].data.createdBy).toBe(
      'vendor-1',
    );
  });
});
