import Redis from 'ioredis';
import { RedlockService } from '../redis/redlock.service';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: jest.Mocked<Partial<Redis>>;
  let mockRedlock: jest.Mocked<Partial<RedlockService>>;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
    };

    mockRedlock = {
      acquire: jest.fn(),
    };

    service = new CacheService(
      mockRedis as unknown as Redis,
      mockRedlock as unknown as RedlockService,
    );
  });

  describe('get & set', () => {
    it('returns data from Redis on cold read and stores in L1 for supported keys', async () => {
      const productKey = 'product:details:123';
      const payload = { id: '123', name: 'MacBook Pro' };
      (mockRedis.get as jest.Mock).mockResolvedValue(JSON.stringify(payload));

      // 1. Cold read hits Redis
      const first = await service.get<typeof payload>(productKey);
      expect(first).toEqual(payload);
      expect(mockRedis.get).toHaveBeenCalledTimes(1);

      // 2. Second read within TTL hits L1 local cache without Redis roundtrip
      const second = await service.get<typeof payload>(productKey);
      expect(second).toEqual(payload);
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });

    it('returns undefined and fails open when Redis throws an error', async () => {
      (mockRedis.get as jest.Mock).mockRejectedValue(
        new Error('Connection lost'),
      );

      const result = await service.get('user:profile:123');
      expect(result).toBeUndefined();
    });

    it('writes to Redis with jitter applied to TTL', async () => {
      (mockRedis.set as jest.Mock).mockResolvedValue('OK');

      await service.set('product:slug:laptop', { id: '1' }, 3600);

      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      const callArgs = (mockRedis.set as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe('product:slug:laptop');
      expect(callArgs[1]).toBe(JSON.stringify({ id: '1' }));
      expect(callArgs[2]).toBe('EX');
      // TTL should be base (3600) + jitter (up to 15%, so between 3600 and 4140)
      const ttl = callArgs[3] as number;
      expect(ttl).toBeGreaterThanOrEqual(3600);
      expect(ttl).toBeLessThanOrEqual(4140);
    });
  });

  describe('wrap with singleflight coalescing (Stampede Protection)', () => {
    it('coalesces concurrent requests for the same key into a single computeFn call', async () => {
      const key = 'category:tree';
      const computeFn = jest.fn(async () => {
        // Simulate database latency
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [{ id: 'cat-1', name: 'Electronics' }];
      });

      (mockRedis.get as jest.Mock).mockResolvedValue(null);
      (mockRedis.set as jest.Mock).mockResolvedValue('OK');

      // 10 concurrent requests arrive at the same time for the cold key
      const requests = Array.from({ length: 10 }, () =>
        service.wrap(key, 60, computeFn),
      );

      const results = await Promise.all(requests);

      // All 10 requests should receive identical result
      expect(results).toHaveLength(10);
      results.forEach((r) => {
        expect(r).toEqual([{ id: 'cat-1', name: 'Electronics' }]);
      });

      // Crucial: computeFn was executed EXACTLY ONCE
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('discards stale compute results if cache was invalidated during execution', async () => {
      const key = 'product:details:stale-check';
      let finishCompute!: () => void;
      const computePromise = new Promise<{ id: string; price: number }>(
        (resolve) => {
          finishCompute = () => resolve({ id: '1', price: 100 });
        },
      );

      (mockRedis.get as jest.Mock).mockResolvedValue(null);
      (mockRedis.set as jest.Mock).mockResolvedValue('OK');
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      // 1. Start cold compute. wrap() is async: it awaits get() which awaits redis.get(),
      //    then calls computeOnce which captures the current generation.
      //    We need wrap() to have fully progressed into computeOnce (registering gen=0 in
      //    inFlight) BEFORE del() is called. Flush enough microtasks to let both async
      //    awaits inside wrap()/get() resolve.
      const inFlightPromise = service.wrap(key, 60, () => computePromise);

      // Flush microtask queue: wrap() → await get() → await redis.get() → computeOnce registered (gen=0)
      const flushMicrotasks = async (ticks = 5) => {
        for (let i = 0; i < ticks; i++) await Promise.resolve();
      };
      await flushMicrotasks();

      // 2. Invalidation fires AFTER computeOnce has captured generation=0 (bumps it to 1)
      await service.del(key);

      // 3. Resolve the original compute — the guard `generationFor(key) === generation`
      //    evaluates to (1 === 0) → false, so write() is skipped entirely.
      finishCompute();
      const result = await inFlightPromise;
      expect(result).toEqual({ id: '1', price: 100 });

      // Stale data must NOT be written back to Redis since generation was bumped
      // after computeOnce captured it.
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('returns existing cached value without calling computeFn on cache hit', async () => {
      const key = 'category:tree';
      const cached = [{ id: 'cat-1', name: 'Home' }];
      (mockRedis.get as jest.Mock).mockResolvedValue(JSON.stringify(cached));

      const computeFn = jest.fn();
      const result = await service.wrap(key, 60, computeFn);

      expect(result).toEqual(cached);
      expect(computeFn).not.toHaveBeenCalled();
    });
  });

  describe('invalidate & pattern deletion', () => {
    it('invalidates both local L1 cache and Redis L2 key', async () => {
      const key = 'product:card:item-1';
      (mockRedis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ id: 'item-1' }),
      );
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      // Populate L1
      await service.get(key);

      // Invalidate
      await service.del(key);
      expect(mockRedis.del).toHaveBeenCalledWith(key);

      // Subsequent read must miss L1 and query Redis again
      await service.get(key);
      expect(mockRedis.get).toHaveBeenCalledTimes(2);
    });
  });
});
