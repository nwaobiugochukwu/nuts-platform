import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductCatalogService } from '../services/product-catalog.service';

describe('ProductCatalogService', () => {
  let prisma: any;
  let categories: { collectCategoryAndDescendantIds: jest.Mock };
  let service: ProductCatalogService;

  beforeEach(() => {
    prisma = { category: { findFirst: jest.fn() } };
    categories = {
      collectCategoryAndDescendantIds: jest
        .fn()
        .mockResolvedValue(['c-1', 'c-2']),
    };
    service = new ProductCatalogService(
      prisma,
      {} as never,
      {} as never,
      categories as never,
    );
  });

  const where = (params: object = {}) =>
    (service as any).buildPublicWhere(params);

  describe('the public filter', () => {
    it('only ever shows live products of live, approved vendors', async () => {
      await expect(where()).resolves.toEqual({
        AND: [
          {
            isDeleted: false,
            isActive: true,
            vendor: { isActive: true, isApproved: true },
          },
        ],
      });
    });

    it('refuses a price range that cannot match anything', async () => {
      await expect(where({ minPrice: 10, maxPrice: 5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('filters by vendor, price and search', async () => {
      const { AND } = await where({
        vendorId: 'v-1',
        minPrice: 5,
        maxPrice: 10,
        search: 'shoe',
      });

      expect(AND).toContainEqual({ vendorId: 'v-1' });
      expect(AND).toContainEqual({ price: { gte: 5, lte: 10 } });
      const search = AND.find((c: any) => c.OR?.[0]?.name);
      expect(search.OR.map((o: any) => Object.keys(o)[0])).toEqual([
        'name',
        'sku',
        'description',
      ]);
    });

    it('treats in stock as product stock or any live variant with stock', async () => {
      const { AND } = await where({ inStock: true });

      expect(AND[1].OR[0]).toEqual({ stock: { gt: 0 } });
      expect(AND[1].OR[1]).toMatchObject({ hasVariants: true });
    });

    it('treats out of stock as no product stock and no variant with stock', async () => {
      const { AND } = await where({ inStock: false });

      expect(AND[1].AND[0]).toEqual({ stock: { lte: 0 } });
      expect(AND[1].AND[1].variants.none).toBeDefined();
    });

    it('widens a category to everything under it', async () => {
      const id = '00000000-0000-4000-8000-000000000001';

      const { AND } = await where({ categoryId: id });

      expect(categories.collectCategoryAndDescendantIds).toHaveBeenCalledWith(
        id,
      );
      expect(AND).toContainEqual({ categoryId: { in: ['c-1', 'c-2'] } });
    });

    it('finds a category by slug, and says so when there is none', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'c-9' });
      await where({ category: 'snacks' });
      expect(categories.collectCategoryAndDescendantIds).toHaveBeenCalledWith(
        'c-9',
      );

      prisma.category.findFirst.mockResolvedValue(null);
      await expect(where({ category: 'nope' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cache keys', () => {
    const page = (p: object) => (service as any).getPublicProductsCacheKey(p);
    const cursor = (p: object) =>
      (service as any).getPublicCursorCacheKey({ limit: 10, ...p });

    it('say every filter that changes the result, so different lists never share an entry', () => {
      const base = page({});
      const variants = [
        { page: 2 },
        { limit: 20 },
        { search: 'a' },
        { categoryId: 'c' },
        { categoryPath: 'a/b' },
        { vendorId: 'v' },
        { inStock: true },
        { minPrice: 1 },
        { maxPrice: 9 },
        { sort: 'price_asc' },
      ].map(page);

      expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
      expect(cursor({ cursor: 'x' })).not.toBe(cursor({}));
    });

    it('are the same for the same request, and keep the two listings apart', () => {
      expect(page({ search: 'a' })).toBe(page({ search: 'a' }));
      expect(page({})).toMatch(/^product:list:public:/);
      expect(cursor({})).toMatch(/^product:list:public:cursor:/);
    });

    it('cannot be tricked by a search that looks like another key', () => {
      expect(page({ search: 'a:category:b' })).not.toBe(
        page({ search: 'a', categoryId: 'b' }),
      );
    });
  });
});
