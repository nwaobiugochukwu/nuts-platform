import { ROLE } from '@prisma/client';
import { RecommendationEventsService } from './recommendation-events.service';
import { SearchTrackingService } from './search-tracking.service';

const click = {
  id: 'r1',
  eventType: 'CLICK',
  surface: 'HOME_FOR_YOU',
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
  };
  let cache: { invalidateRecommendations: jest.Mock };
  let queue: { record: jest.Mock; recordAll: jest.Mock };

  beforeEach(() => {
    prisma = {
      recommendationEvent: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      searchQuery: { create: jest.fn().mockResolvedValue({}) },
    };
    cache = {
      invalidateRecommendations: jest.fn().mockResolvedValue(undefined),
    };
    queue = {
      record: jest.fn().mockResolvedValue(true),
      recordAll: jest.fn().mockResolvedValue(true),
    };
  });

  describe('recommendation events', () => {
    const service = () =>
      new RecommendationEventsService(prisma as never, cache as never, queue);

    it('queues a click as shopper activity with no database write and no immediate feed refresh; the consumer refreshes once', async () => {
      await expect(service().record('u1', click, ROLE.USER)).resolves.toEqual({
        accepted: true,
      });

      expect(queue.recordAll).toHaveBeenCalledWith([
        expect.objectContaining({
          action: 'shelf_item_clicked',
          id: 'r1',
          surface: 'HOME_FOR_YOU',
          productId: 'p1',
          userId: 'u1',
          sessionId: 's1',
        }),
      ]);
      expect(prisma.recommendationEvent.create).not.toHaveBeenCalled();
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
    });

    it('names each kind of interaction as its own action', async () => {
      await service().recordMany(
        'u1',
        [
          click,
          impression,
          { ...(click as object), id: 'r3', eventType: 'DISMISS' } as never,
          {
            ...(click as object),
            id: 'r4',
            eventType: 'CATEGORY_VIEW',
            productId: undefined,
            categoryId: 'c1',
          } as never,
        ],
        ROLE.USER,
      );

      expect(
        queue.recordAll.mock.calls[0][0].map(
          (a: { action: string }) => a.action,
        ),
      ).toEqual([
        'shelf_item_clicked',
        'shelf_item_seen',
        'shelf_item_dismissed',
        'category_viewed',
      ]);
    });

    it('queues a whole batch and reports how many were accepted', async () => {
      const result = await service().recordMany(
        'u1',
        [click, impression],
        ROLE.USER,
      );

      expect(result).toEqual({ accepted: true, stored: 2 });
      expect(queue.recordAll).toHaveBeenCalledTimes(1);
      expect(queue.recordAll.mock.calls[0][0]).toHaveLength(2);
      expect(prisma.recommendationEvent.createMany).not.toHaveBeenCalled();
    });

    it('records a vendor browsing as an anonymous shopper', async () => {
      await service().record('vendor-1', click, ROLE.VENDOR);

      expect(queue.recordAll.mock.calls[0][0][0].userId).toBeNull();
    });

    it('falls back to storing the event itself, and refreshing the feed at once, when the broker is down', async () => {
      queue.recordAll.mockResolvedValue(false);

      await expect(service().record('u1', click, ROLE.USER)).resolves.toEqual({
        accepted: true,
      });

      expect(prisma.recommendationEvent.create).toHaveBeenCalledTimes(1);
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith('u1', 's1');
    });

    it('falls back for a batch too', async () => {
      queue.recordAll.mockResolvedValue(false);

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

      expect(queue.recordAll).not.toHaveBeenCalled();
    });
  });

  describe('search tracking', () => {
    const service = () =>
      new SearchTrackingService(prisma as never, cache as never, queue);

    it('queues the search as shopper activity under an id of its own, and writes nothing in the request', async () => {
      await service().trackSearch('red shoes', 3, 'u1', 's1', 'v1', 'cache-u1');

      expect(queue.record).toHaveBeenCalledWith({
        action: 'searched',
        id: expect.any(String),
        query: 'red shoes',
        resultsCount: 3,
        userId: 'u1',
        sessionId: 's1',
        visitorId: 'v1',
      });
      expect(prisma.searchQuery.create).not.toHaveBeenCalled();
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
    });

    it('falls back to the synchronous write and an immediate refresh when the broker is down', async () => {
      queue.record.mockResolvedValue(false);

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
});
