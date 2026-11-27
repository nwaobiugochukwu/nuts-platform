import { buildEnvelope } from '../../../infrastructure/messaging/events/event-envelope.util';
import {
  fakeProcessed,
  fakeRabbit,
  withRole,
} from '../../../infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { OrderEventsConsumer } from './order-events.consumer';

describe('OrderEventsConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let idempotency: ReturnType<typeof fakeProcessed>;
  let notifications: Record<string, jest.Mock>;
  let consumer: OrderEventsConsumer;

  const handlers = {
    'order.processing': 'handleOrderProcessing',
    'order.shipped': 'handleOrderShipped',
    'order.delivered': 'handleOrderDelivered',
    'order.cancelled': 'handleOrderCancelled',
    'payment.confirmed': 'handlePaymentConfirmed',
    'payment.failed': 'handlePaymentFailed',
    'referral.reward_credited': 'handleReferralReward',
  } as const;

  beforeEach(() => {
    harness = fakeRabbit();
    idempotency = fakeProcessed();
    notifications = Object.fromEntries(
      Object.values(handlers).map((name) => [
        name,
        jest.fn().mockResolvedValue(undefined),
      ]),
    );
    consumer = new OrderEventsConsumer(
      harness.rabbit,
      notifications as never,
      idempotency.processed,
    );
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.ORDER_EVENTS)(raw);
  }

  const event = (
    type: string,
    payload: object = { orderId: 'o-1' },
    extra = {},
  ) => ({
    ...buildEnvelope(
      { type, aggregate: { type: 'order', id: 'o-1' }, payload },
      { eventId: 'e-1' },
    ),
    ...extra,
  });

  it('owns its own queue', async () => {
    await consumer.onModuleInit();
    expect(harness.consume).toHaveBeenCalledWith(
      RABBITMQ_QUEUES.ORDER_EVENTS,
      expect.any(Function),
    );
  });

  it.each(Object.entries(handlers))(
    'hands %s to %s with the event payload, and to no other handler',
    async (type, method) => {
      const payload = { marker: type };

      await handle(event(type, payload));

      expect(notifications[method]).toHaveBeenCalledWith(payload);
      for (const [name, mock] of Object.entries(notifications)) {
        if (name !== method) expect(mock).not.toHaveBeenCalled();
      }
    },
  );

  it('handles each event once, by its event id', async () => {
    await handle(event('order.shipped'));

    expect(idempotency.runOnce).toHaveBeenCalledWith(
      'order-events',
      'e-1',
      expect.any(Function),
    );
  });

  it('does not repeat the emails and notifications for a redelivered event', async () => {
    const duplicate = fakeProcessed(['e-1']);
    consumer = new OrderEventsConsumer(
      harness.rabbit,
      notifications as never,
      duplicate.processed,
    );
    harness.consumers.length = 0;

    await handle(event('order.shipped'));

    expect(notifications.handleOrderShipped).not.toHaveBeenCalled();
  });

  it.each([
    ['not an envelope (an old flat payload)', { orderId: 'o-1', eventId: 'e' }],
    ['an event type this queue does not handle', event('order.paid')],
    [
      'an unsupported payload version',
      event('order.shipped', {}, { version: 2 }),
    ],
  ])(
    'rejects %s as permanently bad, calling no handler',
    async (_label, raw) => {
      await expect(handle(raw)).rejects.toMatchObject({
        name: 'PermanentConsumerError',
      });
      for (const mock of Object.values(notifications)) {
        expect(mock).not.toHaveBeenCalled();
      }
    },
  );

  it('lets a handler failure through, so the queue retries the event', async () => {
    notifications.handleOrderShipped.mockRejectedValue(new Error('smtp down'));

    await expect(handle(event('order.shipped'))).rejects.toThrow('smtp down');
  });

  it.each(['api', 'jobs'])(
    'does not consume in the %s program',
    async (role) => {
      await withRole(role, () => consumer.onModuleInit());
      expect(harness.consume).not.toHaveBeenCalled();
    },
  );

  it.each(['worker', 'all', undefined])(
    'consumes in the %s program',
    async (role) => {
      await withRole(role, () => consumer.onModuleInit());
      expect(harness.consume).toHaveBeenCalledTimes(1);
    },
  );
});
