import type { SearchIndex, SearchResultItem } from '../../types/search.types';
import { SearchRunnerService } from '../../services/search-runner.service';

const hit = (
  id: string,
  index: SearchIndex,
  score: number,
): SearchResultItem => ({
  id,
  index,
  type: index,
  title: id,
  score,
  payload: {},
});

describe('SearchRunnerService', () => {
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: SearchRunnerService;
  let searchIndex: jest.Mock;

  const run = (over: Record<string, unknown> = {}) =>
    service.run({
      namespace: 'global',
      indexes: ['products', 'vendors'],
      search: 'shoes',
      page: 1,
      limit: 10,
      searchIndex,
      ...over,
    } as never);

  beforeEach(() => {
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new SearchRunnerService(cache as never);
    searchIndex = jest.fn((index: SearchIndex) =>
      Promise.resolve(
        index === 'products'
          ? {
              items: [hit('p1', 'products', 0.9), hit('p2', 'products', 0.4)],
              total: 2,
            }
          : { items: [hit('v1', 'vendors', 0.7)], total: 1 },
      ),
    );
  });

  it('searches nothing for a term that is too short', async () => {
    await expect(run({ search: 'a' })).resolves.toBeNull();
    await expect(run({ search: '   ' })).resolves.toBeNull();
    expect(searchIndex).not.toHaveBeenCalled();
  });

  it('asks every index, and merges the hits by relevance rather than index by index', async () => {
    const result = await run();

    expect(searchIndex).toHaveBeenCalledTimes(2);
    expect(result?.results.map((r) => r.id)).toEqual(['p1', 'v1', 'p2']);
    expect(result?.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('cuts out the requested page of the merged list', async () => {
    const second = await run({ page: 2, limit: 2 });

    expect(second?.results.map((r) => r.id)).toEqual(['p2']);
    expect(second?.pagination).toMatchObject({
      page: 2,
      limit: 2,
      totalPages: 2,
    });
  });

  it('fetches enough from each index for the page, never more than the maximum', async () => {
    await run({ page: 3, limit: 10 });
    expect(searchIndex).toHaveBeenCalledWith('products', 'shoes', 30);

    searchIndex.mockClear();
    await run({ page: 50, limit: 50 });
    expect(searchIndex.mock.calls[0][2]).toBe(50);
  });

  it('answers from the cache without searching', async () => {
    cache.get.mockResolvedValue({ results: [], pagination: { total: 0 } });

    await run();

    expect(searchIndex).not.toHaveBeenCalled();
  });

  it('caches what it found, under a key that carries its namespace and every input', async () => {
    await run({ namespace: 'vendor:v9' });

    const key = cache.set.mock.calls[0][0] as string;
    expect(key).toBe('search:vendor:v9:shoes:products%2Cvendors:1:10');
    expect(cache.get).toHaveBeenCalledWith(key);
  });

  it('keeps one audience’s cache entries apart from another’s', async () => {
    await run({ namespace: 'global' });
    await run({ namespace: 'vendor:v9' });

    const [a, b] = cache.get.mock.calls.map((c) => c[0]);
    expect(a).not.toBe(b);
  });

  it('is the same search whatever order the indexes are named in', async () => {
    await run({ indexes: ['vendors', 'products'] });
    await run({ indexes: ['products', 'vendors'] });

    const [a, b] = cache.get.mock.calls.map((c) => c[0]);
    expect(a).toBe(b);
  });

  describe('autocomplete', () => {
    const complete = (over: Record<string, unknown> = {}) =>
      service.autocomplete({
        cacheNamespace: 'autocomplete-v2',
        runNamespace: 'global',
        indexes: ['products'],
        search: 'sho',
        limit: 5,
        searchIndex,
        ...over,
      } as never);

    it('returns just the first page of hits, caching them under its own key', async () => {
      const results = await complete();

      expect(results?.map((r) => r.id)).toEqual(['p1', 'p2']);
      expect(cache.set).toHaveBeenLastCalledWith(
        'search:autocomplete-v2:sho:products:5',
        results,
      );
    });

    it('is null for nothing typed, and for a term too short to search', async () => {
      await expect(complete({ search: '   ' })).resolves.toBeNull();
      await expect(complete({ search: 'a' })).resolves.toBeNull();
    });

    it('answers from its own cache first', async () => {
      cache.get.mockResolvedValueOnce([hit('cached', 'products', 1)]);

      const results = await complete();

      expect(results?.[0].id).toBe('cached');
      expect(searchIndex).not.toHaveBeenCalled();
    });
  });
});
