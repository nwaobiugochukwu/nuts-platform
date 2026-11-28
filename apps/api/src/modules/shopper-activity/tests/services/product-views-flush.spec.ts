import { ProductViewsService } from '../../services/product-views.service';

describe('ProductViewsService flush to the analytics queue', () => {
  const stamp = '2026-11-28T10:00:00.000Z';
  const view = (overrides: object = {}) =>
    JSON.stringify({
      id: 'view-1',
      productId: 'p1',
      userId: 'u1',
      visitorId: 'vis-1',
      sessionId: 's1',
      timestamp: stamp,
      ...overrides,
    });

  let redis: {
    status: string;
    set: jest.Mock;
    eval: jest.Mock;
    lrem: jest.Mock;
  };
  let recorder: { recordMany: jest.Mock; record: jest.Mock };
  let prisma: { productView: { createMany: jest.Mock } };
  let service: ProductViewsService;
  let buffered: string[];

  beforeEach(() => {
    jest.useFakeTimers();
    buffered = [view()];
    redis = {
      status: 'ready',
      set: jest.fn().mockResolvedValue('OK'),
      lrem: jest.fn().mockResolvedValue(1),
      // the flush uses eval for the lock renewal, the restore of a crashed flush, the pop and the release
      eval: jest.fn((script: string) => {
        if (script.includes("redis.call('expire'")) return Promise.resolve(1);
        if (script.includes('LPOP')) return Promise.resolve(buffered.splice(0));
        return Promise.resolve(0);
      }),
    };
    recorder = {
      recordMany: jest.fn().mockResolvedValue(undefined),
      record: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      productView: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new ProductViewsService(
      redis as never,
      recorder as never,
      prisma as never,
      { invalidateRecommendations: jest.fn() } as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    const timer = (service as any).flushTimer;
    if (timer) clearInterval(timer);
  });

  const recorded = () =>
    recorder.recordMany.mock.calls.flatMap(([items]) => items) as Array<{
      activity: Record<string, unknown>;
      occurredAt: Date;
    }>;

  it('records each buffered view as a product_viewed activity, at the time it was viewed', async () => {
    await service.flushViews();

    expect(recorder.recordMany).toHaveBeenCalledTimes(1);
    expect(recorded()).toEqual([
      {
        activity: {
          action: 'product_viewed',
          id: 'view-1',
          productId: 'p1',
          userId: 'u1',
          visitorId: 'vis-1',
          sessionId: 's1',
        },
        occurredAt: new Date(stamp),
      },
    ]);
  });

  it('takes a view off the processing list only once it has been queued or stored', async () => {
    await service.flushViews();

    expect(redis.lrem).toHaveBeenCalledWith(
      'tracking:product_views:processing',
      1,
      view(),
    );
  });

  it('leaves the views listed, to be retried by the next flush, when they could be neither queued nor stored', async () => {
    recorder.recordMany.mockRejectedValue(new Error('db down'));

    await service.flushViews();

    expect(redis.lrem).not.toHaveBeenCalled();
  });

  it('drops a buffered entry it cannot read instead of retrying it forever', async () => {
    buffered = ['{not json', view()];

    await service.flushViews();

    expect(redis.lrem).toHaveBeenCalledWith(
      'tracking:product_views:processing',
      1,
      '{not json',
    );
    expect(recorded()).toHaveLength(1);
  });

  it('gives a view with no id the same stable id every time, so a retry is a duplicate', async () => {
    buffered = [view({ id: undefined })];
    await service.flushViews();
    const first = recorded()[0].activity.id;

    buffered = [view({ id: undefined })];
    await service.flushViews();

    expect(typeof first).toBe('string');
    expect(recorded()[1].activity.id).toBe(first);
  });

  it('does nothing without Redis', async () => {
    redis.status = 'end';

    await service.flushViews();

    expect(recorder.recordMany).not.toHaveBeenCalled();
  });
});
