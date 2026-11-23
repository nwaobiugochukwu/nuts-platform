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
