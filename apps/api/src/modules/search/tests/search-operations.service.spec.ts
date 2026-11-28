import { SearchOperationsService } from '../services/search-operations.service';

describe('SearchOperationsService', () => {
  let prisma: any;
  let cache: { flush: jest.Mock };
  let service: SearchOperationsService;

  beforeEach(() => {
    prisma = {
      product: { count: jest.fn().mockResolvedValue(10) },
      vendor: { count: jest.fn().mockResolvedValue(3) },
      category: { count: jest.fn().mockResolvedValue(4) },
      order: { count: jest.fn().mockResolvedValue(5) },
    };
    cache = { flush: jest.fn().mockResolvedValue(7) };
    service = new SearchOperationsService(prisma, cache as never);
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  it('reports how much is searchable, counting only live products, approved stores and active categories', async () => {
    await expect(service.getSearchStatus()).resolves.toEqual({
      ready: true,
      totalDocuments: 22,
      breakdown: { products: 10, vendors: 3, categories: 4, orders: 5 },
    });
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { isDeleted: false, isActive: true },
    });
    expect(prisma.vendor.count).toHaveBeenCalledWith({
      where: { isActive: true, isApproved: true },
    });
  });

  it('says it is not ready, with zero counts, when the database cannot answer', async () => {
    prisma.order.count.mockRejectedValue(new Error('db down'));

    await expect(service.getSearchStatus()).resolves.toEqual({
      ready: false,
      totalDocuments: 0,
      breakdown: { products: 0, vendors: 0, categories: 0, orders: 0 },
    });
  });

  it('purges the cache and reports the documents it can search', async () => {
    await expect(service.reindex()).resolves.toEqual({
      message: 'Search indices synchronized and cache purged successfully',
      indexedCount: 22,
    });
    expect(cache.flush).toHaveBeenCalledTimes(1);
  });

  it('flushes through the cache service', async () => {
    await expect(service.flushSearchCache()).resolves.toBe(7);
  });
});
