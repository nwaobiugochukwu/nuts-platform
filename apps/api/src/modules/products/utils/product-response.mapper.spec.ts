import {
  computeTotalStock,
  normalizeImageUrls,
  normalizeSearch,
  toVariantSummaryDto,
} from './product-response.mapper';

describe('normalizeImageUrls', () => {
  it('keeps the list, trimmed, without blanks or repeats, to at most six', () => {
    expect(
      normalizeImageUrls([' a ', 'b', 'a', '', '  ', 'c', 'd', 'e', 'f', 'g']),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('falls back to the single image when the list is missing or empty', () => {
    expect(normalizeImageUrls(undefined, ' only ')).toEqual(['only']);
    expect(normalizeImageUrls([], 'only')).toEqual(['only']);
  });

  it('is empty when there is nothing', () => {
    expect(normalizeImageUrls()).toEqual([]);
  });
});

describe('normalizeSearch', () => {
  it('trims, and treats blank as no search', () => {
    expect(normalizeSearch('  red shoes ')).toBe('red shoes');
    expect(normalizeSearch('   ')).toBeUndefined();
    expect(normalizeSearch(undefined)).toBeUndefined();
  });
});

describe('computeTotalStock', () => {
  it('is the product’s stock for a product without variants, ignoring any variant rows', () => {
    expect(computeTotalStock(false, 7, [{ stock: 100 }])).toBe(7);
  });

  it('is the sum of the variants’ stock for a product with variants', () => {
    expect(computeTotalStock(true, 7, [{ stock: 2 }, { stock: 3 }])).toBe(5);
    expect(computeTotalStock(true, 7, [])).toBe(0);
  });
});

describe('toVariantSummaryDto', () => {
  it('passes the variant’s fields through', () => {
    const now = new Date('2026-11-28T10:00:00.000Z');
    const dto = toVariantSummaryDto({
      id: 'var-1',
      options: [{ name: 'Size', value: 'M' }],
      stock: 4,
      images: ['x'],
      isActive: true,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    });

    expect(dto).toMatchObject({ id: 'var-1', stock: 4, isActive: true });
  });
});
