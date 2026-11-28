import { MAX_LIMIT } from '../constants/search.constants';
import {
  buildCacheKey,
  filterIndexes,
  normalizeLimit,
  normalizePage,
  normalizeSearch,
} from './search-input.util';

describe('normalizeSearch', () => {
  it('trims and collapses runs of whitespace', () => {
    expect(normalizeSearch('  red   running\tshoes ')).toBe(
      'red running shoes',
    );
  });
});

describe('normalizePage', () => {
  it.each([
    [3, 3],
    [2.9, 2],
    [0, 1],
    [-4, 1],
    [NaN, 1],
    [Infinity, 1],
  ])('%s becomes %s', (input, expected) => {
    expect(normalizePage(input)).toBe(expected);
  });
});

describe('normalizeLimit', () => {
  it('defaults to 10 for nonsense, and never goes below 1 or above the maximum', () => {
    expect(normalizeLimit(NaN)).toBe(10);
    expect(normalizeLimit(0)).toBe(1);
    expect(normalizeLimit(-3)).toBe(1);
    expect(normalizeLimit(25.7)).toBe(25);
    expect(normalizeLimit(10_000)).toBe(MAX_LIMIT);
  });
});

describe('buildCacheKey', () => {
  it('builds a namespaced key, encoding every part so a search cannot forge another key', () => {
    expect(buildCacheKey('products', 'red shoes', 2)).toBe(
      'search:products:red%20shoes:2',
    );
    expect(buildCacheKey('x', 'a:b')).not.toBe(buildCacheKey('x', 'a', 'b'));
  });
});

describe('filterIndexes', () => {
  it('allows everything when none were asked for', () => {
    expect(filterIndexes(undefined, ['products', 'orders'])).toEqual([
      'products',
      'orders',
    ]);
    expect(filterIndexes([], ['products'])).toEqual(['products']);
  });

  it('keeps only the asked-for indexes that are allowed', () => {
    expect(
      filterIndexes(['products', 'users'], ['products', 'orders']),
    ).toEqual(['products']);
  });
});
