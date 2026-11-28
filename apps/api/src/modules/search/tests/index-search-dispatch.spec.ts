import { AdminIndexSearchService } from '../services/admin-index-search.service';
import { CatalogIndexSearchService } from '../services/catalog-index-search.service';

describe('which service searches which index', () => {
  const rows = { $queryRaw: jest.fn().mockResolvedValue([]) };

  beforeEach(() => rows.$queryRaw.mockClear());

  it('the catalogue searcher handles products, stores and categories, and nothing else', async () => {
    const catalog = new CatalogIndexSearchService(rows as never);
    const spies = {
      products: jest
        .spyOn(catalog, 'products')
        .mockResolvedValue({ items: [], total: 0 }),
      vendors: jest
        .spyOn(catalog, 'vendors')
        .mockResolvedValue({ items: [], total: 0 }),
      categories: jest
        .spyOn(catalog, 'categories')
        .mockResolvedValue({ items: [], total: 0 }),
    };

    await catalog.search('products', 'x', 5);
    await catalog.search('vendors', 'x', 5);
    await catalog.search('categories', 'x', 5);
    const other = await catalog.search('users', 'x', 5);

    expect(spies.products).toHaveBeenCalledWith('x', 5);
    expect(spies.vendors).toHaveBeenCalledWith('x', 5);
    expect(spies.categories).toHaveBeenCalledWith('x', 5);
    expect(other).toEqual({ items: [], total: 0 });
    expect(rows.$queryRaw).not.toHaveBeenCalled();
  });

  it('the admin searcher handles users, orders and discount codes itself and leaves the rest to the catalogue', async () => {
    const catalog = {
      search: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const admin = new AdminIndexSearchService(rows as never, catalog as never);
    const spies = {
      users: jest
        .spyOn(admin, 'users')
        .mockResolvedValue({ items: [], total: 0 }),
      orders: jest
        .spyOn(admin, 'orders')
        .mockResolvedValue({ items: [], total: 0 }),
      discountCodes: jest
        .spyOn(admin, 'discountCodes')
        .mockResolvedValue({ items: [], total: 0 }),
    };

    await admin.search('users', 'x', 5);
    await admin.search('orders', 'x', 5);
    await admin.search('discount_codes', 'x', 5);
    await admin.search('products', 'x', 5);

    expect(spies.users).toHaveBeenCalledWith('x', 5);
    expect(spies.orders).toHaveBeenCalledWith('x', 5);
    expect(spies.discountCodes).toHaveBeenCalledWith('x', 5);
    expect(catalog.search).toHaveBeenCalledTimes(1);
    expect(catalog.search).toHaveBeenCalledWith('products', 'x', 5);
  });
});
