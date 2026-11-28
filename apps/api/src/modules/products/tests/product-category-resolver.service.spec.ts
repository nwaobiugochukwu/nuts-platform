import { BadRequestException } from '@nestjs/common';
import { ProductCategoryResolverService } from '../services/product-category-resolver.service';

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('ProductCategoryResolverService', () => {
  let prisma: any;
  let cache: { wrap: jest.Mock };
  let service: ProductCategoryResolverService;
  const categories = [
    { id: UUID(1), name: 'Food', slug: 'food', parentId: null },
    { id: UUID(2), name: 'Snacks', slug: 'snacks', parentId: UUID(1) },
    { id: UUID(3), name: 'Nuts', slug: 'nuts', parentId: UUID(2) },
    { id: UUID(4), name: 'Drinks', slug: 'drinks', parentId: null },
  ];

  beforeEach(() => {
    prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue(categories),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    cache = { wrap: jest.fn((_k, _ttl, load) => load()) };
    service = new ProductCategoryResolverService(prisma, cache as never);
  });

  describe('the category map', () => {
    it('is built once and then served from memory', async () => {
      const first = await service.getCategoryLookupMap();
      const second = await service.getCategoryLookupMap();

      expect(first.get(UUID(3))).toMatchObject({ slug: 'nuts' });
      expect(second).toBe(first);
      expect(cache.wrap).toHaveBeenCalledTimes(1);
    });

    it('is rebuilt after it is invalidated', async () => {
      await service.getCategoryLookupMap();
      service.invalidateLookup();
      await service.getCategoryLookupMap();

      expect(cache.wrap).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveCategoryId (a category a product can be filed under)', () => {
    const found = (over: object = {}) =>
      prisma.category.findFirst.mockResolvedValue({
        id: UUID(3),
        status: 'ACTIVE',
        isActive: true,
        _count: { children: 0 },
        ...over,
      });

    it('returns the id of an active leaf category', async () => {
      found();

      await expect(service.resolveCategoryId(UUID(3))).resolves.toBe(UUID(3));
    });

    it.each([
      ['no id', async () => service.resolveCategoryId(undefined), /required/],
      [
        'an unknown category',
        async () => {
          prisma.category.findFirst.mockResolvedValue(null);
          return service.resolveCategoryId(UUID(9));
        },
        /not found/,
      ],
      [
        'an archived category',
        async () => {
          found({ status: 'ARCHIVED' });
          return service.resolveCategoryId(UUID(3));
        },
        /archived/,
      ],
      [
        'an inactive category',
        async () => {
          found({ isActive: false });
          return service.resolveCategoryId(UUID(3));
        },
        /inactive/,
      ],
      [
        'a category with children',
        async () => {
          found({ _count: { children: 2 } });
          return service.resolveCategoryId(UUID(2));
        },
        /leaf/,
      ],
    ])('refuses %s', async (_label, call, message) => {
      await expect(call()).rejects.toThrow(BadRequestException);
      await expect(call()).rejects.toThrow(message);
    });
  });

  describe('collectCategoryAndDescendantIds', () => {
    it('returns the category and everything under it, at any depth', async () => {
      const ids = await service.collectCategoryAndDescendantIds(UUID(1));

      expect(ids.sort()).toEqual([UUID(1), UUID(2), UUID(3)].sort());
    });

    it('returns just a leaf', async () => {
      await expect(
        service.collectCategoryAndDescendantIds(UUID(3)),
      ).resolves.toEqual([UUID(3)]);
    });

    it('finds a category by its slug first', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: UUID(4) });

      await expect(
        service.collectCategoryAndDescendantIds('drinks'),
      ).resolves.toEqual([UUID(4)]);
    });

    it('treats an unknown slug as itself, so the filter matches nothing', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.collectCategoryAndDescendantIds('nope'),
      ).resolves.toEqual(['nope']);
    });

    it('has nothing for an empty id', async () => {
      await expect(
        service.collectCategoryAndDescendantIds(''),
      ).resolves.toEqual([]);
    });

    it('falls back to a recursive query when the map has no such category', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: UUID(8) }, { id: UUID(9) }]);

      await expect(
        service.collectCategoryAndDescendantIds(UUID(8)),
      ).resolves.toEqual([UUID(8), UUID(9)]);
    });
  });
});
