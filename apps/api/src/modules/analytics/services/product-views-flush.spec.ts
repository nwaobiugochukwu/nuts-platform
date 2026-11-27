import { ProductViewsService } from './product-views.service';

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
  let tracking: { record: jest.Mock };
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
    tracking = { record: jest.fn().mockResolvedValue(true) };
    prisma = {
      productView: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new ProductViewsService(
      redis as never,
      tracking as never,
      prisma as never,
      { invalidateRecommendations: jest.fn() } as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    const timer = (service as any).flushTimer;
    if (timer) clearInterval(timer);
  });

  it('records each buffered view as a product_viewed activity, at the time it was viewed', async () => {
    await service.flushViews();

    expect(tracking.record).toHaveBeenCalledTimes(1);
    expect(tracking.record).toHaveBeenCalledWith(
      {
        action: 'product_viewed',
        id: 'view-1',
        productId: 'p1',
        userId: 'u1',
        visitorId: 'vis-1',
        sessionId: 's1',
      },
      { occurredAt: new Date(stamp) },
    );
  });

  it('takes a view off the processing list only once the broker has it', async () => {
    await service.flushViews();

    expect(redis.lrem).toHaveBeenCalledWith(
      'tracking:product_views:processing',
      1,
      view(),
    );
    expect(prisma.productView.createMany).not.toHaveBeenCalled();
  });

  it('stores the view itself, under the same id, when the broker is down, so no view is lost', async () => {
    tracking.record.mockResolvedValue(false);

    await service.flushViews();

    expect(prisma.productView.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'view-1',
          productId: 'p1',
          userId: 'u1',
          visitorId: 'vis-1',
          sessionId: 's1',
          createdAt: new Date(stamp),
        },
      ],
      skipDuplicates: true,
    });
    expect(redis.lrem).toHaveBeenCalledTimes(1);
  });

  it('gives a view with no id the same stable id every time, so a retry is a duplicate', async () => {
    buffered = [view({ id: undefined })];
    await service.flushViews();
    const first = tracking.record.mock.calls[0][0].id;

    buffered = [view({ id: undefined })];
    await service.flushViews();

    expect(typeof first).toBe('string');
    expect(tracking.record.mock.calls[1][0].id).toBe(first);
  });

  it('does nothing without Redis', async () => {
    redis.status = 'end';

    await service.flushViews();

    expect(tracking.record).not.toHaveBeenCalled();
  });
});
