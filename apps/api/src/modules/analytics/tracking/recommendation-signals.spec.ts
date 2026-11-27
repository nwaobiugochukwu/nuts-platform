import { ROLE } from '@prisma/client';

import { RecommendationEventsService } from '../services/recommendation-events.service';
import { SearchTrackingService } from '../services/search-tracking.service';

describe('behavioural signals refresh recommendations', () => {
  describe('RecommendationEventsService', () => {
    const make = () => {
      const prisma = {
        recommendationEvent: {
          create: jest.fn().mockResolvedValue({}),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const cache = {
        invalidateRecommendations: jest.fn().mockResolvedValue(undefined),
      };
      return {
        prisma,
        cache,
        service: new RecommendationEventsService(
          prisma as never,
          cache as never,
        ),
      };
    };

    const event = (eventType: string) =>
      ({
        id: 'e1',
        eventType,
        surface: 'HOME_FOR_YOU',
        productId: 'p1',
        sessionId: 'sess-1',
      }) as never;

    it('impressions do NOT clear the cache (they would defeat caching entirely)', async () => {
      const { service, cache } = make();
      await service.record('user-1', event('IMPRESSION'));
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
    });

    it('a click clears the shopper’s recommendations', async () => {
      const { service, cache } = make();
      await service.record('user-1', event('CLICK'));
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
        'user-1',
        'sess-1',
      );
    });

    it('a vendor’s click is cleared under their real user id (their cache key)', async () => {
      const { service, cache } = make();
      await service.record('vendor-1', event('CLICK'), ROLE.VENDOR);
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
        'vendor-1',
        'sess-1',
      );
    });

    it('a batch of only impressions does not clear, a mixed batch does', async () => {
      const { service, cache } = make();
      await service.recordMany('user-1', [event('IMPRESSION')]);
      expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
      await service.recordMany('user-1', [
        event('IMPRESSION'),
        event('CATEGORY_VIEW'),
      ]);
      expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
    });
  });

  describe('SearchTrackingService', () => {
    it('saves the search BEFORE clearing, and clears every identity the shelves may be keyed by', async () => {
      const order: string[] = [];
      const prisma = {
        searchQuery: {
          create: jest.fn().mockImplementation(() => {
            order.push('save');
            return Promise.resolve({});
          }),
        },
      };
      const cache = {
        invalidateRecommendations: jest.fn().mockImplementation(() => {
          order.push('clear');
          return Promise.resolve();
        }),
      };
      const service = new SearchTrackingService(
        prisma as never,
        cache as never,
      );

      await service.trackSearch(
        'leather',
        3,
        undefined,
        'sess',
        'visitor',
        'vendor-1',
      );

      expect(order).toEqual(['save', 'clear']);
      expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
        undefined,
        'vendor-1',
        'sess',
        'visitor',
      );
    });
  });
});
