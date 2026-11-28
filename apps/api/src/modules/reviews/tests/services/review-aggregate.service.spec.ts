import { ReviewAggregateService } from '../../services/review-aggregate.service';

describe('ReviewAggregateService', () => {
  let prisma: {
    review: { groupBy: jest.Mock };
    product: { updateMany: jest.Mock };
  };
  let cache: { del: jest.Mock };
  let service: ReviewAggregateService;

  const groups = (rows: Array<[number, number]>) =>
    rows.map(([rating, n]) => ({ rating, _count: { _all: n } }));

  beforeEach(() => {
    prisma = {
      review: { groupBy: jest.fn() },
      product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    service = new ReviewAggregateService(prisma as never, cache as never);
  });

  it('counts only active reviews of the product, grouped by star', async () => {
    prisma.review.groupBy.mockResolvedValue([]);

    await service.recompute('p-1');

    expect(prisma.review.groupBy).toHaveBeenCalledWith({
      by: ['rating'],
      where: { productId: 'p-1', isActive: true },
      _count: { _all: true },
    });
  });

  it('stores the count, the average to one decimal place and the breakdown on the product', async () => {
    prisma.review.groupBy.mockResolvedValue(
      groups([
        [5, 3],
        [4, 1],
        [1, 1],
      ]),
    );

    const summary = await service.recompute('p-1');

    expect(summary).toEqual({
      count: 5,
      average: 4, // (15 + 4 + 1) / 5
      breakdown: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 3 },
    });
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: {
        ratingCount: 5,
        ratingAverage: 4,
        ratingBreakdown: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 3 },
      },
    });
  });

  it('rounds the average to one decimal place', async () => {
    prisma.review.groupBy.mockResolvedValue(
      groups([
        [5, 1],
        [4, 1],
        [4, 1],
      ]),
    );

    const { average } = await service.recompute('p-1');

    expect(average).toBe(4.3); // 13 / 3
  });

  it('resets a product whose last review was removed', async () => {
    prisma.review.groupBy.mockResolvedValue([]);

    const summary = await service.recompute('p-1');

    expect(summary.count).toBe(0);
    expect(summary.average).toBe(0);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { ratingCount: 0, ratingAverage: 0, ratingBreakdown: undefined },
    });
  });

  it('is the same however often it runs: it recomputes, it does not add', async () => {
    prisma.review.groupBy.mockResolvedValue(groups([[5, 2]]));

    const first = await service.recompute('p-1');
    const second = await service.recompute('p-1');

    expect(second).toEqual(first);
    expect(prisma.product.updateMany.mock.calls[0]).toEqual(
      prisma.product.updateMany.mock.calls[1],
    );
  });

  it('clears both generations of the cached review list so it never outlives the summary', async () => {
    prisma.review.groupBy.mockResolvedValue([]);

    await service.recompute('p-1');

    expect(cache.del).toHaveBeenCalledWith('product:reviews:p-1');
    expect(cache.del).toHaveBeenCalledWith('product:reviews:p-1:v2');
  });

  it('leaves a deleted product alone (nothing to update, no error)', async () => {
    prisma.review.groupBy.mockResolvedValue(groups([[5, 1]]));
    prisma.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.recompute('gone')).resolves.toMatchObject({
      count: 1,
    });
  });
});
