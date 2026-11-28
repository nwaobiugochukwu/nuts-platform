import { buildEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import {
  fakeRabbit,
  withRole,
} from '@api/infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { ReviewAggregateConsumer } from '../../consumers/review-aggregate.consumer';

describe('ReviewAggregateConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let aggregate: { recompute: jest.Mock };
  let consumer: ReviewAggregateConsumer;

  const event = (type: string, payload: object = { productId: 'p-1' }) =>
    buildEnvelope(
      { type, aggregate: { type: 'review', id: 'r-1' }, payload },
      { eventId: 'e-1' },
    );

  beforeEach(() => {
    harness = fakeRabbit();
    aggregate = { recompute: jest.fn().mockResolvedValue({}) };
    consumer = new ReviewAggregateConsumer(harness.rabbit, aggregate as never);
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.REVIEW_AGGREGATES)(raw);
  }

  it.each(['review.created', 'review.updated', 'review.deleted'])(
    'recomputes the product summary on %s',
    async (type) => {
      await handle(event(type));

      expect(aggregate.recompute).toHaveBeenCalledWith('p-1');
    },
  );

  it('needs no de-duplication: handling the same event twice just recomputes twice', async () => {
    await handle(event('review.created'));
    await handle(event('review.created'));

    expect(aggregate.recompute).toHaveBeenCalledTimes(2);
  });

  it('lets a failure through so the queue retries it', async () => {
    aggregate.recompute.mockRejectedValue(new Error('db down'));

    await expect(handle(event('review.created'))).rejects.toThrow('db down');
  });

  it.each([
    ['an event with no product id', event('review.created', {})],
    ['another event type', event('product.created')],
    ['a message that is not an envelope', { productId: 'p-1' }],
  ])('dead-letters %s at once', async (_label, raw) => {
    await expect(handle(raw)).rejects.toMatchObject({
      name: 'PermanentConsumerError',
    });
    expect(aggregate.recompute).not.toHaveBeenCalled();
  });

  it.each(['api', 'jobs'])(
    'does not consume in the %s program',
    async (role) => {
      await withRole(role, () => consumer.onModuleInit());
      expect(harness.consume).not.toHaveBeenCalled();
    },
  );

  it('consumes in the worker program', async () => {
    await withRole('worker', () => consumer.onModuleInit());
    expect(harness.consume).toHaveBeenCalledTimes(1);
  });
});
