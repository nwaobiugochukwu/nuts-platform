import { PersonalizedFeedService } from './personalized-feed.service';
import { PopularProductsService } from './popular-products.service';

const card = (id: string) => ({ id, name: id }) as never;

describe('PersonalizedFeedService behaviour', () => {
  describe('following() feed', () => {
    const make = (
      productsByVendor: Record<
        string,
        Array<{ id: string; vendorId: string; createdAt: Date }>
      >,
    ) => {
      const prisma = {
        vendorFollow: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              Object.keys(productsByVendor).map((vendorId) => ({ vendorId })),
            ),
        },
        product: {
          findMany: jest
            .fn()
            .mockImplementation(({ where }: { where: { vendorId: string } }) =>
              Promise.resolve(productsByVendor[where.vendorId] ?? []),
            ),
        },
      };
      const products = {
        findPublicCardsByIds: jest
          .fn()
          .mockImplementation((ids: string[]) =>
            Promise.resolve([...ids].reverse().map(card)),
          ),
      };
      return {
        prisma,
        products,
        service: new PersonalizedFeedService(
          prisma as never,
          products as never,
          new PopularProductsService(products as never),
        ),
      };
    };

    const at = (n: number) => new Date(2026, 0, n);

    it('returns nothing when the shopper follows no store', async () => {
      const { service } = make({});
      await expect(service.following('u1')).resolves.toEqual([]);
    });

    it('is ordered newest-first across stores (not impression-suppressed)', async () => {
      const { service } = make({
        vA: [{ id: 'a-old', vendorId: 'vA', createdAt: at(1) }],
        vB: [{ id: 'b-new', vendorId: 'vB', createdAt: at(9) }],
        vC: [{ id: 'c-mid', vendorId: 'vC', createdAt: at(5) }],
      });
      const ids = (await service.following('u1')).map((c) => c.id);
      expect(ids).toEqual(['b-new', 'c-mid', 'a-old']);
    });

    it('caps each store at 3 so one busy store cannot crowd out the others', async () => {
      const busy = Array.from({ length: 4 }, (_, i) => ({
        id: `busy-${i}`,
        vendorId: 'vBusy',
        createdAt: at(20 - i),
      }));
      const { service } = make({
        vBusy: busy,
        vQuiet: [{ id: 'quiet', vendorId: 'vQuiet', createdAt: at(1) }],
      });
      const ids = (await service.following('u1')).map((c) => c.id);
      expect(ids.filter((id) => id.startsWith('busy-')).length).toBe(3);
      expect(ids).toContain('quiet');
    });
  });

  describe('forYou() never returns an empty shelf', () => {
    it('re-shows already-viewed products when the shopper has seen the whole catalogue', async () => {
      const pool = ['a', 'b', 'c'].map(card);
      const empty = () => ({ findMany: jest.fn().mockResolvedValue([]) });
      const prisma = {
        productView: empty(),
        recentProductView: {
          findMany: jest.fn().mockResolvedValue(
            ['a', 'b', 'c'].map((productId) => ({
              productId,
              lastViewedAt: new Date(),
            })),
          ),
        },
        orderItem: { ...empty(), groupBy: jest.fn().mockResolvedValue([]) },
        wishlistItem: empty(),
        cartItem: empty(),
        searchQuery: empty(),
        recommendationEvent: empty(),
        vendorFollow: empty(),
        product: {
          findMany: jest
            .fn()
            .mockImplementation(
              ({ where }: { where?: { id?: { in?: string[] } } }) =>
                Promise.resolve(
                  (where?.id?.in ?? [])
                    .filter((id) => ['a', 'b', 'c'].includes(id))
                    .map((id) => ({ id, categoryId: 'c1', vendorId: 'v1' })),
                ),
            ),
        },
      };
      const products = {
        findPublicCardsByIds: jest.fn().mockResolvedValue([]),
        findTrending: jest.fn().mockResolvedValue(pool),
      };
      const service = new PersonalizedFeedService(
        prisma as never,
        products as never,
        new PopularProductsService(products as never),
      );

      const result = await service.forYou('user-1', 'sess', 'visitor');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('claimRecentlyViewed()', () => {
    const make = (
      visitorViews: Array<{ productId: string; lastViewedAt: Date }>,
      existing: Array<{ productId: string; lastViewedAt: Date }>,
    ) => {
      const tx = {
        recentProductView: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce(visitorViews)
            .mockResolvedValueOnce(existing),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const prisma = {
        $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
      };
      const cache = {
        invalidateRecommendations: jest.fn().mockResolvedValue(undefined),
      };
      const products = {};
      return {
        tx,
        cache,
        service: new PersonalizedFeedService(
          prisma as never,
          products as never,
          new PopularProductsService(products as never),
          cache as never,
        ),
      };
    };
    const t = new Date('2026-01-01');

    it('reports 0 (and clears nothing) when everything was already merged', async () => {
      const { service, cache } = make(
        [{ productId: 'p1', lastViewedAt: t }],
        [{ productId: 'p1', lastViewedAt: t }],
      );
      await expect(
        service.claimRecentlyViewed('user-1', 'visitor-1'),
      ).resolves.toEqual({ claimed: 0 });
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
    });

    it('reports only newly merged rows and clears both identities’ caches', async () => {
      const { service, cache } = make(
        [
          { productId: 'p1', lastViewedAt: t },
          { productId: 'p2', lastViewedAt: t },
        ],
        [{ productId: 'p1', lastViewedAt: t }],
      );
      await expect(
        service.claimRecentlyViewed('user-1', 'visitor-1'),
      ).resolves.toEqual({ claimed: 1 });
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
        'user-1',
        'visitor-1',
      );
    });
  });

  describe('forYou() top-up', () => {
    it('keeps the shelf full of popular, unseen products when personal interest matches little', async () => {
      const trending = Array.from({ length: 12 }, (_, i) => card(`pop-${i}`));
      trending.unshift(card('seen'));

      const empty = () => ({ findMany: jest.fn().mockResolvedValue([]) });
      const prisma = {
        productView: empty(),
        recentProductView: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { productId: 'seen', lastViewedAt: new Date() },
            ]),
        },
        orderItem: { ...empty(), groupBy: jest.fn().mockResolvedValue([]) },
        wishlistItem: empty(),
        cartItem: empty(),
        searchQuery: empty(),
        recommendationEvent: empty(),
        vendorFollow: empty(),
        product: {
          findMany: jest
            .fn()
            .mockImplementation(
              ({ where }: { where?: { id?: { in?: string[] } } }) =>
                Promise.resolve(
                  where?.id?.in?.includes('seen')
                    ? [{ id: 'seen', categoryId: 'c1', vendorId: 'v1' }]
                    : [],
                ),
            ),
        },
      };
      const products = {
        findPublicCardsByIds: jest.fn().mockResolvedValue([]),
        findTrending: jest.fn().mockResolvedValue(trending),
      };
      const service = new PersonalizedFeedService(
        prisma as never,
        products as never,
        new PopularProductsService(products as never),
      );

      const result = await service.forYou('user-1', 'sess', 'visitor');

      expect(result).toHaveLength(12);
      expect(result.map((c) => c.id)).not.toContain('seen');
    });
  });
});
