import { Prisma } from '@prisma/client';
import { productViewEventId } from '@api/common/utils/product-view-event-id.util';
import { RABBITMQ_QUEUES } from './rabbitmq.constants';
import { AnalyticsConsumer } from './analytics.consumer';
import { fakeRabbit } from './consumer-harness-spec';

const fkViolation = () =>
  new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 't',
  });

describe('AnalyticsConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let prisma: any;
  let consumer: AnalyticsConsumer;

  beforeEach(() => {
    harness = fakeRabbit();
    prisma = {
      productView: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      searchQuery: { create: jest.fn().mockResolvedValue({}) },
    };
    consumer = new AnalyticsConsumer(harness.rabbit, prisma);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.ANALYTICS)(payload);
  }

  it('stores a product view under the id the producer chose, skipping duplicates', async () => {
    await handle({
      type: 'product_view',
      id: 'evt-1',
      productId: 'p1',
      userId: 'u1',
      sessionId: 's1',
      timestamp: '2026-11-01T10:00:00.000Z',
    });

    expect(prisma.productView.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'evt-1',
          productId: 'p1',
          userId: 'u1',
          visitorId: null,
          sessionId: 's1',
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });

  it('derives a stable id when the producer sent none, so a redelivery is a duplicate', async () => {
    const payload = {
      type: 'product_view',
      productId: 'p1',
      visitorId: 'v1',
      timestamp: '2026-11-01T10:00:00.000Z',
    };

    await handle(payload);

    const expected = productViewEventId({
      productId: 'p1',
      userId: undefined,
      visitorId: 'v1',
      sessionId: undefined,
      timestamp: payload.timestamp,
    });
    expect(prisma.productView.createMany.mock.calls[0][0].data[0].id).toBe(
      expected,
    );
  });

  it('when the user no longer exists, keeps the view as an anonymous visitor', async () => {
    prisma.productView.createMany
      .mockRejectedValueOnce(fkViolation())
      .mockResolvedValueOnce({ count: 1 });

    await handle({ type: 'product_view', productId: 'p1', userId: 'gone' });

    expect(prisma.productView.createMany).toHaveBeenCalledTimes(2);
    const retry = prisma.productView.createMany.mock.calls[1][0].data[0];
    expect(retry.userId).toBeNull();
    expect(retry.visitorId).toBe('visitor:gone');
  });

  it('rethrows any other storage error so the broker can retry it', async () => {
    prisma.productView.createMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      handle({ type: 'product_view', productId: 'p1' }),
    ).rejects.toThrow('connection lost');
  });

  it('stores a search with zero results when the count is missing', async () => {
    await handle({
      type: 'search',
      query: 'red shoes',
      userId: 'u1',
      sessionId: 's1',
    });

    expect(prisma.searchQuery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        query: 'red shoes',
        resultsCount: 0,
        userId: 'u1',
        sessionId: 's1',
      }),
    });
  });

  it.each([
    ['no payload', undefined],
    ['a view without a product', { type: 'product_view' }],
    ['a search without a query', { type: 'search' }],
    ['an unknown type', { type: 'other', productId: 'p1' }],
  ])('ignores %s', async (_label, payload) => {
    await expect(handle(payload)).resolves.toBeUndefined();
    expect(prisma.productView.createMany).not.toHaveBeenCalled();
    expect(prisma.searchQuery.create).not.toHaveBeenCalled();
  });
});
