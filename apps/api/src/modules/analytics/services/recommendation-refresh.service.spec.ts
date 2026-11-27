import {
  REFRESH_DEBOUNCE_MS,
  RecommendationRefreshService,
} from './recommendation-refresh.service';

describe('RecommendationRefreshService', () => {
  let cache: { invalidateRecommendations: jest.Mock };
  let service: RecommendationRefreshService;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = {
      invalidateRecommendations: jest.fn().mockResolvedValue(undefined),
    };
    service = new RecommendationRefreshService(cache as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('clears a shopper once after a burst of clicks, not once per click', () => {
    for (let i = 0; i < 10; i += 1) {
      service.schedule('user-1', 'session-1');
      jest.advanceTimersByTime(100);
    }
    expect(cache.invalidateRecommendations).not.toHaveBeenCalled();

    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(2);
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith('user-1');
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith('session-1');
  });

  it('clears again for a click that comes after the burst has been refreshed', () => {
    service.schedule('user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    service.schedule('user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(2);
  });

  it('keeps different shoppers independent', () => {
    service.schedule('user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS / 2);
    service.schedule('user-2');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS / 2);

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith('user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS / 2);
    expect(cache.invalidateRecommendations).toHaveBeenCalledWith('user-2');
  });

  it('ignores empty identities and duplicates', () => {
    service.schedule(undefined, null, '', 'user-1', 'user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);

    expect(cache.invalidateRecommendations).toHaveBeenCalledTimes(1);
  });

  it('survives a cache failure', async () => {
    cache.invalidateRecommendations.mockRejectedValue(new Error('redis down'));
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    service.schedule('user-1');
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    await Promise.resolve();

    expect((service as any).logger.warn).toHaveBeenCalled();
  });

  it('cancels pending refreshes on shutdown', () => {
    service.schedule('user-1');
    service.onModuleDestroy();
    jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2);

    expect(cache.invalidateRecommendations).not.toHaveBeenCalled();
  });
});
