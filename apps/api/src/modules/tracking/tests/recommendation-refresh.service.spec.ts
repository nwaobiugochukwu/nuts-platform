import {
  REFRESH_DEBOUNCE_MS,
  RecommendationRefreshService,
} from '../services/recommendation-refresh.service';

describe('RecommendationRefreshService', () => {
  let cache: { invalidateRecommendations: jest.Mock };
  let service: RecommendationRefreshService;
  const flush = async () => {
    // let the async refresh (clear, then warm) finish
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    cache = {
      invalidateRecommendations: jest.fn().mockResolvedValue(undefined),
    };
    service = new RecommendationRefreshService(cache as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('clears a shopper once after a burst of clicks, not once per click', async () => {
    for (let i = 0; i < 10; i += 1) {
      service.schedule(['user-1', 'session-1']);
      jest.advanceTimersByTime(100);
    }
    expect(cache.invalidateRecommendations).not.toHaveBeenCalled();

    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await flush();

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
      'user-1',
      'session-1',
    );
  });

  it('gathers the identities of every click in the burst into the one clear', async () => {
    service.schedule(['user-1', 'session-1']);
    service.schedule(['user-1', 'session-2']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await flush();

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      'session-2',
    );
  });

  it('clears again for a click that comes after the burst has been refreshed', async () => {
    service.schedule(['user-1']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await flush();
    service.schedule(['user-1']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await flush();

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(2);
  });

  it('keeps different shoppers independent', async () => {
    service.schedule(['user-1']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS / 2);
    service.schedule(['user-2']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS / 2);
    await flush();

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith('user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS / 2);
    await flush();
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith('user-2');
  });

  it('ignores empty identities, and a call with nobody to refresh', async () => {
    service.schedule([undefined, null, '']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await flush();

    expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
  });

  describe('warming the feed', () => {
    const actor = { userId: 'user-1', sessionId: 'session-1' };

    it('recomputes the feed once, after clearing it, so the next read is a cache hit', async () => {
      const order: string[] = [];
      cache.invalidateRecommendations.mockImplementation(() => {
        order.push('clear');
        return Promise.resolve();
      });
      const warmer = jest.fn().mockImplementation(() => {
        order.push('warm');
        return Promise.resolve([]);
      });
      service.registerWarmer(warmer);

      for (let i = 0; i < 5; i += 1)
        service.schedule(['user-1', 'session-1'], actor);
      jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
      await flush();

      expect(warmer).toHaveBeenCalledTimes(1);
      expect(warmer).toHaveBeenCalledWith(actor);
      expect(order).toEqual(['clear', 'warm']);
    });

    it("does not warm without an actor (a guest's feed is keyed by an id the events do not carry)", async () => {
      const warmer = jest.fn().mockResolvedValue([]);
      service.registerWarmer(warmer);

      service.schedule(['session-1']);
      jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
      await flush();

      expect(cache.invalidateRecommendations).toHaveBeenCalledWith('session-1');
      expect(warmer).not.toHaveBeenCalled();
    });

    it('only clears when no warmer is registered (an api process)', async () => {
      service.schedule(['user-1'], actor);
      jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
      await flush();

      expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
    });

    it('survives a failing recompute', async () => {
      service.registerWarmer(jest.fn().mockRejectedValue(new Error('db down')));

      service.schedule(['user-1'], actor);
      jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
      await flush();

      expect((service as any).logger.warn).toHaveBeenCalled();
    });
  });

  it('survives a cache failure', async () => {
    cache.invalidateRecommendations.mockRejectedValue(new Error('redis down'));

    service.schedule(['user-1']);
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await flush();

    expect((service as any).logger.warn).toHaveBeenCalled();
  });

  it('cancels pending refreshes on shutdown', () => {
    service.schedule(['user-1']);
    service.onModuleDestroy();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2);

    expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
  });
});
