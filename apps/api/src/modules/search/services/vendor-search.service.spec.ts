import { SearchRunnerService } from './search-runner.service';
import { VendorSearchService } from './vendor-search.service';

describe('VendorSearchService', () => {
  let prisma: any;
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: VendorSearchService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new VendorSearchService(
      prisma,
      new SearchRunnerService(cache as never),
    );
  });

  // $queryRaw is called as a tagged template: (strings, ...values).
  const valuesQueried = () =>
    prisma.$queryRaw.mock.calls.flatMap((call: unknown[]) => call.slice(1));

  it('searches nothing for a search that is too short or blank', async () => {
    await expect(service.searchVendorGlobal('v1', 'a')).resolves.toBeNull();
    await expect(service.searchVendorGlobal('v1', '   ')).resolves.toBeNull();
    await expect(service.autocompleteVendor('v1', '  ')).resolves.toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('only ever asks the database about the vendor it was called for', async () => {
    await service.searchVendorGlobal('vendor-42', 'shoes');

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(valuesQueried()).toContain('vendor-42');
  });

  it('searches only a vendor’s own kinds of thing, ignoring the admin ones', async () => {
    await service.searchVendorGlobal('v1', 'shoes', [
      'users',
      'vendors',
    ] as never);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps one vendor’s cached results apart from another’s', async () => {
    await service.searchVendorGlobal('vendor-a', 'shoes', ['products']);
    await service.searchVendorGlobal('vendor-b', 'shoes', ['products']);

    const keys = cache.get.mock.calls.map((c) => c[0]);
    expect(keys[0]).toContain('search:vendor:vendor-a:');
    expect(keys[1]).toContain('search:vendor:vendor-b:');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('answers from the cache without touching the database', async () => {
    cache.get.mockResolvedValue({
      results: [],
      pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });

    await service.searchVendorGlobal('v1', 'shoes');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('caches what it found, and the autocomplete returns just the results', async () => {
    const results = await service.autocompleteVendor('v1', 'shoes', [
      'products',
    ]);

    expect(results).toEqual([]);
    expect(cache.set).toHaveBeenCalled();
  });
});
