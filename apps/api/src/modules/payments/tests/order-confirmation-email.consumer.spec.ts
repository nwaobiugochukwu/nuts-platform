import { buildEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import {
  fakeProcessed,
  fakeRabbit,
  withRole,
} from '@api/infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { OrderConfirmationEmailConsumer } from '../consumers/order-confirmation-email.consumer';

describe('OrderConfirmationEmailConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let idempotency: ReturnType<typeof fakeProcessed>;
  let payments: { sendOrderConfirmationEmail: jest.Mock };
  let consumer: OrderConfirmationEmailConsumer;

  const event = (
    type = 'payment.confirmed',
    payload: object = { paymentId: 'p-1' },
  ) =>
    buildEnvelope(
      { type, aggregate: { type: 'payment', id: 'p-1' }, payload },
      { eventId: 'e-1' },
    );

  beforeEach(() => {
    harness = fakeRabbit();
    idempotency = fakeProcessed();
    payments = {
      sendOrderConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    };
    consumer = new OrderConfirmationEmailConsumer(
      harness.rabbit,
      payments as never,
      idempotency.processed,
    );
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.ORDER_CONFIRMATION_EMAILS)(raw);
  }

  it('sends the confirmation email with the invoice for the confirmed payment', async () => {
    await handle(event());

    expect(payments.sendOrderConfirmationEmail).toHaveBeenCalledWith('p-1');
    expect(idempotency.runOnce).toHaveBeenCalledWith(
      'order-confirmation-emails',
      'e-1',
      expect.any(Function),
    );
  });

  it('does not send the invoice twice for a redelivered event', async () => {
    const duplicate = fakeProcessed(['e-1']);
    consumer = new OrderConfirmationEmailConsumer(
      harness.rabbit,
      payments as never,
      duplicate.processed,
    );
    harness.consumers.length = 0;

    await handle(event());

    expect(payments.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });

  it('lets a failure through, so the queue retries it and later dead-letters it', async () => {
    payments.sendOrderConfirmationEmail.mockRejectedValue(
      new Error('smtp down'),
    );

    await expect(handle(event())).rejects.toThrow('smtp down');
  });

  it.each([
    ['an event with no payment id', event('payment.confirmed', {})],
    ['another event type', event('payment.failed')],
    ['a message that is not an envelope', { paymentId: 'p-1' }],
  ])('dead-letters %s at once', async (_label, raw) => {
    await expect(handle(raw)).rejects.toMatchObject({
      name: 'PermanentConsumerError',
    });
    expect(payments.sendOrderConfirmationEmail).not.toHaveBeenCalled();
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
