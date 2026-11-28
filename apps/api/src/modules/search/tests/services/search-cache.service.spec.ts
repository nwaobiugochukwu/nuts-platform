import { SearchCacheService } from '../../services/search-cache.service';

describe('SearchCacheService', () => {
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    keys: jest.Mock;
    del: jest.Mock;
  };
  let service: SearchCacheService;

  beforeEach(() => {
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
    };
    service = new SearchCacheService(redis as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  it('returns what was stored, and null on a miss', async () => {
    redis.get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
    await expect(service.get('k')).resolves.toEqual({ a: 1 });

    redis.get.mockResolvedValueOnce(null);
    await expect(service.get('k')).resolves.toBeNull();
  });

  it('stores as JSON with a 15 minute expiry', async () => {
    await service.set('k', { a: 1 });

    expect(redis.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 900);
  });

  it('never makes search fail when Redis does: a failed read is a miss, a failed write is ignored', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(service.get('k')).resolves.toBeNull();
    await expect(service.set('k', 1)).resolves.toBeUndefined();
  });

  it('treats a cached value it cannot read as a miss', async () => {
    redis.get.mockResolvedValue('{not json');

    await expect(service.get('k')).resolves.toBeNull();
  });

  describe('flush', () => {
    it('removes every search key and says how many', async () => {
      redis.keys.mockResolvedValue(['search:a', 'search:b']);

      await expect(service.flush()).resolves.toBe(2);
      expect(redis.keys).toHaveBeenCalledWith('search:*');
      expect(redis.del).toHaveBeenCalledWith('search:a', 'search:b');
    });

    it('does nothing when there is nothing cached', async () => {
      await expect(service.flush()).resolves.toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('reports zero rather than failing when Redis is down', async () => {
      redis.keys.mockRejectedValue(new Error('redis down'));

      await expect(service.flush()).resolves.toBe(0);
    });
  });
});
