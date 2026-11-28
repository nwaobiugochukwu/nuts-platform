import { describeDiscountTargets } from '../utils/discount-targets.util';

const prismaWith = (over: Record<string, unknown[]> = {}) => ({
  vendor: {
    findMany: jest
      .fn()
      .mockResolvedValue(
        over.vendors ?? [
          { id: 'v1', storeName: 'Aba Shoes', storeSlug: 'aba' },
        ],
      ),
  },
  product: {
    findMany: jest
      .fn()
      .mockResolvedValue(
        over.products ?? [{ id: 'p1', name: 'Oxford Shoes', slug: 'oxford' }],
      ),
  },
  category: { findMany: jest.fn().mockResolvedValue(over.categories ?? []) },
});

describe('describeDiscountTargets', () => {
  it('describes a product-specific vendor voucher with its product and store', async () => {
    const [t] = await describeDiscountTargets(prismaWith() as never, [
      {
        vendorId: 'v1',
        platformwide: false,
        applicableProductIds: ['p1', 'gone'],
        applicableCategoryIds: [],
      },
    ]);
    expect(t.kind).toBe('PRODUCTS');
    expect(t.store).toEqual({ name: 'Aba Shoes', slug: 'aba' });
    // Deleted/inactive products are not advertised.
    expect(t.products.map((p) => p.id)).toEqual(['p1']);
    expect(t.productCount).toBe(1);
  });

  it('describes store-wide and marketplace-wide vouchers', async () => {
    const [store, all] = await describeDiscountTargets(prismaWith() as never, [
      {
        vendorId: 'v1',
        platformwide: true,
        applicableProductIds: [],
        applicableCategoryIds: [],
      },
      {
        vendorId: null,
        platformwide: true,
        applicableProductIds: [],
        applicableCategoryIds: [],
      },
    ]);
    expect(store.kind).toBe('STORE');
    expect(all.kind).toBe('ALL');
    expect(all.store).toBeNull();
  });
});
