import { AdminSearchService } from '../services/admin-search.service';

describe('AdminSearchService', () => {
  let runner: { run: jest.Mock };
  let indexes: { search: jest.Mock };
  let service: AdminSearchService;

  beforeEach(() => {
    runner = { run: jest.fn().mockResolvedValue({ results: [] }) };
    indexes = { search: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    service = new AdminSearchService(runner as never, indexes as never);
  });

  it('searches every kind of thing an administrator can see unless asked for fewer', async () => {
    await service.searchAdminGlobal('acme');

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'global',
        search: 'acme',
        page: 1,
        limit: 20,
        indexes: [
          'products',
          'vendors',
          'categories',
          'users',
          'orders',
          'discount_codes',
        ],
      }),
    );
  });

  it('keeps only the kinds asked for that it knows', async () => {
    await service.searchAdminGlobal('acme', ['users', 'nonsense'] as never);

    expect(runner.run.mock.calls[0][0].indexes).toEqual(['users']);
  });

  it('hands each index to the admin searcher', async () => {
    await service.searchAdminGlobal('acme');
    const { searchIndex } = runner.run.mock.calls[0][0];

    await searchIndex('orders', 'acme', 30);

    expect(indexes.search).toHaveBeenCalledWith('orders', 'acme', 30);
  });
});
