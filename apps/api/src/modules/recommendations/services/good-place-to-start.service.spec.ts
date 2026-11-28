import type { ProductCardDto } from '@api/modules/products/dto/product-card.dto';
import { GoodPlaceToStartService } from './good-place-to-start.service';

const card = (id: string, vendorId: string) =>
  ({
    id,
    thumbnail: `${id}.png`,
    vendor: { id: vendorId },
  }) as unknown as ProductCardDto;

describe('GoodPlaceToStartService', () => {
  let stores: { starterSampler: jest.Mock };
  let feed: { forYou: jest.Mock };
  let service: GoodPlaceToStartService;

  beforeEach(() => {
    stores = {
      starterSampler: jest.fn().mockResolvedValue({
        vendors: [{ vendor: {}, products: [card('a', 'v1')] }],
      }),
    };
    feed = { forYou: jest.fn().mockResolvedValue([card('x', 'v9')]) };
    service = new GoodPlaceToStartService(stores as never, feed as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  it('asks both for the same shopper and combines them in one answer', async () => {
    const result = await service.picks('u1', 's1', 'vis');

    expect(stores.starterSampler).toHaveBeenCalledWith('u1', 's1', 'vis');
    expect(feed.forYou).toHaveBeenCalledWith('u1', 's1', 'vis');
    expect(result.items.map((i) => [i.product.id, i.source])).toEqual([
      ['a', 'store_sampler'],
      ['x', 'for_you'],
    ]);
  });

  it('still gives the spread when the shopper’s own picks fail', async () => {
    feed.forYou.mockRejectedValue(new Error('feed down'));

    const result = await service.picks('u1', 's1');

    expect(result.items.map((i) => i.product.id)).toEqual(['a']);
  });

  it('still gives the shopper’s picks when the spread fails', async () => {
    stores.starterSampler.mockRejectedValue(new Error('db slow'));

    const result = await service.picks('u1', 's1');

    expect(result.items.map((i) => i.product.id)).toEqual(['x']);
  });

  it('fails only when both parts fail', async () => {
    stores.starterSampler.mockRejectedValue(new Error('db down'));
    feed.forYou.mockRejectedValue(new Error('feed down'));

    await expect(service.picks('u1', 's1')).rejects.toThrow('db down');
  });

  it('is empty, not an error, for a visitor with nothing to show', async () => {
    stores.starterSampler.mockResolvedValue({ vendors: [] });
    feed.forYou.mockResolvedValue([]);

    await expect(service.picks(undefined, 's1')).resolves.toEqual({
      items: [],
    });
  });
});
