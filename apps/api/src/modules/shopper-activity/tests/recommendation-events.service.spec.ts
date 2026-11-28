import { ROLE } from '@prisma/client';
import { RecommendationEventsService } from '../services/recommendation-events.service';

const click = {
  id: 'r1',
  eventType: 'CLICK',
  surface: 'HOME_FOR_YOU',
  requestId: 'req-1',
  rankerVersion: 'v1',
  position: 2,
  productId: 'p1',
  sessionId: 's1',
} as never;
const impression = {
  ...(click as object),
  id: 'r2',
  eventType: 'IMPRESSION',
} as never;

describe('RecommendationEventsService', () => {
  let recorder: { recordMany: jest.Mock };
  let service: RecommendationEventsService;

  beforeEach(() => {
    recorder = { recordMany: jest.fn().mockResolvedValue(undefined) };
    service = new RecommendationEventsService(recorder as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  const recorded = () =>
    recorder.recordMany.mock.calls.flatMap(([items]) =>
      items.map((i: { activity: unknown }) => i.activity),
    );

  it('records a click as a shelf_item_clicked activity, with where it was and how it was ranked', async () => {
    await expect(service.record('u1', click, ROLE.USER)).resolves.toEqual({
      accepted: true,
    });

    expect(recorded()).toEqual([
      {
        action: 'shelf_item_clicked',
        id: 'r1',
        surface: 'HOME_FOR_YOU',
        requestId: 'req-1',
        rankerVersion: 'v1',
        position: 2,
        productId: 'p1',
        vendorId: undefined,
        categoryId: undefined,
        userId: 'u1',
        sessionId: 's1',
      },
    ]);
  });

  it('names each kind of interaction as its own action', async () => {
    await service.recordMany(
      'u1',
      [
        click,
        impression,
        { ...(click as object), id: 'r3', eventType: 'DISMISS' } as never,
        {
          ...(click as object),
          id: 'r4',
          eventType: 'CATEGORY_VIEW',
          productId: undefined,
          categoryId: 'c1',
        } as never,
      ],
      ROLE.USER,
    );

    expect(recorded().map((a: { action: string }) => a.action)).toEqual([
      'shelf_item_clicked',
      'shelf_item_seen',
      'shelf_item_dismissed',
      'category_viewed',
    ]);
  });

  it('records a batch in one call and reports how many were accepted', async () => {
    const result = await service.recordMany(
      'u1',
      [click, impression],
      ROLE.USER,
    );

    expect(result).toEqual({ accepted: true, stored: 2 });
    expect(recorder.recordMany).toHaveBeenCalledTimes(1);
  });

  it('records a vendor browsing as an anonymous shopper, never as a customer', async () => {
    await service.record('vendor-1', click, ROLE.VENDOR);

    expect(recorded()[0].userId).toBeNull();
  });

  it('ignores an admin, and a vendor’s own store', async () => {
    await service.record('a1', click, ROLE.ADMIN);
    await service.recordMany('a1', [click], ROLE.ADMIN);
    await service.record(
      'vendor-1',
      { ...(click as object), vendorId: 'vendor-1' } as never,
      ROLE.VENDOR,
    );

    expect(recorder.recordMany).not.toHaveBeenCalled();
  });

  it.each([
    ['a kind a browser may not report', { eventType: 'PURCHASE' }],
    ['an event about nothing', { productId: undefined }],
  ])('refuses %s', async (_label, over) => {
    const event = { ...(click as object), ...over } as never;

    await expect(service.record('u1', event, ROLE.USER)).resolves.toEqual({
      accepted: false,
    });
    expect(recorder.recordMany).not.toHaveBeenCalled();
  });

  it('drops the untrackable ones from a batch and keeps the rest', async () => {
    const bad = {
      ...(click as object),
      id: 'bad',
      eventType: 'PURCHASE',
    } as never;

    const result = await service.recordMany('u1', [bad, click], ROLE.USER);

    expect(result).toEqual({ accepted: true, stored: 1 });
    expect(recorded().map((a: { id: string }) => a.id)).toEqual(['r1']);
  });

  it('says not accepted, without throwing, when nothing could queue or store them', async () => {
    recorder.recordMany.mockRejectedValue(new Error('db down'));

    await expect(service.record('u1', click, ROLE.USER)).resolves.toEqual({
      accepted: false,
    });
    await expect(service.recordMany('u1', [click], ROLE.USER)).resolves.toEqual(
      { accepted: false, stored: 0 },
    );
  });
});
