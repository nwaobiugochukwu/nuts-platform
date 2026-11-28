import type { ProductCardDto } from '@api/modules/products/dto/product-card.dto';
import {
  GOOD_PLACE_TO_START_LIMIT,
  composeGoodPlaceToStart,
} from './good-place-to-start.util';

const card = (
  id: string,
  vendorId: string | null,
  thumbnail: string | null = `${id}.png`,
): ProductCardDto =>
  ({
    id,
    thumbnail,
    vendor: vendorId ? { id: vendorId } : undefined,
  }) as unknown as ProductCardDto;

const ids = (picks: Array<{ product: ProductCardDto }>) =>
  picks.map((p) => p.product.id);

describe('composeGoodPlaceToStart', () => {
  it('gives a new visitor the spread across stores alone', () => {
    const picks = composeGoodPlaceToStart(
      [{ products: [card('a', 'v1')] }, { products: [card('b', 'v2')] }],
      [],
    );

    expect(picks).toEqual([
      { product: card('a', 'v1'), source: 'store_sampler' },
      { product: card('b', 'v2'), source: 'store_sampler' },
    ]);
  });

  it('puts the spread first and tops up with the shopper’s own picks', () => {
    const picks = composeGoodPlaceToStart(
      [{ products: [card('a', 'v1')] }],
      [card('x', 'v9'), card('y', 'v8')],
    );

    expect(ids(picks)).toEqual(['a', 'x', 'y']);
    expect(picks.map((p) => p.source)).toEqual([
      'store_sampler',
      'for_you',
      'for_you',
    ]);
  });

  it('never shows two products from one store, the spread winning', () => {
    const picks = composeGoodPlaceToStart(
      [{ products: [card('a', 'v1')] }],
      [card('x', 'v1'), card('y', 'v2')],
    );

    expect(ids(picks)).toEqual(['a', 'y']);
  });

  it('never shows a product twice', () => {
    const picks = composeGoodPlaceToStart(
      [{ products: [card('a', 'v1')] }, { products: [card('a', 'v2')] }],
      [card('a', 'v3'), card('b', 'v3')],
    );

    expect(ids(picks)).toEqual(['a', 'b']);
  });

  it('skips a product with no picture or no store', () => {
    const picks = composeGoodPlaceToStart(
      [
        { products: [card('nopic', 'v1', null)] },
        { products: [card('nostore', null)] },
        { products: [card('ok', 'v3')] },
      ],
      [card('also-nopic', 'v4', null)],
    );

    expect(ids(picks)).toEqual(['ok']);
  });

  it('takes the first usable product of a store when its first is already chosen', () => {
    const picks = composeGoodPlaceToStart(
      [
        { products: [card('a', 'v1')] },
        { products: [card('a', 'v2'), card('b', 'v2')] },
      ],
      [],
    );

    expect(ids(picks)).toEqual(['a', 'b']);
  });

  it('stops at the limit, however much there is', () => {
    const vendors = Array.from({ length: 30 }, (_, i) => ({
      products: [card(`p${i}`, `v${i}`)],
    }));

    const picks = composeGoodPlaceToStart(vendors, [card('x', 'vx')]);

    expect(picks).toHaveLength(GOOD_PLACE_TO_START_LIMIT);
    expect(ids(picks)).not.toContain('x');
  });

  it('honours a smaller limit', () => {
    const picks = composeGoodPlaceToStart(
      [{ products: [card('a', 'v1')] }, { products: [card('b', 'v2')] }],
      [],
      1,
    );

    expect(ids(picks)).toEqual(['a']);
  });

  it('is empty when there is nothing to show', () => {
    expect(composeGoodPlaceToStart([], [])).toEqual([]);
  });
});
