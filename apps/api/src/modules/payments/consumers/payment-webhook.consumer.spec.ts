import { buildEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import {
  fakeProcessed,
  fakeRabbit,
  withRole,
} from '@api/infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { PaymentWebhookConsumer } from './payment-webhook.consumer';

describe('PaymentWebhookConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let idempotency: ReturnType<typeof fakeProcessed>;
  let inbox: Record<string, jest.Mock>;
  let payments: { processWebhookEvent: jest.Mock };
  let consumer: PaymentWebhookConsumer;

  const stored = (overrides = {}) => ({
    id: 'in-1',
    status: 'RECEIVED',
    payload: '{"event":"charge.success","data":{"reference":"R1"}}',
    ...overrides,
  });
  const envelope = (
    payload: object = { inboxId: 'in-1' },
    type = 'payment.webhook_received',
  ) =>
    buildEnvelope(
      { type, aggregate: { type: 'webhook', id: 'in-1' }, payload },
      { eventId: 'e-1' },
    );

  beforeEach(() => {
    harness = fakeRabbit();
    idempotency = fakeProcessed();
    inbox = {
      load: jest.fn().mockResolvedValue(stored()),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markAttemptFailed: jest.fn().mockResolvedValue(undefined),
    };
    payments = { processWebhookEvent: jest.fn().mockResolvedValue(undefined) };
    consumer = new PaymentWebhookConsumer(
      harness.rabbit,
      inbox as never,
      payments as never,
      idempotency.processed,
    );
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((consumer as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.PAYMENT_WEBHOOKS)(raw);
  }

  it('applies the stored webhook, then marks it processed', async () => {
    await handle(envelope());

    expect(payments.processWebhookEvent).toHaveBeenCalledWith({
      event: 'charge.success',
      data: { reference: 'R1' },
    });
    expect(inbox.markProcessed).toHaveBeenCalledWith('in-1');
    expect(idempotency.runOnce).toHaveBeenCalledWith(
      'payment-webhooks',
      'e-1',
      expect.any(Function),
    );
  });

  it('does not apply a webhook twice when the event is redelivered', async () => {
    const duplicate = fakeProcessed(['e-1']);
    consumer = new PaymentWebhookConsumer(
      harness.rabbit,
      inbox as never,
      payments as never,
      duplicate.processed,
    );
    harness.consumers.length = 0;

    await handle(envelope());

    expect(payments.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('skips a webhook already marked processed', async () => {
    inbox.load.mockResolvedValue(stored({ status: 'PROCESSED' }));

    await handle(envelope());

    expect(payments.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('skips, without retrying, a webhook that is no longer in the inbox', async () => {
    inbox.load.mockResolvedValue(null);

    await expect(handle(envelope())).resolves.toBeUndefined();
    expect(payments.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('records the failure and rethrows, so the queue retries it', async () => {
    payments.processWebhookEvent.mockRejectedValue(new Error('db down'));

    await expect(handle(envelope())).rejects.toThrow('db down');
    expect(inbox.markAttemptFailed).toHaveBeenCalledWith(
      'in-1',
      expect.any(Error),
    );
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it.each([
    ['an event with no inbox id', envelope({})],
    ['another event type', envelope({ inboxId: 'in-1' }, 'payment.confirmed')],
    ['a message that is not an envelope', { inboxId: 'in-1' }],
  ])('dead-letters %s at once', async (_label, raw) => {
    await expect(handle(raw)).rejects.toMatchObject({
      name: 'PermanentConsumerError',
    });
    expect(payments.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('dead-letters a stored body that is not JSON', async () => {
    inbox.load.mockResolvedValue(stored({ payload: 'garbage' }));

    await expect(handle(envelope())).rejects.toMatchObject({
      name: 'PermanentConsumerError',
    });
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
