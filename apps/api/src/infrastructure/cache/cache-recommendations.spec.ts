import { CacheService } from './cache.service';

describe('CacheService recommendation invalidation', () => {
  const make = () => {
    const redis = { del: jest.fn().mockResolvedValue(1) };
    const service = new CacheService(redis as never, {} as never);
    return { redis, service };
  };

  it('clears every personalised shelf for each identity in ONE redis call', async () => {
    const { redis, service } = make();
    await service.invalidateRecommendations('user-1', 'visitor-1', 'session-1');

    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith(
      'recommendations:for-you:user-1',
      'recommendations:search-discover:user-1',
      'recommendations:stores:user-1',
      'recommendations:for-you:visitor-1',
      'recommendations:search-discover:visitor-1',
      'recommendations:stores:visitor-1',
      'recommendations:for-you:session-1',
      'recommendations:search-discover:session-1',
      'recommendations:stores:session-1',
    );
  });

  it('de-duplicates identities and ignores empty ones', async () => {
    const { redis, service } = make();
    await service.invalidateRecommendations('a', 'a', undefined, null, '');
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect((redis.del.mock.calls[0] as string[]).length).toBe(3);
  });

  it('does not touch redis when there is no identity', async () => {
    const { redis, service } = make();
    await service.invalidateRecommendations(undefined, null);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('never clears the deterministic daily starter sampler', async () => {
    const { redis, service } = make();
    await service.invalidateRecommendations('user-1');
    const keys = redis.del.mock.calls[0] as string[];
    expect(keys.some((k) => k.includes(':starter-sampler:'))).toBe(false);
  });

  it('a redis failure is swallowed (cache clearing must never fail a request)', async () => {
    const redis = { del: jest.fn().mockRejectedValue(new Error('down')) };
    const service = new CacheService(redis as never, {} as never);
    await expect(
      service.invalidateRecommendations('user-1'),
    ).resolves.toBeUndefined();
  });
});
