import { ROLE } from '@prisma/client';
import { MarketplaceEventsService } from './marketplace-events.service';
import { RecommendationEventsService } from './recommendation-events.service';
import { SearchTrackingService } from './search-tracking.service';

const click = {
  id: 'r1',
  eventType: 'CLICK',
  surface: 'HOME',
  productId: 'p1',
  sessionId: 's1',
} as never;
const impression = {
  ...(click as object),
  id: 'r2',
  eventType: 'IMPRESSION',
} as never;

describe('tracking producers: queue first, database as the fallback', () => {
  let prisma: {
    recommendationEvent: { create: jest.Mock; createMany: jest.Mock };
    searchQuery: { create: jest.Mock };
    marketplaceEvent: { create: jest.Mock };
  };
  let cache: { invalidateRecommendations: jest.Mock };
  let queue: { enqueue: jest.Mock };

  beforeEach(() => {
    prisma = {
      recommendationEvent: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      searchQuery: { create: jest.fn().mockResolvedValue({}) },
      marketplaceEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    cache = {
      invalidateRecommendations: jest.fn().mockResolvedValue(undefined),
    };
    queue = { enqueue: jest.fn().mockResolvedValue(true) };
  });

  describe('recommendation events', () => {
    const service = () =>
      new RecommendationEventsService(prisma as never, cache as never, queue);

    it('queues a click with no database write and no immediate feed refresh; the consumer refreshes once', async () => {
      await expect(service().record('u1', click, ROLE.USER)).resolves.toEqual({
        accepted: true,
      });

      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'recommendation_events',
          events: [expect.objectContaining({ id: 'r1', userId: 'u1' })],
          refreshFor: ['u1', 's1'],
        }),
      );
      expect(prisma.recommendationEvent.create).not.toHaveBeenCalled();
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
    });

    it('asks for no refresh for impressions, which do not change what to recommend', async () => {
      await service().record('u1', impression, ROLE.USER);

      expect(queue.enqueue.mock.calls[0][0].refreshFor).toEqual([]);
    });

    it('queues a whole batch as one message and reports how many were accepted', async () => {
      const result = await service().recordMany(
        'u1',
        [click, impression],
        ROLE.USER,
      );

      expect(result).toEqual({ accepted: true, stored: 2 });
      expect(queue.enqueue).toHaveBeenCalledTimes(1);
      expect(queue.enqueue.mock.calls[0][0].events).toHaveLength(2);
      expect(prisma.recommendationEvent.createMany).not.toHaveBeenCalled();
    });

    it('records a vendor browsing as an anonymous shopper', async () => {
      await service().record('vendor-1', click, ROLE.VENDOR);

      expect(queue.enqueue.mock.calls[0][0].events[0].userId).toBeNull();
    });

    it('falls back to storing the event itself, and refreshing the feed at once, when the broker is down', async () => {
      queue.enqueue.mockResolvedValue(false);

      await expect(service().record('u1', click, ROLE.USER)).resolves.toEqual({
        accepted: true,
      });

      expect(prisma.recommendationEvent.create).toHaveBeenCalledTimes(1);
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith('u1', 's1');
    });

    it('falls back for a batch too', async () => {
      queue.enqueue.mockResolvedValue(false);

      const result = await service().recordMany('u1', [click], ROLE.USER);

      expect(result).toEqual({ accepted: true, stored: 1 });
      expect(prisma.recommendationEvent.createMany).toHaveBeenCalledTimes(1);
    });

    it('still works with no queue configured at all', async () => {
      const bare = new RecommendationEventsService(
        prisma as never,
        cache as never,
      );

      await bare.record('u1', click, ROLE.USER);

      expect(prisma.recommendationEvent.create).toHaveBeenCalledTimes(1);
    });

    it('queues nothing for an admin or an event with no target', async () => {
      await service().record('a1', click, ROLE.ADMIN);
      await service().record(
        'u1',
        { ...(click as object), productId: undefined } as never,
        ROLE.USER,
      );

      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('search tracking', () => {
    const service = () =>
      new SearchTrackingService(prisma as never, cache as never, queue);

    it('queues the search under an id of its own, with the identities to refresh, and writes nothing in the request', async () => {
      await service().trackSearch('red shoes', 3, 'u1', 's1', 'v1', 'cache-u1');

      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search',
          id: expect.any(String),
          query: 'red shoes',
          resultsCount: 3,
          userId: 'u1',
          sessionId: 's1',
          refreshFor: ['u1', 'cache-u1', 's1', 'v1'],
        }),
      );
      expect(prisma.searchQuery.create).not.toHaveBeenCalled();
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
    });

    it('falls back to the synchronous write and an immediate refresh when the broker is down', async () => {
      queue.enqueue.mockResolvedValue(false);

      await service().trackSearch('red shoes', 3, 'u1', 's1', 'v1', 'cache-u1');

      expect(prisma.searchQuery.create).toHaveBeenCalledTimes(1);
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
        'u1',
        'cache-u1',
        's1',
        'v1',
      );
    });
  });

  describe('marketplace events', () => {
    const service = () => new MarketplaceEventsService(prisma as never, queue);

    it('queues a cart action under a generated id, with no database write', async () => {
      await expect(
        service().record({
          eventType: 'CART_ADD',
          productId: 'p1',
          userId: 'u1',
          quantity: 2,
        }),
      ).resolves.toEqual({ accepted: true });

      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'marketplace_event',
          event: expect.objectContaining({
            id: expect.any(String),
            eventType: 'CART_ADD',
            quantity: 2,
          }),
        }),
      );
      expect(prisma.marketplaceEvent.create).not.toHaveBeenCalled();
    });

    it('keeps an id the caller chose', async () => {
      await service().record({
        id: 'evt-9',
        eventType: 'WISHLIST_ADD',
        productId: 'p1',
      });

      expect(queue.enqueue.mock.calls[0][0].event.id).toBe('evt-9');
    });

    it('stores it itself, under the same id, when the broker is down', async () => {
      queue.enqueue.mockResolvedValue(false);

      await service().record({
        id: 'evt-9',
        eventType: 'CART_ADD',
        productId: 'p1',
      });

      expect(prisma.marketplaceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 'evt-9', eventType: 'CART_ADD' }),
      });
    });

    it('never fails the commerce write: an unexpected error is reported as not accepted', async () => {
      queue.enqueue.mockRejectedValue(new Error('boom'));
      const svc = service();
      jest
        .spyOn((svc as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        svc.record({ eventType: 'CART_ADD', productId: 'p1' }),
      ).resolves.toEqual({ accepted: false });
    });
  });
});
